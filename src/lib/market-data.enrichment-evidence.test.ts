import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ chart: vi.fn() }));
vi.mock('yahoo-finance2', () => ({ default: class {
  chart = mocks.chart;
} }));
vi.mock('./cache-persistence', () => ({ persistCache: vi.fn(), rehydrateCache: vi.fn().mockResolvedValue(null) }));

import { getDailyPrices } from './market-data';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Yahoo enrichment evidence boundary', () => {
  it('preserves raw/adjusted evidence and fetch time without changing existing price values or ordering', async () => {
    vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
    const before = Date.now();
    const quotes = [
      { date: new Date('2026-09-01T13:30Z'), open: 100, high: 102, low: 99, close: 101, adjclose: 50.5, volume: 1000 },
      { date: new Date('2026-09-02T13:30Z'), open: 101, high: 103, low: 100, close: 102, volume: 1100 },
    ];
    mocks.chart.mockResolvedValue({ quotes });
    const bars = await getDailyPrices('ENRICHMENT-EVIDENCE-TEST', 'compact', true);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ date: '2026-09-02', open: 101, high: 103, low: 100,
      close: 102, rawClose: 102, adjustedClose: undefined, volume: 1100 });
    expect(bars[1]).toMatchObject({ date: '2026-09-01', open: 100, high: 102, low: 99,
      close: 50.5, rawClose: 101, adjustedClose: 50.5, volume: 1000 });
    expect(bars[0].fetchedAt).toBeGreaterThanOrEqual(before);
    expect(bars[0].fetchedAt).toBeLessThanOrEqual(Date.now());
    expect(bars[1].fetchedAt).toBe(bars[0].fetchedAt);
    expect(await getDailyPrices('ENRICHMENT-EVIDENCE-TEST')).toEqual(bars);
    expect(mocks.chart).toHaveBeenCalledTimes(1);
  });
});