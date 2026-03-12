/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, snapshot-sync.ts, /api/analytics/breakout-evidence
 * Consumes: (standalone — operates on DailyBar arrays)
 * Risk-sensitive: NO — passive Layer 2 evidence capture only
 * Last modified: 2026-03-11
 * Notes: Computes breakout state from daily OHLCV bars.
 *        Output is advisory — never feeds into scan decisions or risk gates.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BreakoutSignalResult {
  /** True if close >= 20-day high (breakout in progress) */
  isBreakout20: boolean;
  /** % distance from close to 20-day high. Negative = above the high. */
  breakoutDistancePct: number;
  /** Consecutive days where close was within 2% of the 20-day high */
  breakoutWindowDays: number;
}

// ── Constants ──────────────────────────────────────────────────────

/** Minimum candles required to compute 20-day high */
const MIN_BARS = 20;

/** Proximity threshold: within this % of the 20-day high counts as "near breakout" */
const PROXIMITY_THRESHOLD_PCT = 2;

// ── Core Logic ─────────────────────────────────────────────────────

/**
 * Compute breakout state from daily price bars.
 *
 * @param bars Daily OHLCV bars, newest first (same order as getDailyPrices)
 * @returns BreakoutSignalResult or null if insufficient data
 */
export function computeBreakoutSignal(bars: DailyBar[]): BreakoutSignalResult | null {
  if (!bars || bars.length < MIN_BARS) return null;

  const close = bars[0].close;
  if (!close || close <= 0) return null;

  // 20-day high of closes (Donchian breakout = close exceeds prior close highs)
  const closeHigh20 = Math.max(...bars.slice(0, MIN_BARS).map((b) => b.close));
  if (closeHigh20 <= 0) return null;

  // Breakout = today's close is at or above the 20-day close high
  const isBreakout20 = close >= closeHigh20;

  // Distance: negative means above the high (breakout in progress)
  const breakoutDistancePct = ((closeHigh20 - close) / close) * 100;

  // Count consecutive days where close was within PROXIMITY_THRESHOLD_PCT of the rolling 20-day close high
  let breakoutWindowDays = 0;
  for (let i = 0; i < bars.length - MIN_BARS + 1; i++) {
    const windowBars = bars.slice(i, i + MIN_BARS);
    const windowHigh = Math.max(...windowBars.map((b) => b.close));
    const dayClose = bars[i].close;
    if (dayClose <= 0 || windowHigh <= 0) break;

    const dist = ((windowHigh - dayClose) / dayClose) * 100;
    if (dist <= PROXIMITY_THRESHOLD_PCT) {
      breakoutWindowDays++;
    } else {
      break; // streak broken
    }
  }

  return {
    isBreakout20,
    breakoutDistancePct: Math.round(breakoutDistancePct * 100) / 100,
    breakoutWindowDays,
  };
}
