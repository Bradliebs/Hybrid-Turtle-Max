/**
 * READ-ONLY diagnostic — Step 0 evidence for the "are US buys actually being
 * placed?" question (post PT20M->PT30M scheduler fix).
 *
 * Answers two things from live data, no mutations:
 *   1. ExecutionLog: are buy ORDERS being placed, and what's failing? (ground truth)
 *   2. Heartbeat(AUTO_TRADE): do trade sessions COMPLETE, and how many buys each
 *      placed? A session killed at the task time-limit never reaches the terminal
 *      heartbeat (auto-trade.ts ~L1652), so an absent completion row on a trading
 *      day = the session did not finish (killed or skipped).
 *
 * Usage:  npx tsx scripts/diagnose-buy-activity.ts [days]
 *         days defaults to 30.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DAYS = Math.max(1, parseInt(process.argv[2] || '30', 10));
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

const isUK = (ticker: string) => /\.L$/i.test(ticker);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

const BUY_PHASES = ['BUY_PLACED', 'COMPLETE', 'BUY_FAILED', 'BUY_TIMEOUT', 'CLIENT_ERROR'] as const;

async function main() {
  console.log(`\n=== BUY ACTIVITY DIAGNOSTIC — last ${DAYS} days (since ${dayKey(since)}) ===\n`);

  // ── 1. ExecutionLog: order placements & failures ───────────────────────────
  const logs = await prisma.executionLog.findMany({
    where: { createdAt: { gte: since }, phase: { in: [...BUY_PHASES] } },
    select: { createdAt: true, ticker: true, phase: true, error: true, responseStatus: true, accountType: true },
    orderBy: { createdAt: 'asc' },
  });

  if (logs.length === 0) {
    console.log('ExecutionLog: NO buy-phase rows in window. Either no trades attempted, or this DB is not the live box.\n');
  } else {
    // Per-phase totals, split US vs UK.
    const tally: Record<string, { us: number; uk: number }> = {};
    for (const p of BUY_PHASES) tally[p] = { us: 0, uk: 0 };
    for (const l of logs) tally[l.phase][isUK(l.ticker) ? 'uk' : 'us']++;

    console.log('ExecutionLog buy-phase totals (US = non-.L, UK = .L):');
    console.log('  phase'.padEnd(16) + 'US'.padStart(6) + 'UK'.padStart(6));
    for (const p of BUY_PHASES) {
      console.log('  ' + p.padEnd(14) + String(tally[p].us).padStart(6) + String(tally[p].uk).padStart(6));
    }

    // Per-day BUY_PLACED (money actually deployed) US vs UK.
    const byDay = new Map<string, { usPlaced: number; ukPlaced: number; failed: number }>();
    for (const l of logs) {
      const k = dayKey(l.createdAt);
      const row = byDay.get(k) ?? { usPlaced: 0, ukPlaced: 0, failed: 0 };
      if (l.phase === 'BUY_PLACED') (isUK(l.ticker) ? (row.ukPlaced++) : (row.usPlaced++));
      if (l.phase === 'BUY_FAILED' || l.phase === 'BUY_TIMEOUT' || l.phase === 'CLIENT_ERROR') row.failed++;
      byDay.set(k, row);
    }
    console.log('\nPer-day buy orders placed:');
    console.log('  date'.padEnd(14) + 'US'.padStart(5) + 'UK'.padStart(5) + 'FAIL'.padStart(6));
    for (const [k, v] of [...byDay.entries()].sort()) {
      console.log('  ' + k.padEnd(12) + String(v.usPlaced).padStart(5) + String(v.ukPlaced).padStart(5) + String(v.failed).padStart(6));
    }

    // Recent failures verbatim — this is the cheapest "why did a buy fail" signal.
    const fails = logs.filter(l => l.phase === 'BUY_FAILED' || l.phase === 'BUY_TIMEOUT' || l.phase === 'CLIENT_ERROR').slice(-20);
    if (fails.length) {
      console.log(`\nLast ${fails.length} buy failures (verbatim):`);
      for (const f of fails) {
        console.log(`  ${dayKey(f.createdAt)} ${f.ticker.padEnd(10)} ${f.phase.padEnd(12)} [${f.responseStatus ?? '-'}] ${f.error ?? ''}`);
      }
    }
  }

  // ── 2. Heartbeat(AUTO_TRADE): did sessions complete, and place buys? ───────
  const hbs = await prisma.heartbeat.findMany({
    where: { timestamp: { gte: since }, kind: 'AUTO_TRADE' },
    select: { timestamp: true, status: true, details: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`\n\n=== AUTO_TRADE heartbeats (${hbs.length} in window) ===`);
  console.log('A trade session killed at the task time-limit writes NO terminal heartbeat,');
  console.log('so an absent (session,date) completion row on a trading day = did not finish.\n');

  const skipTally = new Map<string, number>();
  let totalEligible = 0;
  let totalExecuted = 0;
  if (hbs.length === 0) {
    console.log('No AUTO_TRADE heartbeats. Sessions are not running here, or this is not the live box.');
  } else {
    console.log('  date'.padEnd(13) + 'session'.padEnd(10) + 'status'.padEnd(9) +
      'scan'.padStart(6) + 'elig'.padStart(5) + 'exec'.padStart(5) + 'fail'.padStart(5) + 'skip'.padStart(5) + '  reason');
    for (const h of hbs) {
      let d: Record<string, unknown> = {};
      try { d = JSON.parse(h.details ?? '{}'); } catch { /* tolerate legacy */ }
      const session = String(d.session ?? '?');
      const reason = d.reason ? String(d.reason) : '';
      const n = (k: string) => (d[k] === undefined ? '' : String(d[k]));
      console.log(
        '  ' + dayKey(h.timestamp).padEnd(11) +
        session.padEnd(10) +
        h.status.padEnd(9) +
        n('scanned').padStart(6) +
        n('eligible').padStart(5) +
        n('executed').padStart(5) +
        n('failed').padStart(5) +
        n('skipped').padStart(5) +
        (reason ? '  ' + reason : '')
      );
      if (typeof d.eligible === 'number') totalEligible += d.eligible;
      if (typeof d.executed === 'number') totalExecuted += d.executed;
      if (Array.isArray(d.skipReasons)) {
        for (const s of d.skipReasons as Array<{ reason?: string }>) {
          const r = s?.reason ?? 'unknown';
          skipTally.set(r, (skipTally.get(r) ?? 0) + 1);
        }
      }
    }
  }

  // ── Why are eligible candidates not turning into buys? ─────────────────────
  console.log(`\n=== SKIP REASONS (why eligible candidates were not bought) ===`);
  console.log(`Window totals: eligible=${totalEligible}  executed=${totalExecuted}`);
  for (const [r, c] of [...skipTally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log('  ' + String(c).padStart(5) + '  ' + r);
  }

  // ── Sizing-cash mismatch check ─────────────────────────────────────────────
  const user = await prisma.user.findFirst({
    select: { equity: true, t212Connected: true, t212TotalValue: true, t212IsaTotalValue: true },
  });
  console.log(`\n=== SIZING vs LIVE CASH ===`);
  console.log('  User.equity (sizing basis): ' + String(user?.equity));
  console.log('  t212Connected:              ' + String(user?.t212Connected));
  console.log('  t212TotalValue:             ' + String(user?.t212TotalValue));
  console.log('  t212IsaTotalValue:          ' + String(user?.t212IsaTotalValue));

  // ── ISA-routable universe ──────────────────────────────────────────────────
  // Connected account is the ISA. A stock routes there only if isaEligible=true.
  const totalStocks = await prisma.stock.count();
  const isaEligible = await prisma.stock.count({ where: { isaEligible: true } });
  const ukStocks = await prisma.stock.count({ where: { ticker: { endsWith: '.L' } } });
  console.log(`\n=== ISA-ROUTABLE UNIVERSE ===`);
  console.log('  stocks total:        ' + totalStocks);
  console.log('  isaEligible=true:    ' + isaEligible + '  (only these can route to the connected ISA)');
  console.log('  UK (.L) stocks:      ' + ukStocks);

  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
