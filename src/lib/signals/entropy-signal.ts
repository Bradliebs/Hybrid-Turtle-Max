/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, snapshot-sync.ts, /api/analytics/breakout-evidence
 * Consumes: (standalone — operates on DailyBar arrays)
 * Risk-sensitive: NO — passive Layer 2 evidence capture only
 * Last modified: 2026-03-11
 * Notes: Computes Shannon entropy of log-returns over a 63-day window.
 *        Higher entropy = more random/unpredictable returns.
 *        Lower entropy = more structured/trending behaviour.
 *        Output is advisory — never feeds into scan decisions or risk gates.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DailyBar {
  date: string;
  close: number;
}

export interface EntropySignalResult {
  /** Shannon entropy in bits (0 = deterministic, higher = more random) */
  entropy63: number;
  /** Number of return observations used */
  obsCount: number;
}

// ── Constants ──────────────────────────────────────────────────────

/** Window size for entropy calculation (63 trading days ≈ 3 months) */
const ENTROPY_WINDOW = 63;

/** Minimum required bars (window + 1 for returns) */
const MIN_BARS = ENTROPY_WINDOW + 1;

/** Number of histogram bins for discretizing returns */
const NUM_BINS = 10;

// ── Core Logic ─────────────────────────────────────────────────────

/**
 * Compute Shannon entropy of log-returns over a 63-day window.
 *
 * @param bars Daily bars with at least close prices, newest first
 * @returns EntropySignalResult or null if insufficient data
 */
export function computeEntropy(bars: DailyBar[]): EntropySignalResult | null {
  if (!bars || bars.length < MIN_BARS) return null;

  // Compute log-returns for the 63-day window (newest first, so index 0→1 is most recent)
  const returns: number[] = [];
  for (let i = 0; i < ENTROPY_WINDOW; i++) {
    const current = bars[i].close;
    const previous = bars[i + 1].close;
    if (!current || !previous || current <= 0 || previous <= 0) continue;
    returns.push(Math.log(current / previous));
  }

  if (returns.length < ENTROPY_WINDOW / 2) return null; // need at least half the window

  // Discretize returns into equal-width bins
  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const range = max - min;

  // If all returns are identical, entropy is 0
  if (range === 0) {
    return { entropy63: 0, obsCount: returns.length };
  }

  const binWidth = range / NUM_BINS;
  const binCounts = new Array(NUM_BINS).fill(0) as number[];

  for (const r of returns) {
    // Assign to bin (clamp last value to final bin)
    const binIndex = Math.min(Math.floor((r - min) / binWidth), NUM_BINS - 1);
    binCounts[binIndex]++;
  }

  // Compute Shannon entropy: H = -Σ p(x) * log2(p(x))
  const n = returns.length;
  let entropy = 0;
  for (const count of binCounts) {
    if (count === 0) continue;
    const p = count / n;
    entropy -= p * Math.log2(p);
  }

  return {
    entropy63: Math.round(entropy * 1000) / 1000,
    obsCount: returns.length,
  };
}
