/**
 * Tests for novel signal computations.
 * Covers: computeSmartMoney, computeEntropy, computeFractalDimension,
 *         computeComplexity, computeAllNovelSignals
 */
import { describe, it, expect } from 'vitest';
import {
  computeSmartMoney,
  computeEntropy,
  computeFractalDimension,
  computeComplexity,
  computeAllNovelSignals,
  type OHLCVBar,
} from './novel-signals';

function makeBars(count: number, overrides?: Partial<{
  close: (i: number) => number;
  volume: (i: number) => number;
  high: (i: number) => number;
  low: (i: number) => number;
}>): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String(count - i).padStart(2, '0')}`,
    open: 100,
    high: overrides?.high ? overrides.high(i) : 105,
    low: overrides?.low ? overrides.low(i) : 95,
    close: overrides?.close ? overrides.close(i) : 100 + Math.sin(i * 0.3) * 3,
    volume: overrides?.volume ? overrides.volume(i) : 1_000_000,
  }));
}

// ── Smart Money ────────────────────────────────────────────────

describe('computeSmartMoney', () => {
  it('returns null for insufficient data', () => {
    expect(computeSmartMoney([])).toBeNull();
    expect(computeSmartMoney(makeBars(10))).toBeNull();
    expect(computeSmartMoney(makeBars(20))).toBeNull();
  });

  it('returns a number for sufficient data', () => {
    const result = computeSmartMoney(makeBars(30));
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });

  it('returns positive for closes near highs', () => {
    // Close at 104 with high=105, low=95 → CLV = (2*104 - 95 - 105)/10 = 0.8
    const bars = makeBars(25, {
      close: () => 104,
      high: () => 105,
      low: () => 95,
      volume: () => 1_000_000,
    });
    const result = computeSmartMoney(bars);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('returns negative for closes near lows', () => {
    // Close at 96 with high=105, low=95 → CLV = (2*96 - 95 - 105)/10 = -0.8
    const bars = makeBars(25, {
      close: () => 96,
      high: () => 105,
      low: () => 95,
      volume: () => 1_000_000,
    });
    const result = computeSmartMoney(bars);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it('skips bars with zero range', () => {
    const bars = makeBars(25, {
      close: () => 100,
      high: () => 100,
      low: () => 100,
    });
    const result = computeSmartMoney(bars);
    expect(result).toBe(0);
  });
});

// ── Entropy ────────────────────────────────────────────────────

describe('computeEntropy (novel-signals)', () => {
  it('returns null for insufficient data', () => {
    expect(computeEntropy([])).toBeNull();
    expect(computeEntropy(makeBars(50))).toBeNull();
    expect(computeEntropy(makeBars(63))).toBeNull(); // need 64 for 63 returns
  });

  it('returns a number for sufficient data', () => {
    const result = computeEntropy(makeBars(100));
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for constant returns', () => {
    const bars = makeBars(100, { close: () => 100 });
    const result = computeEntropy(bars);
    expect(result).toBe(0);
  });

  it('is bounded by log2(bins)', () => {
    const result = computeEntropy(makeBars(100));
    expect(result).not.toBeNull();
    expect(result!).toBeLessThanOrEqual(Math.log2(8) + 0.01);
  });
});

// ── Fractal Dimension ──────────────────────────────────────────

describe('computeFractalDimension', () => {
  it('returns null for insufficient data', () => {
    expect(computeFractalDimension([])).toBeNull();
    expect(computeFractalDimension(makeBars(50))).toBeNull();
    expect(computeFractalDimension(makeBars(99))).toBeNull();
  });

  it('returns a number for sufficient data', () => {
    const result = computeFractalDimension(makeBars(120));
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });

  it('is bounded [1.0, 2.0]', () => {
    const result = computeFractalDimension(makeBars(120));
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(1.0);
    expect(result!).toBeLessThanOrEqual(2.0);
  });

  it('returns ~1.5 for flat constant series', () => {
    // Constant prices → degenerate case → default 1.5
    const bars = makeBars(120, { close: () => 100 });
    const result = computeFractalDimension(bars);
    // Constant series has zero path length → returns 1.5 fallback
    expect(result).toBe(1.5);
  });

  it('handles trending series', () => {
    // Monotonically increasing → trending → should be < 1.5
    const trendBars = makeBars(120, { close: (i) => 100 + i * 0.5 });
    const result = computeFractalDimension(trendBars);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(1.6);
  });
});

// ── Compression Complexity ─────────────────────────────────────

describe('computeComplexity', () => {
  it('returns null for insufficient data', () => {
    expect(computeComplexity([])).toBeNull();
    expect(computeComplexity(makeBars(50))).toBeNull();
    expect(computeComplexity(makeBars(100))).toBeNull(); // need 101
  });

  it('returns a number for sufficient data', () => {
    const result = computeComplexity(makeBars(120));
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });

  it('returns 0 for constant returns', () => {
    const bars = makeBars(120, { close: () => 100 });
    const result = computeComplexity(bars);
    expect(result).toBe(0);
  });

  it('returns positive ratio for varied returns', () => {
    const result = computeComplexity(makeBars(120));
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });
});

// ── Composite ──────────────────────────────────────────────────

describe('computeAllNovelSignals', () => {
  it('returns all fields', () => {
    const result = computeAllNovelSignals(makeBars(120));
    expect(result).toHaveProperty('smartMoney21');
    expect(result).toHaveProperty('entropy63');
    expect(result).toHaveProperty('fractalDim');
    expect(result).toHaveProperty('complexity');
    // netIsolation is not returned — set externally
    expect(result.smartMoney21).not.toBeNull();
    expect(result.entropy63).not.toBeNull();
    expect(result.fractalDim).not.toBeNull();
    expect(result.complexity).not.toBeNull();
  });

  it('returns nulls for insufficient data', () => {
    const result = computeAllNovelSignals(makeBars(10));
    expect(result.smartMoney21).toBeNull();
    expect(result.entropy63).toBeNull();
    expect(result.fractalDim).toBeNull();
    expect(result.complexity).toBeNull();
  });
});
