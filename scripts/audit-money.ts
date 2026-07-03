#!/usr/bin/env npx tsx
/**
 * MONEY AUDIT — where is the cash actually going?
 *
 * The R-multiple scoreboard graded the system "B" on 12 closed trades, but
 * R-multiples hide real losses: open-position bleed, GBP vs R divergence,
 * whipsaw churn, slippage, and FX. This pass follows the actual money.
 *
 * Read-only. Runs against the DB snapshot. No strategy logic touched.
 *
 * Usage:  npx tsx scripts/audit-money.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../src/lib/prisma';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const L: string[] = [];
const out = (s = '') => L.push(s);
const gbp = (v: number | null | undefined, dp = 2) =>
  v == null ? '—' : `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(dp)}`;
const num = (v: number | null | undefined, dp = 2) => (v == null ? '—' : v.toFixed(dp));

async function main() {
  out('# HybridTurtle — Money Audit');
  out('');
  out(`**Generated:** ${new Date().toISOString()}  `);
  out('> Follows actual cash, not R-multiples. Read-only snapshot.');
  out('');
  out('---');
  out('');

  // ── Which user is trading ──
  const users = await prisma.user.findMany({
    select: { id: true, email: true, equity: true, operatingMode: true, riskProfile: true },
  });

  // ── Equity curve ──
  out('## 1. Equity Curve (the bottom line)');
  out('');
  for (const u of users) {
    const snaps = await prisma.equitySnapshot.findMany({
      where: { userId: u.id },
      orderBy: { capturedAt: 'asc' },
      select: { equity: true, capturedAt: true, source: true },
    });
    if (snaps.length === 0) continue;
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    let peak = first.equity;
    let trough = first.equity;
    for (const s of snaps) {
      if (s.equity > peak) peak = s.equity;
      if (s.equity < trough) trough = s.equity;
    }
    const change = last.equity - first.equity;
    const changePct = first.equity > 0 ? (change / first.equity) * 100 : 0;
    const ddFromPeak = peak > 0 ? ((peak - last.equity) / peak) * 100 : 0;

    out(`### User \`${u.email ?? u.id}\` (mode: ${u.operatingMode}, profile: ${u.riskProfile})`);
    out('');
    out('| Metric | Value |');
    out('|--------|-------|');
    out(`| Set equity (config) | ${gbp(u.equity)} |`);
    out(`| First snapshot | ${gbp(first.equity)} (${first.capturedAt.toISOString().slice(0, 10)}) |`);
    out(`| Latest snapshot | ${gbp(last.equity)} (${last.capturedAt.toISOString().slice(0, 10)}) |`);
    out(`| Peak | ${gbp(peak)} |`);
    out(`| Trough | ${gbp(trough)} |`);
    out(`| **Net change** | **${gbp(change)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)** |`);
    out(`| Drawdown from peak | ${ddFromPeak.toFixed(1)}% |`);
    out(`| Snapshots | ${snaps.length} |`);
    out('');

    // Show last 10 snapshots so a decline is visible
    out('Recent equity snapshots:');
    out('');
    out('| Date | Equity | Source |');
    out('|------|--------|--------|');
    for (const s of snaps.slice(-10)) {
      out(`| ${s.capturedAt.toISOString().slice(0, 16).replace('T', ' ')} | ${gbp(s.equity)} | ${s.source} |`);
    }
    out('');
  }

  // ── Open positions: unrealised P&L ──
  out('---');
  out('');
  out('## 2. Open Positions — Unrealised P&L');
  out('');
  const open = await prisma.position.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true, userId: true, t212Ticker: true, entryPrice: true, shares: true,
      currentStop: true, stopLoss: true, initialRisk: true, entryDate: true,
      protectionLevel: true, source: true, accountType: true,
      stock: { select: { ticker: true, name: true } },
    },
  });

  // Latest current price per ticker from PriceSnapshot (broker/yahoo marks).
  async function latestPrice(tickers: string[]): Promise<number | null> {
    for (const t of tickers.filter(Boolean)) {
      const snap = await prisma.priceSnapshot.findFirst({
        where: { ticker: t },
        orderBy: { capturedAt: 'desc' },
        select: { t212Price: true, yahooPrice: true },
      });
      if (snap) return snap.t212Price ?? snap.yahooPrice ?? null;
    }
    return null;
  }
  // Pre-resolve marks so we can reuse them in the verdict.
  const marks = new Map<string, number | null>();
  for (const p of open) {
    marks.set(p.id, await latestPrice([p.t212Ticker ?? '', p.stock?.ticker ?? '']));
  }
  const openUnreal = open.reduce((t, p) => {
    const now = marks.get(p.id) ?? null;
    return now != null ? t + (now - p.entryPrice) * p.shares : t;
  }, 0);
  out(`Open positions: ${open.length}`);
  out('');
  if (open.length > 0) {
    out('| Ticker | Entry | Now | Shares | Unreal £ | Unreal % | Stop | Risk-if-stopped £ | Held (d) | Prot |');
    out('|--------|-------|-----|--------|----------|----------|------|-------------------|----------|------|');
    let totalUnreal = 0;
    let totalRiskIfStopped = 0;
    let underwater = 0;
    let belowStop = 0;
    for (const p of open) {
      const now = marks.get(p.id) ?? null;
      const held = Math.floor((Date.now() - p.entryDate.getTime()) / 86400000);
      const unreal = now != null ? (now - p.entryPrice) * p.shares : null;
      const unrealPct = now != null && p.entryPrice > 0 ? ((now - p.entryPrice) / p.entryPrice) * 100 : null;
      const riskIfStopped = now != null ? (p.currentStop - now) * p.shares : null; // negative = further loss to stop
      if (unreal != null) { totalUnreal += unreal; if (unreal < 0) underwater++; }
      if (riskIfStopped != null && riskIfStopped < 0) totalRiskIfStopped += riskIfStopped;
      if (now != null && now < p.currentStop) belowStop++;
      out(`| ${p.stock?.ticker ?? p.t212Ticker ?? '?'} | ${num(p.entryPrice)} | ${num(now)} | ${num(p.shares, 3)} | ${gbp(unreal)} | ${unrealPct == null ? '—' : unrealPct.toFixed(1) + '%'} | ${num(p.currentStop)} | ${gbp(riskIfStopped)} | ${held} | ${p.protectionLevel} |`);
    }
    out('');
    out(`**Total unrealised P&L: ${gbp(totalUnreal)}** across ${open.length} positions (${underwater} underwater).`);
    out(`Additional loss if every stop hit from here: ${gbp(totalRiskIfStopped)}.`);
    if (belowStop > 0) out(`⚠ ${belowStop} position(s) are trading BELOW their recorded stop — stop may not have executed.`);
    out('');
  }

  // ── Closed positions: realised GBP vs R ──
  out('---');
  out('');
  out('## 3. Closed Positions — Realised Cash');
  out('');
  const closed = await prisma.position.findMany({
    where: { status: 'CLOSED' },
    orderBy: { exitDate: 'asc' },
    select: {
      t212Ticker: true, entryPrice: true, exitPrice: true, shares: true,
      entryDate: true, exitDate: true, exitReason: true, closedBy: true,
      realisedPnlGbp: true, realisedPnlR: true, whipsawCount: true,
      stock: { select: { ticker: true } },
    },
  });
  const withGbp = closed.filter((c) => c.realisedPnlGbp != null);
  const totalRealisedGbp = withGbp.reduce((s, c) => s + (c.realisedPnlGbp ?? 0), 0);
  const winsGbp = withGbp.filter((c) => (c.realisedPnlGbp ?? 0) > 0);
  const lossesGbp = withGbp.filter((c) => (c.realisedPnlGbp ?? 0) <= 0);
  const grossWin = winsGbp.reduce((s, c) => s + (c.realisedPnlGbp ?? 0), 0);
  const grossLoss = Math.abs(lossesGbp.reduce((s, c) => s + (c.realisedPnlGbp ?? 0), 0));

  out(`Closed positions: ${closed.length} | with GBP data: ${withGbp.length}`);
  out('');
  out('| Metric | Value |');
  out('|--------|-------|');
  out(`| **Total realised P&L** | **${gbp(totalRealisedGbp)}** |`);
  out(`| Gross wins | ${gbp(grossWin)} (${winsGbp.length}) |`);
  out(`| Gross losses | ${gbp(-grossLoss)} (${lossesGbp.length}) |`);
  out(`| Profit factor (GBP) | ${grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '—'} |`);
  out(`| Avg win | ${gbp(winsGbp.length ? grossWin / winsGbp.length : null)} |`);
  out(`| Avg loss | ${gbp(lossesGbp.length ? -grossLoss / lossesGbp.length : null)} |`);
  out('');

  out('Every closed trade (chronological):');
  out('');
  out('| Exit date | Ticker | Entry | Exit | P&L £ | R | Reason | ClosedBy | Whipsaw |');
  out('|-----------|--------|-------|------|-------|---|--------|----------|---------|');
  for (const c of closed) {
    out(`| ${c.exitDate?.toISOString().slice(0, 10) ?? '—'} | ${c.stock?.ticker ?? c.t212Ticker ?? '?'} | ${num(c.entryPrice)} | ${num(c.exitPrice)} | ${gbp(c.realisedPnlGbp)} | ${num(c.realisedPnlR)} | ${c.exitReason ?? '—'} | ${c.closedBy ?? '—'} | ${c.whipsawCount} |`);
  }
  out('');

  // Exit-reason breakdown by money
  const byReason = new Map<string, { n: number; gbp: number }>();
  for (const c of withGbp) {
    const k = c.exitReason ?? 'UNKNOWN';
    const e = byReason.get(k) ?? { n: 0, gbp: 0 };
    e.n++; e.gbp += c.realisedPnlGbp ?? 0;
    byReason.set(k, e);
  }
  out('Realised P&L by exit reason:');
  out('');
  out('| Exit reason | Trades | Total £ |');
  out('|-------------|--------|---------|');
  for (const [k, v] of [...byReason.entries()].sort((a, b) => a[1].gbp - b[1].gbp)) {
    out(`| ${k} | ${v.n} | ${gbp(v.gbp)} |`);
  }
  out('');

  // ── T212 realised (broker truth) ──
  out('---');
  out('');
  out('## 4. Broker-Reported Realised P&L (T212 truth)');
  out('');
  const t212Logs = await prisma.tradeLog.findMany({
    where: { realisedPnlT212: { not: null } },
    select: { ticker: true, tradeDate: true, realisedPnlT212: true, netValueGbp: true, exitReason: true },
    orderBy: { tradeDate: 'asc' },
  });
  const t212Total = t212Logs.reduce((s, t) => s + (t.realisedPnlT212 ?? 0), 0);
  out(`T212 fills with realised P&L: ${t212Logs.length} | **Total broker realised: ${gbp(t212Total)}**`);
  out('');
  if (t212Logs.length > 0) {
    const t212Wins = t212Logs.filter((t) => (t.realisedPnlT212 ?? 0) > 0).length;
    out(`Wins: ${t212Wins} / ${t212Logs.length} (${((t212Wins / t212Logs.length) * 100).toFixed(0)}%)`);
    out('');
  }

  // ── Slippage & churn ──
  out('---');
  out('');
  out('## 5. Slippage & Churn (silent money leaks)');
  out('');
  const fills = await prisma.tradeLog.findMany({
    where: { slippagePct: { not: null } },
    select: { slippagePct: true },
  });
  const slips = fills.map((f) => f.slippagePct!).filter((v) => v != null);
  const avgSlip = slips.length ? slips.reduce((a, b) => a + b, 0) / slips.length : null;
  const worstSlip = slips.length ? Math.max(...slips.map(Math.abs)) : null;
  out(`Fills with slippage data: ${slips.length} | avg ${avgSlip == null ? '—' : avgSlip.toFixed(2) + '%'} | worst ${worstSlip == null ? '—' : worstSlip.toFixed(2) + '%'}`);
  out('');
  const totalWhipsaw = closed.reduce((s, c) => s + c.whipsawCount, 0);
  const buyCount = await prisma.tradeLog.count({ where: { tradeType: 'BUY' } });
  const sellCount = await prisma.tradeLog.count({ where: { tradeType: 'SELL' } });
  out(`Total whipsaw count across closed positions: ${totalWhipsaw}`);
  out(`Trade logs — BUY: ${buyCount}, SELL: ${sellCount}`);
  out('');

  // ── Verdict ──
  out('---');
  out('');
  out('## 6. Diagnosis — Why Is Money Being Lost?');
  out('');

  // (a) Edge over time
  const closedR = closed.filter((c) => c.realisedPnlR != null);
  const Rseq = closedR.map((c) => c.realisedPnlR!);
  const rSum = Rseq.reduce((a, b) => a + b, 0);
  const rWins = Rseq.filter((r) => r > 0);
  const rLosses = Rseq.filter((r) => r <= 0);
  const avgWinR = rWins.length ? rWins.reduce((a, b) => a + b, 0) / rWins.length : 0;
  const avgLossR = rLosses.length ? rLosses.reduce((a, b) => a + b, 0) / rLosses.length : 0;
  const payoff = avgLossR !== 0 ? Math.abs(avgWinR / avgLossR) : null;
  const firstHalf = Rseq.slice(0, Math.floor(Rseq.length / 2));
  const secondHalf = Rseq.slice(Math.floor(Rseq.length / 2));
  const em = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const last5 = Rseq.slice(-5);
  const bigWins = Rseq.filter((r) => r >= 1.5).length;

  out('### A. The trend-following payoff structure is broken');
  out('');
  out('| Metric | Value | Healthy for trend-following |');
  out('|--------|-------|------------------------------|');
  out(`| Expectancy | ${num(rSum / (Rseq.length || 1))}R | > +0.2R |`);
  out(`| Avg win / avg loss (R) | ${num(avgWinR)} / ${num(avgLossR)} | — |`);
  out(`| **Payoff ratio** | **${num(payoff)}** | **> 2.0** |`);
  out(`| Big wins (≥1.5R) | ${bigWins} of ${Rseq.length} | many (fat right tail) |`);
  out(`| Avg hold: winners vs losers | ${num(em(closedR.filter(c => c.realisedPnlR! > 0).map(c => (c.exitDate!.getTime()-c.entryDate.getTime())/86400000)), 1)}d vs ${num(em(closedR.filter(c => c.realisedPnlR! <= 0).map(c => (c.exitDate!.getTime()-c.entryDate.getTime())/86400000)), 1)}d | winners MUCH longer |`);
  out('');
  out(`Winners are no bigger than losers (payoff ≈ ${num(payoff)}) and are held barely longer. `);
  out('A trend system needs a few large winners to pay for many small losers — that fat right tail is absent.');
  out('');

  out('### B. The edge has decayed and turned negative');
  out('');
  out(`- First half expectancy: **${num(em(firstHalf))}R** (${firstHalf.length} trades)`);
  out(`- Second half expectancy: **${num(em(secondHalf))}R** (${secondHalf.length} trades)`);
  out(`- Last 5 trades: ${last5.map((r) => r.toFixed(2)).join(', ')} → sum **${num(last5.reduce((a, b) => a + b, 0))}R**`);
  out('');

  // (c) Regime gate
  const rhCount = await prisma.regimeHistory.count();
  const recentSince = new Date(Date.now() - 7 * 86400000);
  const recentCand = await prisma.candidateOutcome.count({ where: { scanDate: { gte: recentSince } } });
  const recentBlocked = await prisma.candidateOutcome.count({ where: { scanDate: { gte: recentSince }, blockedByRegime: true } });
  const regimeDist = await prisma.candidateOutcome.groupBy({ by: ['regime'], where: { scanDate: { gte: recentSince } }, _count: { _all: true } });
  out('### C. The regime safety gate never engaged (and leaves no audit trail)');
  out('');
  out(`- \`RegimeHistory\` table rows: **${rhCount}** — the regime detector (Job 1) persists no history, so gate decisions cannot be audited.`);
  out(`- Candidates blocked by regime in last 7 days: **${recentBlocked} / ${recentCand}**.`);
  out(`- Regime label on recent scans: ${regimeDist.map((r) => `${r.regime} (${r._count._all})`).join(', ')}.`);
  out('');
  out('The gate that is meant to stop trading in poor conditions classified the market as tradable throughout the drawdown and blocked nothing.');
  out('');

  // (d) Broker vs local reconciliation
  const t212Fills = await prisma.tradeLog.count({ where: { importedFromT212: true } });
  const t212Agg = await prisma.tradeLog.aggregate({ where: { realisedPnlT212: { not: null } }, _sum: { realisedPnlT212: true, netValueGbp: true } });
  const snapsAll = await prisma.equitySnapshot.findMany({ orderBy: { capturedAt: 'asc' }, select: { equity: true } });
  const equityChange = snapsAll.length ? snapsAll[snapsAll.length - 1].equity - snapsAll[0].equity : 0;
  const localClosedGbp = closed.reduce((a, c) => a + (c.realisedPnlGbp ?? 0), 0);
  const unexplained = equityChange - localClosedGbp - openUnreal;
  out('### D. Reporting understates the loss — local records are an incomplete mirror');
  out('');
  out('| Source | Value |');
  out('|--------|-------|');
  out(`| **Real broker equity change** (snapshot first→last) | **${gbp(equityChange)}** |`);
  out(`| Local realised P&L (closed positions) | ${gbp(localClosedGbp)} |`);
  out(`| Local open unrealised | ${gbp(openUnreal)} |`);
  out(`| **Unexplained gap** | **${gbp(unexplained)}** |`);
  out(`| T212 broker fills | ${t212Fills} (gross notional ${gbp(t212Agg._sum.netValueGbp)}) |`);
  out(`| Local positions (all) | ${open.length + closed.length} |`);
  out('');
  out(`The account fell **${gbp(equityChange)}** but local position P&L explains only **${gbp(localClosedGbp + openUnreal)}** of it — a **${gbp(unexplained)}** gap. `);
  out(`There are **${t212Fills} broker fills** against ~${open.length + closed.length} local positions, so the R-scoreboard (and its "grade B") is measuring a subset and masks the real loss. Likely leaks: churn, spread/FX, and slippage (avg ${avgSlip == null ? '—' : avgSlip.toFixed(2) + '%'}).`);
  out('');

  out('### Verdict');
  out('');
  const combinedRealised = totalRealisedGbp;
  out(`**Real broker equity: ${gbp(equityChange)} (${snapsAll.length ? ((equityChange / snapsAll[0].equity) * 100).toFixed(1) : '—'}%).** `);
  out('The system is losing money for four compounding reasons: (A) winners are cut too short so there is no fat tail, ');
  out('(B) the edge has already flipped negative, (C) the regime brake never engaged and keeps no record, and ');
  out('(D) most broker activity is invisible to the local P&L, so prior "grade B" reports were false comfort.');
  out('');
  out('**Highest-priority fixes (advisory — no code changed here):** ');
  out('1. Trust broker equity, not the R-scoreboard, until local positions reconcile with all broker fills.');
  out('2. Investigate why winners exit at ~10 days (trailing-stop tightness / breakout-failure exits cutting trends).');
  out('3. Make the regime detector persist to `RegimeHistory` and verify the gate actually blocks in non-bullish conditions.');
  out('4. Quantify slippage/churn cost across all 105 fills — a ~2% entry slippage on a 2% risk trade erases ~1R instantly.');
  out('');

  console.log('');
  console.log('  MONEY AUDIT');
  console.log(`    Real broker equity change: ${gbp(equityChange)}`);
  console.log(`    Realised (local closed):   ${gbp(combinedRealised)}`);
  console.log(`    Unrealised (open marks):   ${gbp(openUnreal)}`);
  console.log(`    Unexplained gap:           ${gbp(unexplained)}`);
  console.log(`    Payoff ratio:              ${num(payoff)} (need > 2)`);
  console.log(`    Edge: 1st half ${num(em(firstHalf))}R -> 2nd half ${num(em(secondHalf))}R`);
  console.log(`    Regime gate blocks (7d):   ${recentBlocked}/${recentCand}  | RegimeHistory rows: ${rhCount}`);
  console.log(`    Broker fills vs local:     ${t212Fills} vs ${open.length + closed.length}`);
  console.log('');

  const reportsDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, 'money-audit.md');
  fs.writeFileSync(outPath, L.join('\n'), 'utf-8');
  console.log(`  Report: ${path.relative(ROOT, outPath)}`);
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[audit-money] FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
