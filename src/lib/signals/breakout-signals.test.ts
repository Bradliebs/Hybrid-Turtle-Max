/**
 * Tests for breakout signal computation.
 * Covers: isBreakout20, breakoutDistancePct, breakoutWindowDays
 */
import { describe, it, expect } from 'vitest';
import { computeBreakoutSignal, type DailyBar } from './breakout-signals';

function makeBars(count: number, closeOverride?: (i: number) => number): DailyBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-03-${String(count - i).padStart(2, '0')}`,
    open: 100,
    high: closeOverride ? Math.max(closeOverride(i), 102) : 102,
    low: 98,
    close: closeOverride ? closeOverride(i) : 100,
    volume: 1000000,
  }));
}

describe('computeBreakoutSignal', () => {
  it('returns null for insufficient data', () => {
    expect(computeBreakoutSignal([])).toBeNull();
    expect(computeBreakoutSignal(makeBars(10))).toBeNull();
    expect(computeBreakoutSignal(makeBars(19))).toBeNull();
  });

  it('returns null for invalid close price', () => {
    const bars = makeBars(20, () => 0);
    expect(computeBreakoutSignal(bars)).toBeNull();
  });

  it('detects breakout when close >= 20-day close high', () => {
    // First bar close=103, all other bars close=100 → 20-day close high = 103 (includes bar 0)
    // Actually bar 0 IS the highest close, so isBreakout20 = 103 >= 103 = true
    const bars = makeBars(25, (i) => (i === 0 ? 103 : 100));
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
    expect(result!.isBreakout20).toBe(true);
    expect(result!.breakoutDistancePct).toBeLessThanOrEqual(0);
  });

  it('returns non-breakout when close < 20-day close high', () => {
    // First bar close=95, but other bars close=100 → 20-day close high = 100, so 95 < 100
    const bars = makeBars(25, (i) => (i === 0 ? 95 : 100));
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
    expect(result!.isBreakout20).toBe(false);
    expect(result!.breakoutDistancePct).toBeGreaterThan(0);
  });

  it('calculates positive distance when below close high', () => {
    // Close=95, 20-day close high=100 → distance = (100-95)/95 * 100 ≈ 5.26%
    const bars = makeBars(25, (i) => (i === 0 ? 95 : 100));
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
    expect(result!.breakoutDistancePct).toBeGreaterThan(4);
    expect(result!.breakoutDistancePct).toBeLessThan(7);
  });

  it('counts consecutive breakout window days', () => {
    // All bars close at 101.5 (within 2% of 102 high) → should count window days
    const bars = makeBars(30, () => 101.5);
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
    expect(result!.breakoutWindowDays).toBeGreaterThan(0);
  });

  it('resets window count on non-proximity day', () => {
    // Bar 0: 110, Bar 1: 109 → near their window highs (within 2%)
    // Bar 2: 90 → drops below bar 3+ (close=100), window high = 100, dist = 11% → breaks streak
    const bars = makeBars(30, (i) => {
      if (i === 0) return 110;
      if (i === 1) return 109;
      if (i === 2) return 90; // sudden drop below the rest of the window
      return 100;
    });
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
    expect(result!.breakoutWindowDays).toBe(2);
  });

  it('returns 0 window days when bar 0 is far below window high', () => {
    // Bar 0 close=80, bars 1+ close=100 → 20-day close high=100
    // dist for bar 0: (100-80)/80 = 25% → NOT within 2% → 0 window days
    const bars = makeBars(25, (i) => (i === 0 ? 80 : 100));
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
    expect(result!.breakoutWindowDays).toBe(0);
  });

  it('handles exactly 20 bars', () => {
    const bars = makeBars(20);
    const result = computeBreakoutSignal(bars);
    expect(result).not.toBeNull();
  });
});
