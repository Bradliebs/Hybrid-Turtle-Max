import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), completions: vi.fn() }));
vi.mock('./prisma', () => ({ default: { tradeLog: { findMany: mocks.findMany },
  executionLog: { findMany: mocks.completions } } }));
import { computeExecutionDrag } from './execution-drag';

const trade = {
  id: 'entry-1', ticker: 'TEST', tradeDate: new Date('2026-06-01T12:00:00Z'),
  userId: 'user-1', positionId: 'position-1', shares: 2,
  plannedEntry: 100, actualFill: 101, initialStop: 95, finalRMultiple: 3.2,
};

beforeEach(() => {
  mocks.findMany.mockReset().mockResolvedValue([trade]);
  mocks.completions.mockReset().mockResolvedValue([]);
});

const evidence = {
  version: 1, userId: 'user-1', decisionId: 'decision-1', source: 'ORDER_VALUE_OVER_QUANTITY',
  observedAt: '2026-06-01T12:00:00.000Z', brokerExecutionTime: null,
  usedPrice: 101, usedQuantity: 2, priceBasis: 'UNVERIFIED',
};
const completion = {
  ticker: 'TEST', orderId: '123', accountType: 'invest',
  requestBody: JSON.stringify({ tradeLogId: 'entry-1', positionId: 'position-1' }),
  responseBody: JSON.stringify({ fillEvidence: evidence }),
};

describe('production execution-drag calculation', () => {
  it('excludes known planned fallback prices instead of counting them as zero-gap fills', async () => {
    mocks.findMany.mockResolvedValue([{ ...trade, actualFill: 100 }, { ...trade, id: 'legacy' }]);
    mocks.completions.mockResolvedValue([{ ...completion, responseBody: JSON.stringify({ fillEvidence: {
      ...evidence, usedPrice: 100, source: 'PLANNED_ENTRY_FALLBACK',
    } }) }]);
    const { records, summary } = await computeExecutionDrag();
    expect(records[0]).toMatchObject({ fillEvidenceStatus: 'PLANNED_ENTRY_FALLBACK', actualEntry: null,
      entrySlippagePct: null, entryGapR: null });
    expect(summary).toMatchObject({ withFills: 1, avgEntrySlippagePct: 1,
      fillEvidenceCounts: { PLANNED_ENTRY_FALLBACK: 1, LEGACY_UNVERIFIED: 1 } });
  });

  it.each(['ORDER_VALUE_OVER_QUANTITY', 'HISTORY_HELPER', 'TIMEOUT_RECOVERY'])('labels %s without claiming verification', async source => {
    mocks.completions.mockResolvedValue([{ ...completion, responseBody: JSON.stringify({ fillEvidence: { ...evidence, source } }) }]);
    expect((await computeExecutionDrag()).records[0]).toMatchObject({ fillEvidenceStatus: source, entrySlippagePct: 1 });
  });

  it.each([
    { ...evidence, version: 2 }, { ...evidence, userId: 'other-user' },
    { ...evidence, usedPrice: 99 }, { ...evidence, usedQuantity: 0 },
    { ...evidence, usedQuantity: 3 },
    { ...evidence, source: 'UNKNOWN' }, { ...evidence, observedAt: 'invalid' },
  ])('excludes unsupported or inconsistent fill evidence %#', async fillEvidence => {
    mocks.completions.mockResolvedValue([{ ...completion, responseBody: JSON.stringify({ fillEvidence }) }]);
    expect((await computeExecutionDrag()).records[0]).toMatchObject({ fillEvidenceStatus: 'INVALID_EVIDENCE', actualEntry: null });
  });

  it.each([
    { completions: [{ ...completion, responseBody: '{bad' }] },
    { completions: [completion, completion] },
    { completions: [{ ...completion, requestBody: JSON.stringify({ tradeLogId: 'entry-1', positionId: 'wrong' }) }] },
    { completions: [{ ...completion, requestBody: JSON.stringify({ tradeLogId: 'entry-1' }) }] },
    { completions: [{ ...completion, requestBody: JSON.stringify({ tradeLogId: 'entry-1', positionId: 123 }) }] },
    { completions: [{ ...completion, ticker: 'OTHER' }] },
    { completions: [completion, { ...completion, responseBody: JSON.stringify({ fillEvidence: { ...evidence, source: 'PLANNED_ENTRY_FALLBACK' } }) }] },
    { completions: [{ ...completion, accountType: 'N/A' }] },
    { completions: [{ ...completion, orderId: null }] },
  ])('excludes malformed, duplicate or mismatched completion rows %#', async ({ completions }) => {
    mocks.completions.mockResolvedValue(completions);
    expect((await computeExecutionDrag()).records[0]).toMatchObject({ fillEvidenceStatus: 'INVALID_EVIDENCE', entryGapR: null });
  });

  it('never joins a nearby same-ticker trade and keeps legacy data visibly unverified', async () => {
    mocks.completions.mockResolvedValue([{ ...completion, requestBody: JSON.stringify({ tradeLogId: 'other', positionId: 'position-1' }) }]);
    expect((await computeExecutionDrag()).records[0]).toMatchObject({ fillEvidenceStatus: 'LEGACY_UNVERIFIED', entrySlippagePct: 1 });
    mocks.completions.mockResolvedValue([{ ...completion, responseBody: null }]);
    expect((await computeExecutionDrag()).records[0].fillEvidenceStatus).toBe('LEGACY_UNVERIFIED');
  });

  it('propagates completion query failure instead of silently reverting to legacy metrics', async () => {
    mocks.completions.mockRejectedValue(new Error('evidence unavailable'));
    await expect(computeExecutionDrag()).rejects.toThrow('evidence unavailable');
  });

  it('cannot attribute corrupt request JSON and does not certify the legacy measurement', async () => {
    mocks.completions.mockResolvedValue([{ ...completion, requestBody: '{bad' }]);
    const result = await computeExecutionDrag();
    expect(result.records[0].fillEvidenceStatus).toBe('LEGACY_UNVERIFIED');
    expect(result.summary.limitations.join(' ')).toContain('Unreadable trade IDs cannot be attributed');
  });
  it('includes TAKEN entries, excludes exits and preserves account and date filters', async () => {
    const from = new Date('2026-05-01');
    const to = new Date('2026-07-01');
    await computeExecutionDrag({ userId: 'user-1', from, to });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      decision: { in: ['TAKEN', 'EXECUTED', 'BUY'] }, tradeType: 'ENTRY', userId: 'user-1',
      tradeDate: { gte: from, lte: to },
    });
  });

  it('measures signed entry movement in percent and planned-risk units, not model performance', async () => {
    const { records, summary } = await computeExecutionDrag();
    expect(records[0]).toMatchObject({ modelEntry: 100, actualEntry: 101, entrySlippagePct: 1,
      entryGapR: 0.2, modelR: null, actualR: 3.2, rDrag: null, daysToFill: null });
    expect(summary).toMatchObject({ measurement: 'PLANNED_TRIGGER_TO_FILL', eligibleEntryLogs: 1,
      withFills: 1, withEntryGapPct: 1, withEntryGapR: 1, distinctMeasuredEntryDays: 1,
      avgEntryGapR: 0.2, avgRDrag: null, totalSlippageCostGbp: null, avgDaysToFill: null });
    expect(summary.limitations).toContain('Trigger-to-fill movement is not isolated broker slippage or recoverable profit.');
  });

  it('retains better and exact fills without turning them into absolute costs', async () => {
    mocks.findMany.mockResolvedValue([trade, { ...trade, id: 'entry-2', actualFill: 99 },
      { ...trade, id: 'entry-3', actualFill: 100 }]);
    const { records, summary } = await computeExecutionDrag();
    expect(records.map(record => record.entryGapR)).toEqual([0.2, -0.2, 0]);
    expect(summary.avgEntrySlippagePct).toBe(0);
    expect(summary.medianEntrySlippagePct).toBe(0);
    expect(summary.p90EntrySlippagePct).toBe(1);
    expect(summary.distinctMeasuredEntryDays).toBe(1);
  });

  it('does not count stored slippage without fill evidence or invent a planned entry', async () => {
    mocks.findMany.mockResolvedValue([
      { ...trade, actualFill: null, slippagePct: 0.3 },
      { ...trade, id: 'missing-plan', plannedEntry: null, entryPrice: 101 },
    ]);
    const { records, summary } = await computeExecutionDrag();
    expect(records).toHaveLength(1);
    expect(records[0].entrySlippagePct).toBeNull();
    expect(summary).toMatchObject({ eligibleEntryLogs: 2, totalTrades: 1, withFills: 0,
      avgEntrySlippagePct: null, medianEntrySlippagePct: null, p90EntrySlippagePct: null,
      avgEntryGapR: null, distinctMeasuredEntryDays: 0 });
  });

  it.each([null, 0, -1, NaN, Infinity])('rejects invalid planned price %s', async plannedEntry => {
    mocks.findMany.mockResolvedValue([{ ...trade, plannedEntry }]);
    expect((await computeExecutionDrag()).records).toEqual([]);
  });

  it.each([null, 0, -1, NaN, Infinity])('does not measure an invalid fill %s', async actualFill => {
    mocks.findMany.mockResolvedValue([{ ...trade, actualFill }]);
    const { records, summary } = await computeExecutionDrag();
    expect(records[0]).toMatchObject({ actualEntry: null, entrySlippagePct: null, entryGapR: null });
    expect(summary.withFills).toBe(0);
  });

  it.each([null, 0, -1, 100, 101, NaN, Infinity])('keeps percent measurement but rejects invalid risk from stop %s', async initialStop => {
    mocks.findMany.mockResolvedValue([{ ...trade, initialStop }]);
    const { records, summary } = await computeExecutionDrag();
    expect(records[0].entrySlippagePct).toBe(1);
    expect(records[0].entryGapR).toBeNull();
    expect(summary.withEntryGapR).toBe(0);
  });

  it('returns missing values for an empty sample and propagates query failures', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect((await computeExecutionDrag()).summary).toMatchObject({ totalTrades: 0,
      avgEntrySlippagePct: null, avgEntryGapR: null, totalSlippageCostGbp: null });
    mocks.findMany.mockRejectedValue(new Error('database unavailable'));
    await expect(computeExecutionDrag()).rejects.toThrow('database unavailable');
  });

  it('normalizes the recorded ATRC gap by planned risk, not the larger fill-based initialR', async () => {
    mocks.findMany.mockResolvedValue([{ ...trade, ticker: 'ATRC', plannedEntry: 50.18764759772154,
      actualFill: 51.64, initialStop: 48.77500022888184, initialR: 2.864999771118164 }]);
    const { records } = await computeExecutionDrag();
    expect(records[0].entryGapR).toBeCloseTo(1.0281068257475765, 10);
    expect(records[0].entrySlippagePct).toBeCloseTo(2.893844345763662, 10);
    expect(records[0].rDrag).toBeNull();
  });

  it('does not emit nonfinite derived metrics or invalid dated records', async () => {
    mocks.findMany.mockResolvedValue([{ ...trade, plannedEntry: Number.MIN_VALUE, actualFill: Number.MAX_VALUE },
      { ...trade, id: 'invalid-date', tradeDate: new Date('invalid') }]);
    const { records, summary } = await computeExecutionDrag();
    expect(records).toHaveLength(1);
    expect(records[0].entrySlippagePct).toBeNull();
    expect(summary.withEntryGapPct).toBe(0);
  });
});
