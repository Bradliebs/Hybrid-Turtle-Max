import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn(), prices: vi.fn(),
  cursorRead: vi.fn(), cursorWrite: vi.fn(), transaction: vi.fn() }));
vi.mock('./prisma', () => ({ default: {
  candidateOutcome: { updateMany: mocks.update }, $transaction: mocks.transaction,
} }));
vi.mock('./market-data', () => ({ getDailyPrices: mocks.prices }));

import { computeForwardMetrics, enrichCandidateOutcomes, ENRICHMENT_COHORT_START, prepareEnrichmentWindow } from './candidate-outcome-enrichment';

const row = { id: 'candidate-1', ticker: 'TEST', scanDate: new Date('2026-09-11T22:00:00Z'),
  price: 100, entryTrigger: 100, stopPrice: 95, enrichedAt: null as Date | null,
  fwdReturn5d: null as number | null, fwdReturn10d: null as number | null, fwdReturn20d: null as number | null };
const bars = Array.from({ length: 45 }, (_, index) => new Date(Date.UTC(2026, 8, 14 + index)))
  .filter(date => ![0, 6].includes(date.getUTCDay())).slice(0, 30)
  .map((date, index) => ({ date: date.toISOString().slice(0, 10),
    close: 101 + index, high: 102 + index, low: 100 + index, rawClose: 101 + index, adjustedClose: 101 + index,
    fetchedAt: date.getTime() + 86400000 }));
const anchor = { date: '2026-09-11', close: 100, high: 101, low: 99, rawClose: 100, adjustedClose: 100,
  fetchedAt: Date.parse('2026-09-12') };
const history = [anchor, ...bars];

describe('outcome enrichment regressions and evidence limitations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    mocks.findMany.mockReset().mockResolvedValue([row]);
    mocks.update.mockReset().mockResolvedValue({ count: 1 });
    mocks.prices.mockReset();
    mocks.cursorRead.mockReset().mockResolvedValue(null);
    mocks.cursorWrite.mockReset().mockResolvedValue({});
    mocks.transaction.mockReset().mockImplementation(async callback => callback({
      candidateOutcome: { findMany: mocks.findMany },
      appSetting: { findUnique: mocks.cursorRead, upsert: mocks.cursorWrite },
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('persists chronological horizons without mutating newest-first provider bars', async () => {
    const providerBars = [...history].reverse();
    mocks.prices.mockResolvedValue(providerBars);
    await enrichCandidateOutcomes();
    const chronological = computeForwardMetrics(100, 100, 95, bars);
    expect(chronological.fwdReturn5d).toBe(5);
    expect(chronological.fwdReturn20d).toBe(20);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      fwdReturn5d: 5, fwdReturn10d: 10, fwdReturn20d: 20,
    });
    expect(providerBars[0]).toBe(bars.at(-1));
  });

  it('revisits partial horizons and stops after all three are complete', async () => {
    const stored = { ...row };
    mocks.findMany.mockImplementation(async ({ where }) => {
      expect(where.scanDate.gte).toEqual(ENRICHMENT_COHORT_START);
      expect(where.OR).toContainEqual({ fwdReturn20d: null });
      return stored.fwdReturn20d === null ? [{ ...stored }] : [];
    });
    mocks.update.mockImplementation(async ({ data }) => { Object.assign(stored, data); return { count: 1 }; });
    mocks.prices.mockResolvedValueOnce([anchor, ...bars.slice(0, 7)]);
    await enrichCandidateOutcomes();
    expect(stored.fwdReturn20d).toBeNull();
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('stopHit');
    mocks.prices.mockResolvedValue(history);
    await enrichCandidateOutcomes();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1][0].data).not.toHaveProperty('fwdReturn5d');
    expect(stored.fwdReturn20d).toBe(20);
    await enrichCandidateOutcomes();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.prices).toHaveBeenCalledTimes(2);
  });

  it('excludes historical cohorts and refuses invalid arguments before querying', async () => {
    mocks.findMany.mockResolvedValue([{ ...row, scanDate: new Date('2026-06-01') }]);
    mocks.prices.mockResolvedValue(history);
    expect(await enrichCandidateOutcomes()).toEqual({ enriched: 0, skipped: 1, errors: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.findMany.mockClear();
    await expect(enrichCandidateOutcomes(-1)).rejects.toThrow();
    await expect(enrichCandidateOutcomes(8, 0)).rejects.toThrow();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('does not overwrite changed prior returns or count concurrent writes as success', async () => {
    mocks.findMany.mockResolvedValue([{ ...row, fwdReturn5d: 99, enrichedAt: new Date('2026-09-21') }]);
    mocks.prices.mockResolvedValue(history);
    expect((await enrichCandidateOutcomes()).skipped).toBe(1);
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.findMany.mockResolvedValue([row]);
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await enrichCandidateOutcomes()).enriched).toBe(0);
    expect(mocks.update.mock.calls[0][0].where).toMatchObject({
      id: row.id, price: 100, enrichedAt: null, fwdReturn5d: null, fwdReturn20d: null,
    });
  });

  it('does not rewrite unchanged partial horizons, including a recorded zero', async () => {
    mocks.findMany.mockResolvedValue([{ ...row, fwdReturn5d: 0, enrichedAt: new Date('2026-09-21') }]);
    mocks.prices.mockResolvedValue([anchor, ...bars.slice(0, 7).map(bar => ({
      ...bar, close: 100, low: 99, rawClose: 100, adjustedClose: 100,
    }))]);
    expect((await enrichCandidateOutcomes()).skipped).toBe(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('checks complete prefixes rather than shifting missing sessions or including today', () => {
    const prepare = (prices: typeof history, asOf = new Date('2026-11-01')) =>
      prepareEnrichmentWindow(row.scanDate, row.price, prices, asOf);
    expect(prepare(history.filter(bar => bar.date !== bars[7].date))).toMatchObject({
      bars: bars.slice(0, 7), reason: 'MISSING_OR_NON_SESSION_BAR',
    });
    expect(prepare(history, new Date(`${bars[4].date}T23:00Z`)).bars).toHaveLength(4);
    expect(prepare([...history, bars[2]]).reason).toBe('DUPLICATE_SESSION');
    expect(prepare(bars).reason).toBe('MISSING_SCAN_ANCHOR');
    expect(prepare([{ ...anchor, close: 99 }, ...bars]).reason).toBe('SCAN_BASELINE_MISMATCH');
    expect(prepare([{ ...anchor, date: '2026-02-30' }, ...bars]).reason).toBe('INVALID_BAR_DATE');
    expect(prepare([anchor, ...bars.map(bar => ({ ...bar, rawClose: NaN }))]).reason).toBe('MISSING_PRICE_BASIS');
    expect(prepare([anchor, ...bars.map(bar => ({ ...bar, low: bar.high + 1 }))]).reason).toBe('INVALID_PRICE_BAR');
    expect(prepare([anchor, ...bars.map(bar => ({ ...bar, fetchedAt: Date.parse(bar.date) }))]).reason)
      .toBe('UNPROVEN_BAR_FINALIZATION');
    expect(prepare([anchor, ...bars.map(bar => ({ ...bar, fetchedAt: Date.parse('2026-12-01') }))]).reason)
      .toBe('UNPROVEN_BAR_FINALIZATION');
  });

  it('requires adjustment evidence, rejects factor changes and scales raw excursions to scan basis', () => {
    const adjusted = history.map(bar => ({ ...bar, close: bar.close * 0.5, adjustedClose: bar.close * 0.5 }));
    const prepare = (prices = adjusted) => prepareEnrichmentWindow(row.scanDate, 50, prices, new Date('2026-11-01'));
    const valid = prepare();
    expect(valid.reason).toBeNull();
    expect(valid.bars[0]).toMatchObject({ close: 50.5, high: 51, low: 50 });
    const result = computeForwardMetrics(50, 50, 47.5, valid.bars);
    expect(result.fwdReturn20d).toBe(20);
    expect(result.mfeR).toBe(4.2);
    expect(prepare(adjusted.map(bar => ({ ...bar, rawClose: NaN }))).reason).toBe('MISSING_PRICE_BASIS');
    const changed = adjusted.map((bar, index) => index === 8 ? { ...bar, adjustedClose: bar.close * 0.9, close: bar.close * 0.9 } : bar);
    expect(prepare(changed)).toMatchObject({ bars: valid.bars.slice(0, 7), reason: 'ADJUSTMENT_FACTOR_CHANGED' });
  });

  it('counts fetch and database failures without reporting successful enrichment', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.prices.mockRejectedValueOnce(new Error('provider down'));
    expect((await enrichCandidateOutcomes()).errors).toBe(1);
    mocks.prices.mockResolvedValue(history);
    mocks.update.mockRejectedValueOnce(new Error('database down'));
    expect((await enrichCandidateOutcomes()).errors).toBe(1);
  });

  it('advances past rejected pages, stays bounded and retries them after wrapping', async () => {
    let cursor: string | null = null;
    const candidates = [
      { ...row, id: 'candidate-1', ticker: 'REJECTED' },
      { ...row, id: 'candidate-2', ticker: 'VALID' },
      { ...row, id: 'candidate-3', ticker: 'FAILED' },
    ];
    mocks.cursorRead.mockImplementation(async () => cursor ? { value: cursor } : null);
    mocks.cursorWrite.mockImplementation(async ({ update }) => { cursor = update.value; return {}; });
    mocks.findMany.mockImplementation(async ({ where, take, orderBy }) => {
      expect(where.scanDate.gte).toEqual(ENRICHMENT_COHORT_START);
      expect(orderBy).toEqual({ id: 'asc' });
      expect(take).toBe(1);
      return candidates.filter(candidate => !where.id || candidate.id > where.id.gt).slice(0, take);
    });
    mocks.prices.mockImplementation(async ticker => {
      expect(cursor).not.toBeNull();
      if (ticker === 'FAILED') throw new Error('provider unavailable');
      return ticker === 'VALID' ? history : [];
    });
    expect(await enrichCandidateOutcomes(8, 1)).toEqual({ enriched: 0, skipped: 1, errors: 0 });
    expect(await enrichCandidateOutcomes(8, 1)).toEqual({ enriched: 1, skipped: 0, errors: 0 });
    expect(await enrichCandidateOutcomes(8, 1)).toEqual({ enriched: 0, skipped: 0, errors: 1 });
    expect(await enrichCandidateOutcomes(8, 1)).toEqual({ enriched: 0, skipped: 1, errors: 0 });
    expect(mocks.prices.mock.calls.map(call => call[0])).toEqual(['REJECTED', 'VALID', 'FAILED', 'REJECTED']);
    expect(mocks.findMany).toHaveBeenCalledTimes(5);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('does not fetch or write outcomes if cursor persistence fails', async () => {
    mocks.cursorWrite.mockRejectedValue(new Error('cursor unavailable'));
    await expect(enrichCandidateOutcomes()).rejects.toThrow('cursor unavailable');
    expect(mocks.prices).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('handles an empty cohort without moving the cursor or fetching prices', async () => {
    mocks.cursorRead.mockResolvedValue({ value: 'deleted-last-candidate' });
    mocks.findMany.mockResolvedValue([]);
    expect(await enrichCandidateOutcomes()).toEqual({ enriched: 0, skipped: 0, errors: 0 });
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.cursorWrite).not.toHaveBeenCalled();
    expect(mocks.prices).not.toHaveBeenCalled();
  });

  it('accepts finalized bars fetched after batch start without moving the age cutoff', async () => {
    const fetchedAt = Date.parse('2026-11-01T00:00:01Z');
    mocks.prices.mockImplementation(async () => {
      vi.setSystemTime(fetchedAt);
      return history.map(bar => ({ ...bar, fetchedAt }));
    });
    expect(await enrichCandidateOutcomes()).toEqual({ enriched: 1, skipped: 0, errors: 0 });
    expect(mocks.findMany.mock.calls[0][0].where.scanDate.lte).toEqual(new Date('2026-10-24T00:00:00Z'));
    expect(mocks.update.mock.calls[0][0].data.enrichedAt).toEqual(new Date(fetchedAt));
  });

  it('includes favorable movement after a stop touch, so MFE is not an achieved trade exit', () => {
    const result = computeForwardMetrics(100, 100, 95, [
      { date: '2026-01-02', close: 96, high: 100, low: 94 },
      { date: '2026-01-05', close: 115, high: 120, low: 110 },
    ]);
    expect(result.stopHit).toBe(true);
    expect(result.mfeR).toBe(4);
    expect(result.reached3R).toBe(true);
  });
});