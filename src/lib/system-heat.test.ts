import { describe, it, expect } from 'vitest';
import { computeSystemHeat, startOfWeek, weekKey } from './system-heat';
import type { SystemHeatInput } from './system-heat';

// Helper to create a Date on a specific day
function d(iso: string): Date {
  return new Date(iso + 'T12:00:00Z');
}

describe('startOfWeek', () => {
  it('returns Monday for a Wednesday', () => {
    const wed = d('2026-03-11'); // Wednesday
    const result = startOfWeek(wed);
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('returns same day for a Monday', () => {
    const mon = d('2026-03-09');
    const result = startOfWeek(mon);
    expect(result.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('returns previous Monday for a Sunday', () => {
    const sun = d('2026-03-08');
    const result = startOfWeek(sun);
    expect(result.toISOString().slice(0, 10)).toBe('2026-03-02');
  });
});

describe('weekKey', () => {
  it('returns Monday date string', () => {
    expect(weekKey(d('2026-03-11'))).toBe('2026-03-09');
  });
});

describe('computeSystemHeat', () => {
  const baseInput: SystemHeatInput = {
    maxRiskPct: 5.5,
    maxPositions: 5,
    regimeRows: [],
    equitySnapshots: [],
    tradeLogs: [],
    openPositionCount: 0,
  };

  it('returns NO_DATA when no regime rows exist', () => {
    const result = computeSystemHeat(baseInput);
    expect(result.status).toBe('NO_DATA');
    expect(result.avgRiskUtilBullishPct).toBeNull();
    expect(result.pctBullishWeeksWellFilled).toBeNull();
    expect(result.coldStreakWeeks).toBe(0);
  });

  it('returns GREEN when bullish weeks have high risk utilisation', () => {
    // 4 bullish weeks with risk at ~4% out of 5.5% max = 72.7% util
    const regimeRows = [
      { date: d('2026-02-16'), regime: 'BULLISH' },
      { date: d('2026-02-17'), regime: 'BULLISH' },
      { date: d('2026-02-18'), regime: 'BULLISH' },
      { date: d('2026-02-23'), regime: 'BULLISH' },
      { date: d('2026-02-24'), regime: 'BULLISH' },
      { date: d('2026-02-25'), regime: 'BULLISH' },
      { date: d('2026-03-02'), regime: 'BULLISH' },
      { date: d('2026-03-03'), regime: 'BULLISH' },
      { date: d('2026-03-09'), regime: 'BULLISH' },
      { date: d('2026-03-10'), regime: 'BULLISH' },
    ];

    const equitySnapshots = [
      { capturedAt: d('2026-02-16'), openRiskPercent: 4.0 },
      { capturedAt: d('2026-02-23'), openRiskPercent: 3.8 },
      { capturedAt: d('2026-03-02'), openRiskPercent: 4.2 },
      { capturedAt: d('2026-03-09'), openRiskPercent: 3.5 },
    ];

    const result = computeSystemHeat({
      ...baseInput,
      regimeRows,
      equitySnapshots,
    });

    expect(result.status).toBe('GREEN');
    expect(result.avgRiskUtilBullishPct).toBeGreaterThanOrEqual(60);
    expect(result.coldStreakWeeks).toBe(0);
  });

  it('returns AMBER when bullish weeks have moderate risk utilisation', () => {
    const regimeRows = [
      { date: d('2026-03-02'), regime: 'BULLISH' },
      { date: d('2026-03-03'), regime: 'BULLISH' },
      { date: d('2026-03-09'), regime: 'BULLISH' },
      { date: d('2026-03-10'), regime: 'BULLISH' },
    ];

    // ~2.2% out of 5.5% = 40% util
    const equitySnapshots = [
      { capturedAt: d('2026-03-02'), openRiskPercent: 2.2 },
      { capturedAt: d('2026-03-09'), openRiskPercent: 2.2 },
    ];

    const result = computeSystemHeat({
      ...baseInput,
      regimeRows,
      equitySnapshots,
    });

    expect(result.status).toBe('AMBER');
    expect(result.avgRiskUtilBullishPct).toBeGreaterThanOrEqual(30);
    expect(result.avgRiskUtilBullishPct).toBeLessThan(60);
  });

  it('returns RED when bullish weeks have low risk utilisation', () => {
    const regimeRows = [
      { date: d('2026-03-02'), regime: 'BULLISH' },
      { date: d('2026-03-03'), regime: 'BULLISH' },
      { date: d('2026-03-09'), regime: 'BULLISH' },
      { date: d('2026-03-10'), regime: 'BULLISH' },
    ];

    // ~0.5% out of 5.5% = 9% util
    const equitySnapshots = [
      { capturedAt: d('2026-03-02'), openRiskPercent: 0.5 },
      { capturedAt: d('2026-03-09'), openRiskPercent: 0.5 },
    ];

    const result = computeSystemHeat({
      ...baseInput,
      regimeRows,
      equitySnapshots,
    });

    expect(result.status).toBe('RED');
    expect(result.avgRiskUtilBullishPct).toBeLessThan(30);
  });

  it('counts cold streak correctly', () => {
    // 3 consecutive bullish weeks with <50% deployment, then 1 with >50%
    const regimeRows = [
      { date: d('2026-02-09'), regime: 'BULLISH' },
      { date: d('2026-02-16'), regime: 'BULLISH' },
      { date: d('2026-02-23'), regime: 'BULLISH' },
      { date: d('2026-03-02'), regime: 'BULLISH' },
    ];

    const equitySnapshots = [
      { capturedAt: d('2026-02-09'), openRiskPercent: 4.0 }, // high, breaks streak
      { capturedAt: d('2026-02-16'), openRiskPercent: 1.0 }, // cold
      { capturedAt: d('2026-02-23'), openRiskPercent: 0.5 }, // cold
      { capturedAt: d('2026-03-02'), openRiskPercent: 0.8 }, // cold
    ];

    const result = computeSystemHeat({
      ...baseInput,
      regimeRows,
      equitySnapshots,
    });

    expect(result.coldStreakWeeks).toBe(3);
  });

  it('computes avg trades per month by regime', () => {
    const tradeLogs = [
      { tradeDate: d('2026-01-10'), regime: 'BULLISH' },
      { tradeDate: d('2026-01-15'), regime: 'BULLISH' },
      { tradeDate: d('2026-01-20'), regime: 'SIDEWAYS' },
      { tradeDate: d('2026-02-05'), regime: 'BULLISH' },
      { tradeDate: d('2026-02-10'), regime: 'BEARISH' },
    ];

    const result = computeSystemHeat({
      ...baseInput,
      tradeLogs,
    });

    // Jan: 2 bullish, 1 sideways. Feb: 1 bullish, 1 bearish
    // Avg bullish = (2+1)/2 = 1.5
    expect(result.avgTradesPerMonth.BULLISH).toBe(1.5);
    expect(result.avgTradesPerMonth.SIDEWAYS).toBe(1);
    expect(result.avgTradesPerMonth.BEARISH).toBe(1);
  });

  it('computes pctBullishWeeksWellFilled', () => {
    // 4 bullish weeks, 2 with >= 60% util, 2 with <60%
    const regimeRows = [
      { date: d('2026-02-09'), regime: 'BULLISH' },
      { date: d('2026-02-16'), regime: 'BULLISH' },
      { date: d('2026-02-23'), regime: 'BULLISH' },
      { date: d('2026-03-02'), regime: 'BULLISH' },
    ];

    // 60% of 5.5 = 3.3
    const equitySnapshots = [
      { capturedAt: d('2026-02-09'), openRiskPercent: 4.0 }, // above 3.3
      { capturedAt: d('2026-02-16'), openRiskPercent: 4.0 }, // above 3.3
      { capturedAt: d('2026-02-23'), openRiskPercent: 1.0 }, // below 3.3
      { capturedAt: d('2026-03-02'), openRiskPercent: 1.0 }, // below 3.3
    ];

    const result = computeSystemHeat({
      ...baseInput,
      regimeRows,
      equitySnapshots,
    });

    expect(result.pctBullishWeeksWellFilled).toBe(50); // 2 of 4
  });

  it('ignores non-bullish weeks for bullish metrics', () => {
    const regimeRows = [
      { date: d('2026-03-02'), regime: 'BEARISH' },
      { date: d('2026-03-03'), regime: 'BEARISH' },
      { date: d('2026-03-04'), regime: 'BEARISH' },
    ];

    const equitySnapshots = [
      { capturedAt: d('2026-03-02'), openRiskPercent: 0.1 },
    ];

    const result = computeSystemHeat({
      ...baseInput,
      regimeRows,
      equitySnapshots,
    });

    // No bullish weeks → no data
    expect(result.status).toBe('NO_DATA');
    expect(result.avgRiskUtilBullishPct).toBeNull();
    expect(result.coldStreakWeeks).toBe(0);
  });

  it('reports current position util correctly', () => {
    const result = computeSystemHeat({
      ...baseInput,
      openPositionCount: 3,
      maxPositions: 5,
    });

    expect(result.currentPositionUtil).toBe(60);
    expect(result.currentPositions).toBe(3);
    expect(result.maxPositions).toBe(5);
  });
});
