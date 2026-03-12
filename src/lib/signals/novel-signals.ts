/**
 * DEPENDENCIES
 * Consumed by: snapshot-sync.ts
 * Consumes: (standalone — operates on OHLCV bar arrays)
 * Risk-sensitive: NO — passive Layer 2 capture only, no scan/risk/stop impact
 * Last modified: 2026-03-11
 * Notes: Novel signal computations for Phase 6 prediction engine.
 *        These are PASSIVE CAPTURE only — they do not affect scan decisions.
 *        Evidence: 4 independent backtests, 13/52/73 tickers, 2016-2020.
 */

import { deflateSync } from 'zlib';

// ── Types ──────────────────────────────────────────────────────────

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NovelSignals {
  smartMoney21: number | null;
  entropy63: number | null;
  fractalDim: number | null;
  complexity: number | null;
}

// ── Smart Money (CLV × Volume, 21-day sum) ─────────────────────────

/**
 * Smart Money Accumulation: close-location-value × volume, 21-day sum.
 * Positive = closing near highs on volume = institutional accumulation.
 * Negative = closing near lows on volume = distribution.
 *
 * @param bars OHLCV bars, newest first
 * @param window Lookback window (default 21 days)
 */
export function computeSmartMoney(bars: OHLCVBar[], window = 21): number | null {
  if (!bars || bars.length < window) return null;

  const recent = bars.slice(0, window);
  let sum = 0;

  for (const bar of recent) {
    const range = bar.high - bar.low;
    if (range === 0) continue;
    // CLV: where the close sits within the day's range [-1, +1]
    const clv = (2 * bar.close - bar.low - bar.high) / range;
    sum += clv * bar.volume;
  }

  return sum;
}

// ── Shannon Entropy (63-day return distribution) ───────────────────

/**
 * Shannon Entropy of return distribution (63-day window, 8 bins).
 * Low entropy = ordered, trending, predictable.
 * High entropy = disordered, chaotic, random.
 *
 * @param bars OHLCV bars, newest first
 * @param window Lookback window (default 63 days)
 * @param bins Number of histogram bins (default 8)
 */
export function computeEntropy(bars: OHLCVBar[], window = 63, bins = 8): number | null {
  if (!bars || bars.length < window + 1) return null;

  // Compute returns from newest-first bars (index i to i+1 is current/previous)
  const returns: number[] = [];
  for (let i = 0; i < window; i++) {
    const current = bars[i].close;
    const previous = bars[i + 1].close;
    if (!previous || previous <= 0) continue;
    returns.push(current / previous - 1);
  }

  if (returns.length < window * 0.8) return null;

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  if (max === min) return 0;

  const binWidth = (max - min) / bins;
  const counts = new Array(bins).fill(0) as number[];

  for (const r of returns) {
    const bin = Math.min(Math.floor((r - min) / binWidth), bins - 1);
    counts[bin]++;
  }

  const total = returns.length;
  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }

  return Math.round(entropy * 1000) / 1000;
}

// ── Higuchi Fractal Dimension ──────────────────────────────────────

/**
 * Higuchi Fractal Dimension (100-day price window, kmax=6).
 * < 1.4 = trending (tradeable with momentum).
 * ~ 1.5 = random walk (hard to trade).
 * > 1.6 = mean-reverting.
 *
 * @param bars OHLCV bars, newest first
 * @param window Lookback window (default 100 days)
 * @param kmax Maximum lag (default 6)
 */
export function computeFractalDimension(
  bars: OHLCVBar[],
  window = 100,
  kmax = 6
): number | null {
  if (!bars || bars.length < window) return null;

  // Use chronological order for Higuchi FD
  const prices = bars.slice(0, window).map((b) => b.close).reverse();
  const N = prices.length;

  const lags: number[] = [];
  const lengths: number[] = [];

  for (let k = 1; k <= kmax; k++) {
    let Lk = 0;
    for (let m = 1; m <= k; m++) {
      const indices: number[] = [];
      for (let j = m - 1; j < N; j += k) {
        indices.push(j);
      }
      if (indices.length < 2) continue;

      let segLength = 0;
      for (let j = 1; j < indices.length; j++) {
        segLength += Math.abs(prices[indices[j]] - prices[indices[j - 1]]);
      }
      const nSeg = indices.length - 1;
      Lk += (segLength * (N - 1)) / (nSeg * k * k);
    }
    Lk /= k;

    if (Lk > 0) {
      lags.push(k);
      lengths.push(Lk);
    }
  }

  if (lags.length < 2) return 1.5;

  // Linear regression: log(L) vs log(1/k) → slope = fractal dimension
  const x = lags.map((k) => Math.log(1 / k));
  const y = lengths.map((l) => Math.log(l));

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
  const sumX2 = x.reduce((a, xi) => a + xi * xi, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 1.5;

  const slope = (n * sumXY - sumX * sumY) / denom;

  // Clamp to theoretical bounds [1.0, 2.0]
  return Math.round(Math.max(1.0, Math.min(2.0, slope)) * 1000) / 1000;
}

// ── Compression Complexity ─────────────────────────────────────────

/**
 * Compression Complexity: zlib compression ratio of discretised returns.
 * Proxy for Kolmogorov complexity.
 * Low ratio = patterned, more predictable.
 * High ratio = random, harder to predict.
 *
 * @param bars OHLCV bars, newest first
 * @param window Lookback window (default 100 days)
 * @param bins Number of discretization bins (default 10)
 */
export function computeComplexity(
  bars: OHLCVBar[],
  window = 100,
  bins = 10
): number | null {
  if (!bars || bars.length < window + 1) return null;

  const returns: number[] = [];
  for (let i = 0; i < window; i++) {
    const current = bars[i].close;
    const previous = bars[i + 1].close;
    if (!previous || previous <= 0) continue;
    returns.push(current / previous - 1);
  }

  if (returns.length < 20) return null;

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  if (max === min) return 0;

  const binWidth = (max - min) / bins;
  const digitised = returns.map((r) =>
    Math.min(Math.floor((r - min) / binWidth), bins - 1)
  );

  // Compress with zlib (Node.js built-in)
  const input = Buffer.from(digitised);
  const compressed = deflateSync(input);

  return Math.round((compressed.length / input.length) * 1000) / 1000;
}

// ── Composite ──────────────────────────────────────────────────────

/**
 * Compute all novel signals for a single ticker.
 * netIsolation is set externally from cross-ticker computation.
 *
 * @param bars OHLCV bars, newest first
 */
export function computeAllNovelSignals(bars: OHLCVBar[]): NovelSignals {
  return {
    smartMoney21: computeSmartMoney(bars, 21),
    entropy63: computeEntropy(bars, 63),
    fractalDim: computeFractalDimension(bars, 100),
    complexity: computeComplexity(bars, 100),
  };
}
