/**
 * Tests for entropy signal computation.
 * Covers: Shannon entropy of log-returns over 63-day window
 */
import { describe, it, expect } from 'vitest';
import { computeEntropy, type DailyBar } from './entropy-signal';

function makeBars(count: number, closeOverride?: (i: number) => number): DailyBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String(count - i).padStart(2, '0')}`,
    close: closeOverride ? closeOverride(i) : 100 + Math.sin(i * 0.5) * 5,
  }));
}

describe('computeEntropy', () => {
  it('returns null for insufficient data', () => {
    expect(computeEntropy([])).toBeNull();
    expect(computeEntropy(makeBars(30))).toBeNull();
    expect(computeEntropy(makeBars(63))).toBeNull(); // need 64 for 63 returns
  });

  it('returns valid entropy for sufficient data', () => {
    const bars = makeBars(100);
    const result = computeEntropy(bars);
    expect(result).not.toBeNull();
    expect(result!.entropy63).toBeGreaterThanOrEqual(0);
    expect(result!.obsCount).toBeLessThanOrEqual(63);
    expect(result!.obsCount).toBeGreaterThan(0);
  });

  it('returns 0 entropy for constant returns', () => {
    // All closes identical → all log-returns = 0 → single bin → entropy = 0
    const bars = makeBars(100, () => 100);
    const result = computeEntropy(bars);
    expect(result).not.toBeNull();
    expect(result!.entropy63).toBe(0);
  });

  it('returns higher entropy for random-like data', () => {
    // Create bars with pseudo-random returns using a deterministic seed pattern
    const bars = makeBars(100, (i) => 100 + ((i * 7 + 13) % 20) - 10);
    const result = computeEntropy(bars);
    expect(result).not.toBeNull();
    expect(result!.entropy63).toBeGreaterThan(0);
  });

  it('returns lower entropy for clustered returns than spread returns', () => {
    // Clustered returns: price jumps then stays flat → returns cluster in one region
    // Pattern: 100 for 50 bars, then 105 for 50 bars. Most returns ≈ 0, one return is big.
    const clusteredBars = makeBars(100, (i) => (i < 50 ? 105 : 100));
    const clusteredResult = computeEntropy(clusteredBars);

    // Spread returns: alternating up/down creates varied returns filling many bins
    const spreadBars = makeBars(100, (i) => 100 + (i % 2 === 0 ? 10 : -10));
    const spreadResult = computeEntropy(spreadBars);

    expect(clusteredResult).not.toBeNull();
    expect(spreadResult).not.toBeNull();
    // Clustered returns should have lower entropy (fewer occupied bins)
    expect(clusteredResult!.entropy63).toBeLessThan(spreadResult!.entropy63);
  });

  it('returns null when too many invalid closes', () => {
    // More than half zero closes → not enough valid returns
    const bars = makeBars(100, (i) => (i < 50 ? 0 : 100));
    const result = computeEntropy(bars);
    expect(result).toBeNull();
  });

  it('entropy is bounded by log2(num_bins)', () => {
    // Maximum entropy for 10 bins = log2(10) ≈ 3.32
    const bars = makeBars(100, (i) => 100 + ((i * 7 + 13) % 20) - 10);
    const result = computeEntropy(bars);
    expect(result).not.toBeNull();
    expect(result!.entropy63).toBeLessThanOrEqual(Math.log2(10) + 0.01); // small tolerance
  });
});
