/**
 * System Heat — pure computation logic.
 * Advisory-only: no execution effect whatsoever.
 */

export interface RegimeRow {
  date: Date;
  regime: string;
}

export interface EquitySnap {
  capturedAt: Date;
  openRiskPercent: number | null;
}

export interface TradeRow {
  tradeDate: Date;
  regime: string | null;
}

export interface SystemHeatInput {
  maxRiskPct: number;
  maxPositions: number;
  regimeRows: RegimeRow[];
  equitySnapshots: EquitySnap[];
  tradeLogs: TradeRow[];
  openPositionCount: number;
}

export type HeatStatus = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';

export interface SystemHeatResult {
  status: HeatStatus;
  avgRiskUtilBullishPct: number | null;
  avgTradesPerMonth: Record<string, number>;
  pctBullishWeeksWellFilled: number | null;
  coldStreakWeeks: number;
  currentPositionUtil: number;
  currentPositions: number;
  maxPositions: number;
  maxRiskPct: number;
  bullishWeeksInWindow: number;
  dataPoints: number;
}

export function startOfWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday start
  const start = new Date(d);
  start.setUTCDate(diff);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function weekKey(d: Date): string {
  const ws = startOfWeek(d);
  return ws.toISOString().slice(0, 10);
}

export function computeSystemHeat(input: SystemHeatInput): SystemHeatResult {
  const { maxRiskPct, maxPositions, regimeRows, equitySnapshots, tradeLogs, openPositionCount } = input;

  // ── Build weekly regime map ──
  const weekRegimeVotes: Record<string, Record<string, number>> = {};
  for (const r of regimeRows) {
    const wk = weekKey(r.date);
    if (!weekRegimeVotes[wk]) weekRegimeVotes[wk] = {};
    weekRegimeVotes[wk][r.regime] = (weekRegimeVotes[wk][r.regime] || 0) + 1;
  }

  const weekRegime: Record<string, string> = {};
  for (const [wk, votes] of Object.entries(weekRegimeVotes)) {
    let best = 'SIDEWAYS';
    let bestCount = 0;
    for (const [regime, count] of Object.entries(votes)) {
      if (count > bestCount) {
        best = regime;
        bestCount = count;
      }
    }
    weekRegime[wk] = best;
  }

  // ── Build weekly risk utilisation from equity snapshots ──
  const weekRiskSamples: Record<string, number[]> = {};
  for (const snap of equitySnapshots) {
    if (snap.openRiskPercent == null) continue;
    const wk = weekKey(snap.capturedAt);
    if (!weekRiskSamples[wk]) weekRiskSamples[wk] = [];
    weekRiskSamples[wk].push(snap.openRiskPercent);
  }

  // ── Compute per-week buckets ──
  const allWeeks = Array.from(new Set([...Object.keys(weekRegime), ...Object.keys(weekRiskSamples)])).sort();

  interface WeekBucket {
    weekStart: Date;
    regime: string;
    avgOpenRiskPercent: number;
    maxRiskPercent: number;
  }

  const weekBuckets: WeekBucket[] = allWeeks.map((wk) => {
    const regime = weekRegime[wk] || 'SIDEWAYS';
    const riskSamples = weekRiskSamples[wk] || [];
    const avgRisk = riskSamples.length > 0
      ? riskSamples.reduce((a, b) => a + b, 0) / riskSamples.length
      : 0;

    return {
      weekStart: new Date(wk),
      regime,
      avgOpenRiskPercent: avgRisk,
      maxRiskPercent: maxRiskPct,
    };
  });

  // ── Count trades per month by regime ──
  const monthTradeCounts: Record<string, Record<string, number>> = {};
  for (const t of tradeLogs) {
    const month = t.tradeDate.toISOString().slice(0, 7);
    const regime = t.regime || 'UNKNOWN';
    if (!monthTradeCounts[month]) monthTradeCounts[month] = {};
    monthTradeCounts[month][regime] = (monthTradeCounts[month][regime] || 0) + 1;
  }

  const months = Object.keys(monthTradeCounts).sort();
  const regimeTradesPerMonth: Record<string, number> = { BULLISH: 0, SIDEWAYS: 0, BEARISH: 0 };
  const regimeMonthCounts: Record<string, number> = { BULLISH: 0, SIDEWAYS: 0, BEARISH: 0 };
  for (const month of months) {
    const counts = monthTradeCounts[month];
    for (const regime of ['BULLISH', 'SIDEWAYS', 'BEARISH']) {
      if (counts[regime]) {
        regimeTradesPerMonth[regime] += counts[regime];
        regimeMonthCounts[regime] += 1;
      }
    }
  }

  const avgTradesPerMonth: Record<string, number> = {};
  for (const regime of ['BULLISH', 'SIDEWAYS', 'BEARISH']) {
    avgTradesPerMonth[regime] = regimeMonthCounts[regime] > 0
      ? Math.round((regimeTradesPerMonth[regime] / regimeMonthCounts[regime]) * 10) / 10
      : 0;
  }

  // ── Rolling 4-week bullish risk utilisation ──
  const recentBullishWeeks = weekBuckets
    .filter((wb) => wb.regime === 'BULLISH')
    .slice(-4);

  const avgRiskUtilBullish = recentBullishWeeks.length > 0
    ? recentBullishWeeks.reduce((sum, wb) => {
        const util = wb.maxRiskPercent > 0
          ? (wb.avgOpenRiskPercent / wb.maxRiskPercent) * 100
          : 0;
        return sum + util;
      }, 0) / recentBullishWeeks.length
    : null;

  // ── % of bullish weeks with >= 60% positions filled ──
  const bullishWeeks = weekBuckets.filter((wb) => wb.regime === 'BULLISH');
  const wellFilledBullishWeeks = bullishWeeks.filter((wb) => {
    const util = wb.maxRiskPercent > 0
      ? (wb.avgOpenRiskPercent / wb.maxRiskPercent) * 100
      : 0;
    return util >= 60;
  });
  const pctBullishWeeksWellFilled = bullishWeeks.length > 0
    ? Math.round((wellFilledBullishWeeks.length / bullishWeeks.length) * 100)
    : null;

  // ── Current streak of consecutive bullish weeks with < 50% risk deployment ──
  const reversedBullish = [...weekBuckets].reverse().filter((wb) => wb.regime === 'BULLISH');
  let coldStreak = 0;
  for (const wb of reversedBullish) {
    const util = wb.maxRiskPercent > 0
      ? (wb.avgOpenRiskPercent / wb.maxRiskPercent) * 100
      : 0;
    if (util < 50) {
      coldStreak++;
    } else {
      break;
    }
  }

  // ── Traffic light ──
  let status: HeatStatus = 'NO_DATA';
  if (avgRiskUtilBullish !== null) {
    if (avgRiskUtilBullish >= 60) status = 'GREEN';
    else if (avgRiskUtilBullish >= 30) status = 'AMBER';
    else status = 'RED';
  }

  const currentRiskUtil = maxPositions > 0
    ? Math.round((openPositionCount / maxPositions) * 100)
    : 0;

  return {
    status,
    avgRiskUtilBullishPct: avgRiskUtilBullish !== null ? Math.round(avgRiskUtilBullish * 10) / 10 : null,
    avgTradesPerMonth,
    pctBullishWeeksWellFilled,
    coldStreakWeeks: coldStreak,
    currentPositionUtil: currentRiskUtil,
    currentPositions: openPositionCount,
    maxPositions,
    maxRiskPct,
    bullishWeeksInWindow: bullishWeeks.length,
    dataPoints: equitySnapshots.length,
  };
}
