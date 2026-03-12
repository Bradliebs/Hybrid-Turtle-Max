# HybridTurtle v2 — Novel Signal Integration Guide

## Summary of Evidence

Four independent tests across 13, 52, 73 tickers and your own breakout test converged on clear answers. This document maps findings to specific changes in the HT2 codebase, separated by deployment gate.

---

## What Goes Where

| Signal | Role | Where It Lives | When to Deploy |
|---|---|---|---|
| **Smart Money (CLV×Vol)** | Signal snapshot capture | `signalSnapshot` schema + nightly pipeline | **Now** — passive data collection only |
| **Shannon Entropy** | Signal snapshot capture | `signalSnapshot` schema + nightly pipeline | **Now** — passive data collection only |
| **Network Isolation** | Signal snapshot capture + mild NCS weighting | `signalSnapshot` schema + scan-engine | **Now** (capture) / **Phase 6** (weighting) |
| **Fractal Dimension** | ML feature for prediction engine | `signalSnapshot` schema | **Phase 6** — after 30-trade gate |
| **Compression Complexity** | ML feature for prediction engine | `signalSnapshot` schema | **Phase 6** — after 30-trade gate |

Key principle: **capture everything now, deploy nothing as a hard filter.** Your NCS + breakout + regime architecture is already the right engine. Novel signals go into snapshots so Phase 6 has the richest possible feature set.

---

## 1. Signal Snapshot Schema Extension

Add these fields to your existing signal snapshot model. This is passive capture — no decision logic changes.

```typescript
// prisma/schema.prisma — extend SignalSnapshot

model SignalSnapshot {
  // ... existing fields (ncs, bqs, fws, regime, adx, atr, etc.)

  // === NOVEL SIGNALS (passive capture) ===

  // Smart Money: close-location-value × volume, 21-day sum
  // Evidence: +0.32 Sharpe on 52 tickers, +0.03 on 73
  // Captures institutional accumulation/distribution
  smartMoney21        Float?

  // Shannon Entropy: disorder in 63-day return distribution
  // Evidence: +0.51 Sharpe on 73 tickers as filter
  // Low = ordered/trending, High = chaotic/random
  entropy63           Float?

  // Network Isolation: 1 - avg|correlation| with universe
  // Evidence: consistently positive across all 3 universe sizes
  // High = independent price dynamics, better momentum candidate
  netIsolation        Float?

  // Fractal Dimension: Higuchi FD, 100-day window
  // Evidence: inconsistent as filter, but strong ML feature importance
  // <1.4 = trending, ~1.5 = random walk, >1.6 = mean-reverting
  fractalDim          Float?

  // Compression Complexity: zlib ratio of discretised returns
  // Evidence: weak as filter, but captures pattern structure
  // Low = patterned/predictable, High = random
  complexity          Float?
}
```

Then run:
```bash
npx prisma migrate dev --name add-novel-signals
```

---

## 2. Signal Computation Module

Create a new sacred-adjacent module. This is NOT a sacred file — it can be modified. It computes the novel signals that get captured in snapshots.

```typescript
// src/lib/signals/novel-signals.ts

/**
 * Novel signal computations for HT2 signal snapshots.
 * These are PASSIVE CAPTURE only — they do not affect
 * scan decisions until Phase 6 prediction engine.
 *
 * Evidence base:
 *   4 independent backtests, 13/52/73 tickers, 2016-2020
 *   Smart Money: best on 52 tickers (+0.32 Sharpe)
 *   Entropy: best on 73 tickers (+0.51 Sharpe)
 *   Net Isolation: consistent across all 3 sizes
 */

interface OHLCVBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NovelSignals {
  smartMoney21: number | null;
  entropy63: number | null;
  netIsolation: number | null;  // set externally from cross-correlation
  fractalDim: number | null;
  complexity: number | null;
}

/**
 * Smart Money Accumulation (CLV × Volume, 21-day sum)
 * Close Location Value: where the close sits within the day's range
 * Positive = closing near highs on volume = accumulation
 * Negative = closing near lows on volume = distribution
 */
export function computeSmartMoney(bars: OHLCVBar[], window = 21): number | null {
  if (bars.length < window) return null;

  const recent = bars.slice(-window);
  let sum = 0;

  for (const bar of recent) {
    const range = bar.high - bar.low;
    if (range === 0) continue;
    const clv = (2 * bar.close - bar.low - bar.high) / range;
    sum += clv * bar.volume;
  }

  return sum;
}

/**
 * Shannon Entropy of return distribution (63-day window, 8 bins)
 * Low entropy = ordered, trending, predictable
 * High entropy = disordered, chaotic, avoid
 * Threshold from testing: < 2.2 = tradeable
 */
export function computeEntropy(bars: OHLCVBar[], window = 63, bins = 8): number | null {
  if (bars.length < window + 1) return null;

  const recent = bars.slice(-(window + 1));
  const returns: number[] = [];

  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1].close > 0) {
      returns.push(recent[i].close / recent[i - 1].close - 1);
    }
  }

  if (returns.length < window * 0.8) return null;

  // Histogram
  const min = Math.min(...returns);
  const max = Math.max(...returns);
  if (max === min) return 0;

  const binWidth = (max - min) / bins;
  const counts = new Array(bins).fill(0);

  for (const r of returns) {
    const bin = Math.min(Math.floor((r - min) / binWidth), bins - 1);
    counts[bin]++;
  }

  // Shannon entropy
  const total = returns.length;
  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Higuchi Fractal Dimension (100-day price window, kmax=6)
 * < 1.4 = trending (tradeable with momentum)
 * ~ 1.5 = random walk (hard to trade)
 * > 1.6 = mean-reverting
 */
export function computeFractalDimension(
  bars: OHLCVBar[],
  window = 100,
  kmax = 6
): number | null {
  if (bars.length < window) return null;

  const prices = bars.slice(-window).map((b) => b.close);
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

  // Linear regression: log(L) vs log(1/k)
  const x = lags.map((k) => Math.log(1 / k));
  const y = lengths.map((l) => Math.log(l));

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
  const sumX2 = x.reduce((a, xi) => a + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  return Math.max(1.0, Math.min(2.0, slope));
}

/**
 * Compression Complexity (zlib proxy for Kolmogorov complexity)
 * Uses discretised returns, 100-day window
 * Low ratio = patterned = more predictable
 * High ratio = random = harder to predict
 *
 * Note: Node.js zlib is available natively
 */
export function computeComplexity(
  bars: OHLCVBar[],
  window = 100,
  bins = 10
): number | null {
  if (bars.length < window + 1) return null;

  const recent = bars.slice(-(window + 1));
  const returns: number[] = [];

  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1].close > 0) {
      returns.push(recent[i].close / recent[i - 1].close - 1);
    }
  }

  if (returns.length < 20) return null;

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  if (max === min) return 0;

  // Discretise to bin indices
  const binWidth = (max - min) / bins;
  const digitised = returns.map((r) =>
    Math.min(Math.floor((r - min) / binWidth), bins - 1)
  );

  // Compress with zlib
  const { deflateSync } = require('zlib');
  const input = Buffer.from(digitised);
  const compressed = deflateSync(input);

  return compressed.length / input.length;
}

/**
 * Compute all novel signals for a single ticker
 */
export function computeAllNovelSignals(bars: OHLCVBar[]): NovelSignals {
  return {
    smartMoney21: computeSmartMoney(bars, 21),
    entropy63: computeEntropy(bars, 63),
    netIsolation: null, // computed externally from cross-correlation matrix
    fractalDim: computeFractalDimension(bars, 100),
    complexity: computeComplexity(bars, 100),
  };
}
```

---

## 3. Network Isolation (Cross-Ticker Computation)

This one needs all tickers together since it measures correlation structure. Compute it once per nightly run, then attach to each ticker's snapshot.

```typescript
// src/lib/signals/network-isolation.ts

/**
 * Compute network isolation for each ticker in the universe.
 * Isolation = 1 - mean(|correlation with all other tickers|)
 * High isolation = independent price dynamics = better momentum candidate
 *
 * Evidence: only novel signal consistently positive across all 3 test sizes
 * Call once per nightly pipeline run, not per-ticker.
 */

interface ReturnSeries {
  ticker: string;
  returns: Map<string, number>; // date string → daily return
}

export function computeNetworkIsolation(
  allReturns: ReturnSeries[],
  window = 126 // ~6 months of trading days
): Map<string, number> {
  const isolations = new Map<string, number>();
  const n = allReturns.length;

  if (n < 5) {
    // Not enough tickers for meaningful network
    for (const series of allReturns) {
      isolations.set(series.ticker, 0.5);
    }
    return isolations;
  }

  // Get common dates (last `window` dates where most tickers have data)
  const allDates = new Set<string>();
  for (const series of allReturns) {
    for (const date of series.returns.keys()) {
      allDates.add(date);
    }
  }
  const sortedDates = [...allDates].sort().slice(-window);

  // Build aligned return matrix
  for (let i = 0; i < n; i++) {
    const tickerReturns = sortedDates
      .map((d) => allReturns[i].returns.get(d))
      .filter((r): r is number => r !== undefined);

    let sumCorr = 0;
    let corrCount = 0;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const otherReturns = sortedDates
        .map((d) => allReturns[j].returns.get(d))
        .filter((r): r is number => r !== undefined);

      // Align by common dates
      const aligned = sortedDates
        .map((d) => [allReturns[i].returns.get(d), allReturns[j].returns.get(d)])
        .filter((pair): pair is [number, number] =>
          pair[0] !== undefined && pair[1] !== undefined
        );

      if (aligned.length < 30) continue;

      const corr = pearsonCorrelation(
        aligned.map((p) => p[0]),
        aligned.map((p) => p[1])
      );

      if (!isNaN(corr)) {
        sumCorr += Math.abs(corr);
        corrCount++;
      }
    }

    const avgAbsCorr = corrCount > 0 ? sumCorr / corrCount : 0.5;
    isolations.set(allReturns[i].ticker, 1 - avgAbsCorr);
  }

  return isolations;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
  const sumX2 = x.reduce((a, xi) => a + xi * xi, 0);
  const sumY2 = y.reduce((a, yi) => a + yi * yi, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return den === 0 ? 0 : num / den;
}
```

---

## 4. Nightly Pipeline Integration

Add novel signal computation as a new step in the 9-step pipeline. It should slot in after price data is fetched but before the scan engine runs.

```typescript
// In your nightly pipeline orchestrator, add after step 2 (data fetch):

// Step 2.5: Compute novel signals (passive capture)
// This does NOT gate any decisions — it only populates snapshot fields
async function stepComputeNovelSignals(
  tickers: TickerWithBars[],
  dryRun: boolean
): Promise<void> {
  const { computeAllNovelSignals } = await import('../signals/novel-signals');
  const { computeNetworkIsolation } = await import('../signals/network-isolation');

  // Per-ticker signals
  const novelSignals = new Map<string, NovelSignals>();
  for (const ticker of tickers) {
    novelSignals.set(ticker.symbol, computeAllNovelSignals(ticker.bars));
  }

  // Cross-ticker: network isolation
  const returnSeries = tickers.map((t) => ({
    ticker: t.symbol,
    returns: new Map(
      t.bars.slice(1).map((bar, i) => [
        bar.date.toISOString().slice(0, 10),
        bar.close / t.bars[i].close - 1,
      ])
    ),
  }));
  const isolations = computeNetworkIsolation(returnSeries);

  // Attach isolation to per-ticker signals
  for (const [sym, signals] of novelSignals) {
    signals.netIsolation = isolations.get(sym) ?? null;
  }

  // Store for snapshot capture (passed to scan engine)
  if (!dryRun) {
    // Merge into whatever data structure your scan engine reads
    for (const [sym, signals] of novelSignals) {
      // Your pipeline's data passing mechanism goes here
      // e.g. pipelineContext.novelSignals.set(sym, signals);
    }
  }

  console.log(
    `[novel-signals] Computed for ${novelSignals.size} tickers, ` +
    `avg entropy: ${mean([...novelSignals.values()].map(s => s.entropy63).filter(Boolean))}`,
  );
}

function mean(arr: (number | null)[]): string {
  const valid = arr.filter((x): x is number => x !== null);
  return valid.length > 0
    ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2)
    : 'N/A';
}
```

---

## 5. Snapshot Capture (Wire Into Existing Flow)

In whatever function creates your signal snapshots, add the novel fields:

```typescript
// Where you build the snapshot record for Prisma:
const snapshot = {
  // ... existing fields
  ncs: scanResult.ncs,
  bqs: scanResult.bqs,
  fws: scanResult.fws,
  regime: scanResult.regime,
  adx: scanResult.adx,
  atrPct: scanResult.atrPct,
  // ... etc

  // Novel signals (passive capture)
  smartMoney21: novelSignals?.smartMoney21 ?? null,
  entropy63: novelSignals?.entropy63 ?? null,
  netIsolation: novelSignals?.netIsolation ?? null,
  fractalDim: novelSignals?.fractalDim ?? null,
  complexity: novelSignals?.complexity ?? null,
};

await prisma.signalSnapshot.create({ data: snapshot });
```

---

## 6. What NOT to Do

These are explicit anti-patterns based on the test results:

```typescript
// ❌ DO NOT add entropy as a hard filter in the scan engine
// It flipped between datasets — not stable enough for a gate
if (entropy63 > 2.2) return 'IGNORE'; // DON'T DO THIS

// ❌ DO NOT multiply NCS by novel signals
// Evidence: every score modifier degraded performance on 52+ tickers
const adjustedNcs = ncs * (1 + tradability * 3); // DON'T DO THIS

// ❌ DO NOT stack multiple novel filters
// Evidence: entropy + fractal together was catastrophic (-0.67 Sharpe)
// With 268 tickers you have more headroom, but still dangerous
if (entropy < 2.2 && fractalDim < 1.48) { ... } // DON'T DO THIS

// ❌ DO NOT use these as regime replacements
// Your existing SMA50 > SMA200 regime gate works. Don't swap it.
const regime = entropy < 2.0 ? 'BULLISH' : 'BEARISH'; // DON'T DO THIS

// ✅ DO capture everything in snapshots for Phase 6
// ✅ DO let the prediction engine ML determine which signals matter
// ✅ DO validate on your actual 30+ closed trades before any deployment
```

---

## 7. Phase 6 Preview: How These Become ML Features

When you reach the 30-trade data gate, your signal snapshots will contain both classic (NCS, BQS, FWS, regime, ADX, ATR) and novel (entropy, fractal, smart money, isolation, complexity) signals alongside the actual trade outcome (rMultiple).

The prediction engine trains on this combined feature set:

```typescript
// Phase 6 feature vector (preview — don't build yet)
const features = {
  // Classic HT2 (proven)
  ncs: snapshot.ncs,
  bqs: snapshot.bqs,
  fws: snapshot.fws,
  adx: snapshot.adx,
  atrPct: snapshot.atrPct,
  regime: snapshot.regime === 'BULLISH' ? 1 : 0,

  // Novel (let ML determine importance)
  entropy63: snapshot.entropy63,
  fractalDim: snapshot.fractalDim,
  smartMoney21: snapshot.smartMoney21,
  netIsolation: snapshot.netIsolation,
  complexity: snapshot.complexity,
};

// Target: rMultiple from closed trade
const target = trade.rMultiple;
```

The ML model decides which novel signals matter on YOUR data with YOUR actual execution. No more proxy backtests.

---

## 8. Implementation Order

1. **Today**: Add Prisma schema fields (5 min)
2. **Today**: Create `novel-signals.ts` and `network-isolation.ts` (copy from above)
3. **This week**: Wire into nightly pipeline as step 2.5
4. **This week**: Wire into snapshot capture
5. **Ongoing**: Accumulate data with every nightly run
6. **After 30-trade gate**: Feed into Phase 6 prediction engine

Total implementation effort: ~2-3 hours. Zero risk to existing scan logic since it's all passive capture.
