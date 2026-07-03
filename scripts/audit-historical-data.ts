#!/usr/bin/env npx tsx
/**
 * HISTORICAL-DATA AUDIT — read-only "Learn" review (Job 8)
 *
 * Runs the existing analytics suite against whatever historical data has
 * accumulated in the database and produces a single consolidated report:
 *   reports/historical-data-audit.md
 *
 * It answers the questions the weekly review is meant to answer:
 *   1. Do we have enough data to conclude anything yet? (sufficiency)
 *   2. Is the live P&L edge real?                        (profit scoreboard)
 *   3. Do the scores actually predict outcomes?          (score monotonicity)
 *   4. Which filters/gates add edge — and which don't?   (filter scorecard)
 *   5. Which rules improve expectancy?                   (evidence framework)
 *
 * NO strategy logic is touched. Read-only. Safe to run any time.
 *
 * Usage:  npx tsx scripts/audit-historical-data.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import prisma from '../src/lib/prisma';
import { computeProfitScoreboard } from '../src/lib/profit-scoreboard';
import { generateScoreValidation } from '../src/lib/score-validation';
import { generateFilterScorecard } from '../src/lib/filter-scorecard';
import { generateEvidence } from '../src/lib/evidence-framework';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const L: string[] = [];
const out = (s = '') => L.push(s);
const num = (v: number | null | undefined, dp = 2, suffix = '') =>
  v == null ? '—' : `${v.toFixed(dp)}${suffix}`;
const pct = (v: number | null | undefined, dp = 1) =>
  v == null ? '—' : `${v.toFixed(dp)}%`;

interface Flag {
  severity: 'RED' | 'AMBER' | 'GREEN';
  text: string;
}
const flags: Flag[] = [];
const flag = (severity: Flag['severity'], text: string) => flags.push({ severity, text });

async function main() {
  const generatedAt = new Date().toISOString();

  // ── 1. Data sufficiency snapshot ─────────────────────────────────
  const [
    totalCandidates,
    enrichedCandidates,
    scoredCandidates,
    tradePlacedCandidates,
    totalScans,
    totalPositions,
    closedPositions,
    closedWithR,
    equitySnaps,
  ] = await Promise.all([
    prisma.candidateOutcome.count(),
    prisma.candidateOutcome.count({ where: { enrichedAt: { not: null } } }),
    prisma.candidateOutcome.count({ where: { ncs: { not: null } } }),
    prisma.candidateOutcome.count({ where: { tradePlaced: true } }),
    prisma.scan.count(),
    prisma.position.count(),
    prisma.position.count({ where: { status: 'CLOSED' } }),
    prisma.position.count({ where: { status: 'CLOSED', realisedPnlR: { not: null } } }),
    prisma.equitySnapshot.count(),
  ]);

  const firstScan = await prisma.candidateOutcome.findFirst({
    orderBy: { scanDate: 'asc' }, select: { scanDate: true },
  });
  const lastScan = await prisma.candidateOutcome.findFirst({
    orderBy: { scanDate: 'desc' }, select: { scanDate: true },
  });

  // Which user carries the closed trades? Grade the busiest one.
  const byUser = await prisma.position.groupBy({
    by: ['userId'],
    where: { status: 'CLOSED' },
    _count: { _all: true },
  });
  const primaryUser =
    byUser.sort((a, b) => b._count._all - a._count._all)[0]?.userId ?? 'default-user';

  const spanDays =
    firstScan?.scanDate && lastScan?.scanDate
      ? Math.max(0, Math.round((lastScan.scanDate.getTime() - firstScan.scanDate.getTime()) / 86400000))
      : 0;

  out('# HybridTurtle — Historical Data Audit');
  out('');
  out(`**Generated:** ${generatedAt}  `);
  out(`**Data span:** ${firstScan?.scanDate?.toISOString().slice(0, 10) ?? '—'} → ${lastScan?.scanDate?.toISOString().slice(0, 10) ?? '—'} (${spanDays} days)  `);
  out(`**Graded user:** ${primaryUser}  `);
  out('');
  out('> Read-only "Learn" review (Job 8). No strategy logic touched. Snapshot of live DB.');
  out('');
  out('---');
  out('');
  out('## 1. Data Sufficiency');
  out('');
  out('| Metric | Count |');
  out('|--------|-------|');
  out(`| Scans recorded | ${totalScans} |`);
  out(`| Candidate outcomes (rows) | ${totalCandidates} |`);
  out(`| — with scores (NCS) | ${scoredCandidates} |`);
  out(`| — enriched with forward returns | ${enrichedCandidates} |`);
  out(`| — became actual trades | ${tradePlacedCandidates} |`);
  out(`| Positions (all) | ${totalPositions} |`);
  out(`| Closed positions | ${closedPositions} |`);
  out(`| — with R-multiple data | ${closedWithR} |`);
  out(`| Equity snapshots | ${equitySnaps} |`);
  out('');

  const enrichPct = totalCandidates > 0 ? (enrichedCandidates / totalCandidates) * 100 : 0;
  if (enrichedCandidates === 0)
    flag('RED', 'Zero enriched candidate outcomes — forward-return enrichment job has never populated data. Score/filter analytics below are structurally empty.');
  else if (enrichPct < 25)
    flag('AMBER', `Only ${enrichPct.toFixed(0)}% of candidate outcomes are enriched — most rows too recent to have forward returns yet.`);
  if (closedWithR < 10)
    flag('AMBER', `Only ${closedWithR} closed trades with R data — below the 10-trade floor for any P&L grade.`);
  else if (closedWithR < 30)
    flag('AMBER', `${closedWithR} closed trades — preliminary; need ≥30 for reliable P&L conclusions.`);

  // Data-integrity: candidate→trade linkage. If trades exist but no outcome row
  // is marked tradePlaced, the research dataset cannot attribute which scanned
  // candidates actually became trades — breaks converted-vs-skipped analysis.
  if (totalPositions > 0 && tradePlacedCandidates === 0)
    flag('AMBER', `${totalPositions} positions exist but 0 candidate-outcome rows are marked tradePlaced — the candidate→trade linkage is not being written, so "did our picks convert?" cannot be measured.`);

  // ── 2. Profit scoreboard ─────────────────────────────────────────
  out('---');
  out('');
  out('## 2. Profit Scoreboard (live P&L edge)');
  out('');
  let grade = '—';
  try {
    const sb = await computeProfitScoreboard(primaryUser);
    grade = sb.grade;
    out(`**System grade: ${sb.grade}** — ${sb.gradeReason}`);
    out('');
    if (sb.sampleSizeWarning) out(`> ${sb.sampleSizeWarning}`);
    out('');
    out('| Metric | Value |');
    out('|--------|-------|');
    out(`| Closed trades (with R) | ${sb.totalClosedTrades} |`);
    out(`| Total realised R | ${num(sb.totalRealisedR)} |`);
    out(`| Expectancy / trade | ${num(sb.expectancyPerTrade)}R |`);
    out(`| Win rate | ${pct(sb.winRate * 100)} (${sb.winCount}W / ${sb.lossCount}L) |`);
    out(`| Avg win / avg loss | ${num(sb.avgWinR)}R / ${num(sb.avgLossR)}R |`);
    out(`| Profit factor | ${num(sb.profitFactor)} |`);
    out(`| Max drawdown | ${pct(sb.maxDrawdownPct)} |`);
    out(`| Current drawdown | ${pct(sb.currentDrawdownPct)} |`);
    out(`| Avg / median hold | ${num(sb.avgHoldDays, 1)}d / ${sb.medianHoldDays ?? '—'}d |`);
    out('');

    if (sb.totalClosedTrades >= 10) {
      if (sb.expectancyPerTrade <= -0.1)
        flag('RED', `Negative expectancy (${sb.expectancyPerTrade.toFixed(2)}R) over ${sb.totalClosedTrades} trades — system is losing.`);
      else if (sb.expectancyPerTrade <= 0)
        flag('AMBER', `Flat/negative expectancy (${sb.expectancyPerTrade.toFixed(2)}R) — no proven edge yet.`);
      else
        flag('GREEN', `Positive expectancy (${sb.expectancyPerTrade.toFixed(2)}R) over ${sb.totalClosedTrades} trades.`);
      if (sb.maxDrawdownPct > 20)
        flag('RED', `Max drawdown ${sb.maxDrawdownPct.toFixed(1)}% exceeds 20% risk ceiling.`);
    }
  } catch (e) {
    out(`_Scoreboard failed: ${(e as Error).message}_`);
    flag('AMBER', `Profit scoreboard errored: ${(e as Error).message}`);
  }

  // ── 3. Score validation (monotonicity) ───────────────────────────
  out('---');
  out('');
  out('## 3. Do Scores Predict Outcomes? (monotonicity)');
  out('');
  try {
    const sv = await generateScoreValidation();
    out(`Candidates scored: ${sv.totalWithScores} | enriched: ${sv.totalEnriched}`);
    out('');
    out('| Score | Metric | Direction | Values across bands | Monotonic | Violations |');
    out('|-------|--------|-----------|--------------------|-----------|-----------|');
    for (const m of sv.monotonicity) {
      const vals = m.values.map((v) => (v == null ? '—' : v.toFixed(1))).join(' → ');
      out(`| ${m.score} | ${m.metric} | ${m.direction} | ${vals} | ${m.isMonotonic ? '✓' : '✗'} | ${m.violations} |`);
    }
    out('');
    if (sv.totalEnriched === 0) {
      flag('RED', 'Score validation has no enriched rows — cannot test whether NCS/FWS/BQS predict anything.');
    } else {
      const informative = sv.monotonicity.filter((m) => m.values.some((v) => v != null));
      const clean = informative.filter((m) => m.isMonotonic);
      out(`**Predictive summary:** ${clean.length}/${informative.length} tested relationships are monotonic (score → outcome).`);
      out('');
      for (const m of informative) out(`- ${m.score} vs ${m.metric}: ${m.interpretation}`);
      out('');
      const ncsFwd = informative.find((m) => m.score === 'NCS' && m.metric.includes('20d'));
      if (ncsFwd && !ncsFwd.isMonotonic && ncsFwd.violations >= 2)
        flag('RED', 'NCS does NOT monotonically predict 20d forward return — core ranking score may not be adding edge.');
      if (informative.length > 0 && clean.length === 0)
        flag('RED', 'No score/outcome relationship is monotonic — scoring layer is not (yet) predictive on this data.');
    }
  } catch (e) {
    out(`_Score validation failed: ${(e as Error).message}_`);
    flag('AMBER', `Score validation errored: ${(e as Error).message}`);
  }

  // ── 4. Filter scorecard ──────────────────────────────────────────
  out('---');
  out('');
  out('## 4. Filter / Gate Scorecard (edge per rule)');
  out('');
  try {
    const fs2 = await generateFilterScorecard();
    out(`Candidates: ${fs2.totalCandidates} | enriched: ${fs2.totalEnriched}`);
    out('');
    out('| Rule | Pass rate | Passed 20d | Blocked 20d | Passed 1R% | Blocked 1R% |');
    out('|------|-----------|-----------|------------|-----------|------------|');
    for (const f of fs2.filters) {
      out(`| ${f.rule} | ${pct(f.passRate)} | ${num(f.passed.avgFwd20d)} | ${num(f.blocked.avgFwd20d)} | ${pct(f.passed.hit1RRate)} | ${pct(f.blocked.hit1RRate)} |`);
    }
    out('');
    out('> ⚠ **Read raw 20d return with care.** During a bull tape it is dominated by');
    out('> high-ATR "junk" names that this system deliberately avoids (note the ATR%<8');
    out('> rule below). For a trend system the risk-adjusted signal — **1R hit rate** and');
    out('> stop-hit rate — is the honest test. A filter is only genuinely suspect when it');
    out('> is inverted on *both* raw return AND 1R hit rate.');
    out('');
    if (fs2.totalEnriched > 0) {
      for (const f of fs2.filters) {
        const p = f.passed.avgFwd20d;
        const b = f.blocked.avgFwd20d;
        const p1 = f.passed.hit1RRate;
        const b1 = f.blocked.hit1RRate;
        const bigSample = f.passed.withOutcomes >= 10 && f.blocked.withOutcomes >= 10;
        // Only a real concern when the rule underperforms on the risk-adjusted
        // metric too. Raw-return-only inversion is the bull-tape ATR artifact.
        if (bigSample && p != null && b != null && p < b && p1 != null && b1 != null && p1 < b1)
          flag('AMBER', `Filter "${f.rule}" underperforms on BOTH raw 20d return (${p.toFixed(2)} < ${b.toFixed(2)}) AND 1R hit rate (${p1.toFixed(1)}% < ${b1.toFixed(1)}%) — genuinely worth investigating.`);
      }
    }
  } catch (e) {
    out(`_Filter scorecard failed: ${(e as Error).message}_`);
    flag('AMBER', `Filter scorecard errored: ${(e as Error).message}`);
  }

  // ── 5. Evidence framework (rule contribution) ────────────────────
  out('---');
  out('');
  out('## 5. Evidence Framework (rule contribution to expectancy)');
  out('');
  try {
    const ev = await generateEvidence();
    out(`Sample — candidates: ${ev.sampleSize.totalCandidates}, enriched: ${ev.sampleSize.enrichedCandidates}, trades: ${ev.sampleSize.totalTrades}, closed: ${ev.sampleSize.closedTrades}`);
    out('');
    if (ev.warnings.length) {
      for (const w of ev.warnings) out(`> ⚠ ${w}`);
      out('');
    }
    out('| Rule | Edge (20d, passed−blocked) | Edge (1R rate) |');
    out('|------|---------------------------|----------------|');
    for (const r of ev.ruleContribution) {
      out(`| ${r.rule} | ${num(r.edgeFwd20d)} | ${r.edge1RRate == null ? '—' : r.edge1RRate.toFixed(1) + 'pp'} |`);
    }
    out('');
    if (ev.exitPerformance.length) {
      out('**Exit performance:**');
      out('');
      out('| Exit category | Count | Avg R | Win rate |');
      out('|---------------|-------|-------|----------|');
      for (const x of ev.exitPerformance)
        out(`| ${x.exitCategory} | ${x.count} | ${num(x.avgR)} | ${pct(x.winRate)} |`);
      out('');
    }
    const simsWithTrades = ev.simulations.filter((s) => s.trades > 0).length;
    if (ev.sampleSize.closedTrades > 0 && ev.simulations.length > 0 && simsWithTrades === 0)
      flag('AMBER', `Evidence-framework simulations returned 0 trades despite ${ev.sampleSize.closedTrades} closed trades — the simulation input feed (closed trades with R) is not wired, so the small-account projections are empty.`);
    if (ev.simulations.length) {
      out('**Small-account simulations:**');
      out('');
      out('| Scenario | Trades | Win% | Avg R | Total R | Max DD (R) | Return% |');
      out('|----------|--------|------|-------|---------|-----------|---------|');
      for (const s of ev.simulations)
        out(`| ${s.name} | ${s.trades} | ${pct(s.winRate)} | ${num(s.avgR)} | ${num(s.totalR)} | ${num(s.maxDrawdownR)} | ${pct(s.returnPct)} |`);
      out('');
    }
  } catch (e) {
    out(`_Evidence framework failed: ${(e as Error).message}_`);
    flag('AMBER', `Evidence framework errored: ${(e as Error).message}`);
  }

  // ── 6. Verdict ───────────────────────────────────────────────────
  out('---');
  out('');
  out('## 6. Audit Verdict & Flags');
  out('');
  const reds = flags.filter((f) => f.severity === 'RED');
  const ambers = flags.filter((f) => f.severity === 'AMBER');
  const greens = flags.filter((f) => f.severity === 'GREEN');
  out(`**System grade (P&L): ${grade}** | 🔴 ${reds.length} red · 🟠 ${ambers.length} amber · 🟢 ${greens.length} green`);
  out('');
  for (const f of reds) out(`- 🔴 ${f.text}`);
  for (const f of ambers) out(`- 🟠 ${f.text}`);
  for (const f of greens) out(`- 🟢 ${f.text}`);
  out('');

  const verdict =
    reds.length === 0 && enrichedCandidates > 0 && closedWithR >= 10
      ? 'Data is sufficient and no red flags — edge review is meaningful.'
      : enrichedCandidates === 0 || closedWithR < 10
        ? 'INSUFFICIENT DATA — the learning pipeline has not yet accumulated enough enriched outcomes/closed trades to draw statistical conclusions. Priorities: (a) verify the forward-return enrichment batch job is running; (b) keep trading to reach ≥30 closed trades.'
        : 'Red flags present — review the items above before trusting the edge.';
  out(`**Verdict:** ${verdict}`);
  out('');

  // ── Write report ─────────────────────────────────────────────────
  const reportsDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, 'historical-data-audit.md');
  fs.writeFileSync(outPath, L.join('\n'), 'utf-8');

  // ── Console summary ──────────────────────────────────────────────
  console.log('');
  console.log('  Historical Data Audit complete');
  console.log(`    Data span:        ${spanDays} days`);
  console.log(`    Candidate rows:   ${totalCandidates} (enriched ${enrichedCandidates})`);
  console.log(`    Closed trades:    ${closedWithR} with R data`);
  console.log(`    P&L grade:        ${grade}`);
  console.log(`    Flags:            ${reds.length} red / ${ambers.length} amber / ${greens.length} green`);
  console.log(`    Report:           ${path.relative(ROOT, outPath)}`);
  console.log('');
  for (const f of reds) console.log(`    🔴 ${f.text}`);
  console.log('');
  console.log(`  Verdict: ${verdict}`);
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[audit-historical-data] FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
