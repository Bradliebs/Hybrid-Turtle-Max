/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, snapshot-sync.ts, /api/analytics/breakout-evidence
 * Consumes: (standalone — operates on DailyBar arrays)
 * Risk-sensitive: NO — passive Layer 2 evidence capture only
 * Last modified: 2026-03-11
 * Notes: Computes network isolation score based on cross-correlation with peers.
 *        Isolation = 1 means the ticker's returns are uncorrelated with peers.
 *        Isolation = 0 means highly correlated (moves with the herd).
 *        Output is advisory — never feeds into scan decisions or risk gates.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DailyBar {
  date: string;
  close: number;
}

export interface NetworkIsolationResult {
  /** Isolation score: 0 = highly correlated with peers, 1 = fully isolated */
  netIsolation: number;
  /** Number of peers used in the correlation calculation */
  peerCount: number;
  /** Number of overlapping observations used */
  obsCount: number;
}

// ── Constants ──────────────────────────────────────────────────────

/** Lookback window for correlation (63 trading days ≈ 3 months) */
const CORRELATION_WINDOW = 63;

/** Minimum required bars for a valid correlation */
const MIN_BARS = CORRELATION_WINDOW + 1;

/** Minimum peers needed for a meaningful isolation score */
const MIN_PEERS = 3;

// ── Core Logic ─────────────────────────────────────────────────────

/**
 * Compute log-returns from daily bars.
 *
 * @param bars Daily bars, newest first
 * @param window Number of returns to compute
 * @returns Array of log-returns (newest first), or null if insufficient data
 */
function computeLogReturns(bars: DailyBar[], window: number): number[] | null {
  if (bars.length < window + 1) return null;

  const returns: number[] = [];
  for (let i = 0; i < window; i++) {
    const current = bars[i].close;
    const previous = bars[i + 1].close;
    if (!current || !previous || current <= 0 || previous <= 0) return null;
    returns.push(Math.log(current / previous));
  }
  return returns;
}

/**
 * Pearson correlation between two arrays of equal length.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute network isolation score for a target ticker against its peers.
 *
 * @param targetBars Daily bars for the target ticker, newest first
 * @param peerBarsMap Map of peer ticker → daily bars (newest first)
 * @returns NetworkIsolationResult or null if insufficient data/peers
 */
export function computeNetworkIsolation(
  targetBars: DailyBar[],
  peerBarsMap: Map<string, DailyBar[]>
): NetworkIsolationResult | null {
  const targetReturns = computeLogReturns(targetBars, CORRELATION_WINDOW);
  if (!targetReturns) return null;

  const correlations: number[] = [];

  peerBarsMap.forEach((peerBars) => {
    const peerReturns = computeLogReturns(peerBars, CORRELATION_WINDOW);
    if (!peerReturns) return;

    const corr = pearsonCorrelation(targetReturns, peerReturns);
    // Use absolute correlation — we care about dependence regardless of direction
    if (Number.isFinite(corr)) {
      correlations.push(Math.abs(corr));
    }
  });

  if (correlations.length < MIN_PEERS) return null;

  // Isolation = 1 - mean(|correlation|)
  // High mean correlation → low isolation (moves with the herd)
  // Low mean correlation → high isolation (independent mover)
  const meanAbsCorr = correlations.reduce((sum, c) => sum + c, 0) / correlations.length;
  const netIsolation = Math.round((1 - meanAbsCorr) * 1000) / 1000;

  return {
    netIsolation: Math.max(0, Math.min(1, netIsolation)), // clamp [0, 1]
    peerCount: correlations.length,
    obsCount: CORRELATION_WINDOW,
  };
}
