/**
 * Audit: Regime Detector VIX Signal
 *
 * READ-ONLY. Does NOT modify src/lib/regime-detector.ts (sacred file).
 *
 * detectRegime Signal 4 reads the VIX LEVEL only:
 *   VIX < 20  → +1 bull ("calm market")
 *   VIX >= 30 → +1 bear ("fear")
 *   otherwise → neutral
 *
 * There is no rate-of-change term. On 2 Feb 2018 the VIX closed at 17.3 — Signal 4
 * would have scored that as calm. Two sessions later it closed above 37. This
 * script measures how often that pattern occurs: days scored "calm" that were
 * immediately followed by a violent VIX expansion.
 *
 * Output is evidence only. Any change to the regime detector is a separate,
 * separately-escalated task.
 *
 * Usage:
 *   npx tsx scripts/audit-regime-vix-signal.ts
 */
process.env.HYBRIDTURTLE_SKIP_STARTUP_PRECACHE = 'true';

import 'dotenv/config';
import YahooFinance from 'yahoo-finance2';
import { detectRegime } from '../src/lib/regime-detector';

const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => typeof YahooFinance)({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

const START_DATE = '2015-01-01';
const LOOKAHEAD_DAYS = 5;
const SPIKE_THRESHOLD_PCT = 50;

interface Bar { date: string; close: number }

async function fetchVix(): Promise<Bar[]> {
  const period2 = new Date();
  period2.setDate(period2.getDate() + 1);
  const result = (await yf.chart('^VIX', {
    period1: START_DATE,
    period2: period2.toISOString().split('T')[0],
    interval: '1d',
  })) as { quotes?: Array<{ date: Date | string; close: number | null }> };

  return (result.quotes ?? [])
    .filter(q => q.close != null)
    .map(q => ({ date: new Date(q.date).toISOString().split('T')[0], close: q.close as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Extract Signal 4's verdict from the real detectRegime, rather than
 * re-implementing it here. Non-VIX inputs are held neutral and the price is set
 * clear of the CHOP band so the function reaches the signal-scoring section.
 */
function vixSignalVerdict(vixLevel: number): 'bull' | 'bear' | 'neutral' {
  const { reasons } = detectRegime({
    spyPrice: 500,
    spy200MA: 400,   // well outside the ±2% CHOP band
    spyAdx: 20,      // below the ADX 25 threshold — Signal 2 stays silent
    spyPlusDI: 25,
    spyMinusDI: 25,
    vixLevel,
    advanceDeclineRatio: 1.0, // inside the 0.8–1.2 neutral band
  });
  const line = reasons.find(r => r.startsWith('VIX ')) ?? '';
  if (line.includes('+1 bull')) return 'bull';
  if (line.includes('+1 bear')) return 'bear';
  return 'neutral';
}

async function main() {
  console.log(`\nFetching ^VIX from ${START_DATE}...`);
  const vix = await fetchVix();
  console.log(`  ${vix.length} bars (${vix[0]?.date} → ${vix[vix.length - 1]?.date})\n`);

  const counts = { bull: 0, bear: 0, neutral: 0 };
  const missed: Array<{ date: string; vix: number; peak: number; peakDate: string; risePct: number }> = [];
  let spikeCount = 0;

  for (let i = 0; i < vix.length - LOOKAHEAD_DAYS; i++) {
    const verdict = vixSignalVerdict(vix[i].close);
    counts[verdict] += 1;

    const window = vix.slice(i + 1, i + 1 + LOOKAHEAD_DAYS);
    let peak = window[0];
    for (const b of window) if (b.close > peak.close) peak = b;
    const risePct = ((peak.close - vix[i].close) / vix[i].close) * 100;

    if (risePct > SPIKE_THRESHOLD_PCT) {
      spikeCount += 1;
      if (verdict === 'bull') {
        missed.push({
          date: vix[i].date,
          vix: vix[i].close,
          peak: peak.close,
          peakDate: peak.date,
          risePct,
        });
      }
    }
  }

  const scored = counts.bull + counts.bear + counts.neutral;
  console.log(`── Signal 4 verdicts across ${scored} days ────────────`);
  console.log(`  +1 bull  (VIX < 20):  ${counts.bull} (${((counts.bull / scored) * 100).toFixed(1)}%)`);
  console.log(`  neutral  (20–30):     ${counts.neutral} (${((counts.neutral / scored) * 100).toFixed(1)}%)`);
  console.log(`  +1 bear  (VIX >= 30): ${counts.bear} (${((counts.bear / scored) * 100).toFixed(1)}%)`);

  console.log(
    `\n── Days scored "calm" immediately before a VIX spike ──\n` +
    `   (spike = VIX rises >${SPIKE_THRESHOLD_PCT}% within ${LOOKAHEAD_DAYS} trading days)\n`
  );
  console.log(`  Total spike setups in period:      ${spikeCount}`);
  console.log(`  ...of which scored +1 bull (calm): ${missed.length}` +
    (spikeCount > 0 ? ` (${((missed.length / spikeCount) * 100).toFixed(1)}%)` : ''));
  console.log(`  Share of all "calm" days that preceded a spike: ` +
    `${counts.bull > 0 ? ((missed.length / counts.bull) * 100).toFixed(2) : '0'}%`);

  if (missed.length > 0) {
    console.log(`\n  ${'date'.padEnd(12)} ${'VIX'.padStart(6)} → ${'peak'.padStart(6)} ${'on'.padEnd(12)} ${'rise'.padStart(8)}`);
    for (const m of missed) {
      console.log(
        `  ${m.date.padEnd(12)} ${m.vix.toFixed(1).padStart(6)} → ` +
        `${m.peak.toFixed(1).padStart(6)} ${m.peakDate.padEnd(12)} ${(m.risePct.toFixed(0) + '%').padStart(8)}`
      );
    }
  }

  console.log(
    `\nEVIDENCE ONLY. src/lib/regime-detector.ts is a sacred file and was not\n` +
    `modified. Signal 4 was evaluated through the real detectRegime with all\n` +
    `non-VIX inputs held neutral, so this measures that signal in isolation —\n` +
    `not the composite regime verdict.\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[audit-regime-vix-signal]', err);
    process.exit(1);
  });
