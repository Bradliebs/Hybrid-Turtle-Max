import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), completions: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { tradeLog: { findMany: mocks.findMany },
  executionLog: { findMany: mocks.completions } } }));

import { GET } from './route';

beforeEach(() => {
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.completions.mockReset().mockResolvedValue([]);
});

describe('execution-drag response contract', () => {
  it('serializes a planned fallback as missing measurement with explicit provenance', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'entry', userId: 'test-user', positionId: 'position',
      ticker: 'TEST', shares: 2, tradeDate: new Date('2026-06-01'), plannedEntry: 100,
      actualFill: 100, initialStop: 95, finalRMultiple: null }]);
    mocks.completions.mockResolvedValue([{ ticker: 'TEST', orderId: '123', accountType: 'isa',
      requestBody: JSON.stringify({ tradeLogId: 'entry', positionId: 'position' }),
      responseBody: JSON.stringify({ fillEvidence: { version: 1, userId: 'test-user', decisionId: null,
        source: 'PLANNED_ENTRY_FALLBACK', observedAt: '2026-06-01T12:00:00.000Z',
        brokerExecutionTime: null, usedPrice: 100, usedQuantity: 2, priceBasis: 'UNVERIFIED' } }),
    }]);
    const response = await GET(new Request('http://localhost/api/analytics/execution-drag?userId=test-user'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.records[0]).toMatchObject({ fillEvidenceStatus: 'PLANNED_ENTRY_FALLBACK',
      actualEntry: null, entrySlippagePct: null, entryGapR: null });
    expect(body.summary).toMatchObject({ withFills: 0, withEntryGapPct: 0, withEntryGapR: 0,
      avgEntrySlippagePct: null, avgEntryGapR: null, fillEvidenceCounts: { PLANNED_ENTRY_FALLBACK: 1 } });
  });

  it('preserves null measurements and caveats instead of serializing zero performance', async () => {
    const response = await GET(new Request('http://localhost/api/analytics/execution-drag?userId=test-user'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toMatchObject({ measurement: 'PLANNED_TRIGGER_TO_FILL', withFills: 0,
      avgEntrySlippagePct: null, avgRDrag: null, avgDaysToFill: null, totalSlippageCostGbp: null });
    expect(body.summary.limitations).toHaveLength(5);
    expect(mocks.findMany.mock.calls[0][0].where.userId).toBe('test-user');
  });

  it('returns signed trigger-gap measurements through the production calculation', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'entry', ticker: 'TEST', tradeDate: new Date('2026-06-01'),
      plannedEntry: 100, actualFill: 99, initialStop: 95, finalRMultiple: null }]);
    const response = await GET(new Request('http://localhost/api/analytics/execution-drag'));
    const body = await response.json();
    expect(body.records[0]).toMatchObject({ entrySlippagePct: -1, entryGapR: -0.2, rDrag: null });
    expect(body.summary).toMatchObject({ withFills: 1, avgEntryGapR: -0.2, distinctMeasuredEntryDays: 1 });
  });
});