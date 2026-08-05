/**
 * Calibrate Danger Score
 *
 * Offline, read-only. Replays the threat-library danger score over ~10 years of
 * real ^VIX and SPY history and asks one question:
 *
 *   Does the danger score actually separate crisis days from calm days?
 *
 * GATE: crisis median must exceed the calm 95th percentile. If it does not, the
 * navbar danger badge is decorative and must not be given any further weight.
 *
 * Runs the same replay twice — once with the pre-fix realised-vol range
 * ({min: 0.3, max: 5}, which pinned every live value at 1.0) and once with the
 * corrected range — so the effect of the Phase 1 fix is measurable rather than
 * assumed.
 *
 * LIMITATIONS (stated, not hidden):
 *   - drsScore, averagePortfolioCorrelation and daysInCurrentRegime are held at
 *     buildCurrentEnvironment's fallback defaults (50 / 0.3 / 5). Historical
 *     values for those are not reconstructable from price data alone, so 3 of
 *     the 7 dimensions are constant across every date in this replay. That makes
 *     this a test of the VIX/SPY dimensions only.
 *   - Does NOT use getDailyPrices (400-day cap). Calls yahoo-finance2 directly.
 *
 * Usage:
 *   npx tsx scripts/calibrate-danger-score.ts
 */
process.env.HYBRIDTURTLE_SKIP_STARTUP_PRECACHE = 'true';

import 'dotenv/config';
import YahooFinance from 'yahoo-finance2';
import { FEATURE_RANGES, type MarketEnvironment } from '../src/lib/prediction/environment-encoder';
import { BOOTSTRAP_THREATS, type ThreatEntry } from '../src/lib/prediction/threat-library';
import { computeDangerScore } from '../src/lib/prediction/danger-matcher';

const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => typeof YahooFinance)({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

const START_DATE = '2015-01-01';

/** Crisis anchor dates. Each defines a window of +/- CRISIS_WINDOW trading days. */
const CRISIS_DATES = [
  '2015-08-24', // China devaluation flash crash
  '2018-02-05', // Volmageddon
  '2018-12-24', // Fed tightening selloff trough
  '2020-03-16', // COVID crash
  '2022-10-13', // Rate shock CPI reversal
];
const CRISIS_WINDOW = 5;   // trading days either side counted as crisis
const CALM_EXCLUSION = 20; // trading days either side excluded from the calm set

/** Pre-Phase-1 realised-vol range and bootstrap values, for the before/after comparison. */
const LEGACY_VOL_RANGE = { min: 0.3, max: 5 };
const LEGACY_BOOTSTRAP_VOLS = [4.5, 3.0, 2.5, 2.8, 2.0];

// ── Encoding ─────────────────────────────────────────────────

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** Mirrors encodeEnvironment, but with a swappable realised-vol range. */
function encodeWith(env: MarketEnvironment, volRange: { min: number; max: number }): number[] {
  const ranges = FEATURE_RANGES.map((r, i) => (i === 3 ? volRange : r));
  const raw = [
    env.vix,
    env.vixChange5d,
    env.spyMomentum20d,
    env.spyVolatilityRealised10d,
    env.drsScore,
    env.averagePortfolioCorrelation,
    env.daysInCurrentRegime,
  ];
  return raw.map((v, i) => normalise(v, ranges[i].min, ranges[i].max));
}

function buildThreats(legacy: boolean): ThreatEntry[] {
  const volRange = legacy ? LEGACY_VOL_RANGE : FEATURE_RANGES[3];
  return BOOTSTRAP_THREATS.map((t, i) => {
    const env: MarketEnvironment = legacy
      ? { ...t.environment, spyVolatilityRealised10d: LEGACY_BOOTSTRAP_VOLS[i] }
      : t.environment;
    return {
      id: i,
      label: t.label,
      vector: encodeWith(env, volRange),
      severity: t.severity,
      source: t.source,
      createdAt: new Date(),
    };
  });
}

// ── Data ─────────────────────────────────────────────────────

interface Bar { date: string; close: number }

async function fetchDaily(symbol: string): Promise<Bar[]> {
  const period2 = new Date();
  period2.setDate(period2.getDate() + 1);
  const result = (await yf.chart(symbol, {
    period1: START_DATE,
    period2: period2.toISOString().split('T')[0],
    interval: '1d',
  })) as { quotes?: Array<{ date: Date | string; close: number | null }> };

  return (result.quotes ?? [])
    .filter(q => q.close != null)
    .map(q => ({ date: new Date(q.date).toISOString().split('T')[0], close: q.close as number }))
    .sort((a, b) => a.date.localeCompare(b.date)); // oldest first
}

// ── Stats ────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function describe(label: string, values: number[]): void {
  const s = [...values].sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(18)} n=${String(s.length).padStart(5)}  ` +
    `min=${percentile(s, 0).toFixed(1).padStart(5)}  ` +
    `p25=${percentile(s, 25).toFixed(1).padStart(5)}  ` +
    `median=${percentile(s, 50).toFixed(1).padStart(5)}  ` +
    `p95=${percentile(s, 95).toFixed(1).padStart(5)}  ` +
    `max=${percentile(s, 100).toFixed(1).padStart(5)}`
  );
}

/**
 * Rank-based separation: probability a randomly chosen crisis day scores above a
 * randomly chosen calm day. 0.5 = no separation, 1.0 = perfect. Scale-free, so it
 * is comparable across scorers with different ranges (danger score vs raw VIX).
 */
function auc(positives: number[], negatives: number[]): number {
  if (positives.length === 0 || negatives.length === 0) return NaN;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p > n) wins += 1;
      else if (p === n) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

// ── Replay ───────────────────────────────────────────────────

interface Scored { date: string; env: MarketEnvironment; legacy: number; current: number }

function replay(spy: Bar[], vixByDate: Map<string, number>): Scored[] {
  const legacyThreats = buildThreats(true);
  const currentThreats = buildThreats(false);
  const out: Scored[] = [];

  for (let i = 20; i < spy.length; i++) {
    const date = spy[i].date;
    const vix = vixByDate.get(date);
    const vix5 = vixByDate.get(spy[i - 5].date);
    if (vix == null || vix5 == null || vix5 <= 0) continue;

    const spy20 = spy[i - 20].close;
    const momentum20d = spy20 > 0 ? ((spy[i].close - spy20) / spy20) * 100 : 0;

    // 10-day realised vol, annualised — matches buildCurrentEnvironment exactly
    // (population variance, log returns, sqrt(var * 252) * 100)
    const returns: number[] = [];
    for (let k = 0; k < 10; k++) {
      returns.push(Math.log(spy[i - k].close / spy[i - k - 1].close));
    }
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const realisedVol = Math.sqrt(variance * 252) * 100;

    const env: MarketEnvironment = {
      vix,
      vixChange5d: ((vix - vix5) / vix5) * 100,
      spyMomentum20d: momentum20d,
      spyVolatilityRealised10d: realisedVol,
      drsScore: 50,                    // default — not reconstructable
      averagePortfolioCorrelation: 0.3, // default — not reconstructable
      daysInCurrentRegime: 5,           // default — not reconstructable
    };

    out.push({
      date,
      env,
      legacy: computeDangerScore(encodeWith(env, LEGACY_VOL_RANGE), legacyThreats).dangerScore,
      current: computeDangerScore(encodeWith(env, FEATURE_RANGES[3]), currentThreats).dangerScore,
    });
  }

  return out;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`\nFetching ^VIX and SPY daily bars from ${START_DATE}...`);
  const [vixBars, spyBars] = await Promise.all([fetchDaily('^VIX'), fetchDaily('SPY')]);
  console.log(`  ^VIX: ${vixBars.length} bars   SPY: ${spyBars.length} bars`);

  const vixByDate = new Map(vixBars.map(b => [b.date, b.close]));
  const scored = replay(spyBars, vixByDate);
  console.log(`  Scored ${scored.length} dates (${scored[0]?.date} → ${scored[scored.length - 1]?.date})`);

  // Classify by distance in trading days from any crisis anchor
  const indexByDate = new Map(scored.map((s, i) => [s.date, i]));
  const anchors: number[] = [];
  for (const d of CRISIS_DATES) {
    // Anchor may fall on a non-trading day — take the first scored date >= d
    const hit = indexByDate.get(d) ?? scored.findIndex(s => s.date >= d);
    if (hit >= 0) anchors.push(hit);
    else console.log(`  ⚠  crisis anchor ${d} not found in scored range`);
  }

  const crisis: Scored[] = [];
  const calm: Scored[] = [];
  for (let i = 0; i < scored.length; i++) {
    const dist = Math.min(...anchors.map(a => Math.abs(i - a)));
    if (dist <= CRISIS_WINDOW) crisis.push(scored[i]);
    else if (dist > CALM_EXCLUSION) calm.push(scored[i]);
  }

  for (const [name, pick] of [
    ['BEFORE Phase 1 (vol range 0.3–5)', (s: Scored) => s.legacy],
    ['AFTER  Phase 1 (vol range 5–90)', (s: Scored) => s.current],
  ] as const) {
    const all = scored.map(pick);
    const crisisVals = crisis.map(pick);
    const calmVals = calm.map(pick);

    console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 44 - name.length))}`);
    describe('all days', all);
    describe('crisis windows', crisisVals);
    describe('calm days', calmVals);

    const crisisMedian = percentile([...crisisVals].sort((a, b) => a - b), 50);
    const calmP95 = percentile([...calmVals].sort((a, b) => a - b), 95);
    const pass = crisisMedian > calmP95;
    console.log(
      `  GATE  crisis median ${crisisMedian.toFixed(1)} vs calm p95 ${calmP95.toFixed(1)}  →  ` +
      `${pass ? 'PASS' : 'FAIL'}`
    );
  }

  console.log(`\n── Crisis anchor dates ────────────────────────────────`);
  console.log(`  ${'date'.padEnd(12)} ${'vix'.padStart(6)} ${'vixΔ5d'.padStart(8)} ` +
    `${'mom20d'.padStart(8)} ${'rvol'.padStart(7)} ${'before'.padStart(7)} ${'after'.padStart(7)}`);
  for (const a of anchors) {
    const s = scored[a];
    console.log(
      `  ${s.date.padEnd(12)} ${s.env.vix.toFixed(1).padStart(6)} ` +
      `${s.env.vixChange5d.toFixed(1).padStart(8)} ${s.env.spyMomentum20d.toFixed(1).padStart(8)} ` +
      `${s.env.spyVolatilityRealised10d.toFixed(1).padStart(7)} ` +
      `${String(s.legacy).padStart(7)} ${String(s.current).padStart(7)}`
    );
  }

  console.log(
    `\nNOTE: drsScore, correlation and daysInRegime were constant across all dates.\n` +
    `      This measures the VIX/SPY dimensions only.\n`
  );

  // ── Matched controls ───────────────────────────────────────
  // A gate that only compares the score against itself cannot tell whether the
  // 7-dimension cosine machinery earns its keep. These controls are the cheapest
  // things it must beat: the single raw inputs it is mostly built from.
  console.log(`── Matched controls (rank separation, crisis vs calm) ─`);
  const controls: Array<[string, (s: Scored) => number]> = [
    ['danger score BEFORE', s => s.legacy],
    ['danger score AFTER', s => s.current],
    ['raw VIX', s => s.env.vix],
    ['raw realised vol', s => s.env.spyVolatilityRealised10d],
    ['raw VIX 5d change', s => s.env.vixChange5d],
    ['negated 20d momentum', s => -s.env.spyMomentum20d],
  ];
  const aucs = controls.map(([label, pick]) => {
    const a = auc(crisis.map(pick), calm.map(pick));
    console.log(`  ${label.padEnd(22)} AUC = ${a.toFixed(3)}`);
    return { label, auc: a };
  });

  // The gate must be against the STRONGEST single-input control, not a
  // conveniently weak one. Beating raw VIX while losing to raw momentum is a
  // null, not a pass.
  const dangerAuc = aucs.find(x => x.label === 'danger score AFTER')!.auc;
  const best = aucs
    .filter(x => x.label.startsWith('raw') || x.label.startsWith('negated'))
    .reduce((a, b) => (b.auc > a.auc ? b : a));

  console.log(
    `\n  CONTROL GATE  danger score (${dangerAuc.toFixed(3)}) vs strongest single input\n` +
    `                ${best.label} (${best.auc.toFixed(3)})  \u2192  ` +
    `${dangerAuc > best.auc
      ? 'PASS'
      : 'FAIL \u2014 the 7-dim cosine adds nothing over its best single component'}\n`
  );

  // ── Variance risk premium ───────────────────────────────────
  // VIX (30-day implied) minus SPY 10-day trailing realised vol, both annualised %.
  // Horizon mismatch is acknowledged: this is the realised-vol series the encoder
  // already computes, not a matched 30-day window. Thresholds below are measured
  // from this distribution so Phase 3 does not invent them.
  const vrp = scored.map(s => s.env.vix - s.env.spyVolatilityRealised10d);
  const vrpSorted = [...vrp].sort((a, b) => a - b);
  console.log(`── Variance risk premium (VIX − SPY 10d realised) ──`);
  describe('all days', vrp);
  for (const p of [1, 5, 10, 25, 50, 75, 90, 95, 99]) {
    console.log(`  p${String(p).padEnd(3)} = ${percentile(vrpSorted, p).toFixed(2)}`);
  }
  const inverted = vrp.filter(v => v < 0).length;
  console.log(
    `  mean = ${(vrp.reduce((s, v) => s + v, 0) / vrp.length).toFixed(2)}   ` +
    `inverted (< 0) on ${inverted}/${vrp.length} days (${((inverted / vrp.length) * 100).toFixed(1)}%)`
  );
  console.log(`  at crisis anchors:`);
  for (const a of anchors) {
    const s = scored[a];
    console.log(`    ${s.date}  ${(s.env.vix - s.env.spyVolatilityRealised10d).toFixed(2)}`);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[calibrate-danger-score]', err);
    process.exit(1);
  });
