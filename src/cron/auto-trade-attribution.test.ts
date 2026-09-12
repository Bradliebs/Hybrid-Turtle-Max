import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buy: vi.fn(), order: vi.fn(), stop: vi.fn(), position: vi.fn(), entry: vi.fn(),
  execution: vi.fn(), link: vi.fn(), prices: vi.fn(), history: vi.fn(), cancel: vi.fn(), committed: false,
}));
vi.mock('@/lib/prisma', () => ({ default: {
  user: { findUnique: async () => ({ t212ApiKey: 'test-key', t212Connected: true, t212Environment: 'demo' }) },
  stock: { findUnique: async () => ({ currency: 'GBP', ticker: 'TEST' }) },
  executionLog: { create: mocks.execution },
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    const result = await callback({ position: { create: mocks.position }, tradeLog: { create: mocks.entry } });
    mocks.committed = true;
    return result;
  },
} }));
vi.mock('@/lib/trading212', () => ({
  Trading212Error: class extends Error {
    constructor(message: string, public statusCode: number) { super(message); }
  },
  Trading212Client: class {
    getPositions = async () => [];
    placeMarketOrder = mocks.buy;
    getOrder = mocks.order;
    placeStopOrder = mocks.stop;
    getOrderHistory = mocks.history;
    cancelOrder = mocks.cancel;
  },
}));
vi.mock('@/lib/crypto', () => ({ decryptField: (value: string) => value }));
vi.mock('@/lib/candidate-outcome', () => ({ linkTradeToOutcome: mocks.link }));
vi.mock('@/lib/persist-scan-snapshot', () => ({ persistScanSnapshot: vi.fn() }));
vi.mock('@/lib/market-data', () => ({ getMarketRegime: async () => 'BULLISH', getBatchPrices: mocks.prices }));
vi.mock('@/lib/scan-engine', () => ({}));
vi.mock('@/lib/position-sync', () => ({}));
vi.mock('@/lib/telegram', () => ({}));
vi.mock('@/lib/alert-service', () => ({ sendAlert: vi.fn() }));
vi.mock('@/lib/cron-logger', () => ({}));
vi.mock('../../packages/workflow/src', () => ({}));

import { executeTrade, fetchEntryReferencePrices, type EntryReferenceEvidence } from './auto-trade';
import { Trading212Error } from '@/lib/trading212';

const candidate = {
  stockId: 'stock-1', ticker: 'TEST', t212Ticker: 'TEST_US_EQ', entryPrice: 100,
  stopPrice: 95, shares: 2, sleeve: 'CORE', accountType: 'invest' as const,
  rankScore: 80, scanId: 'execution-scan-1',
};

const entryReference: EntryReferenceEvidence = {
  version: 1, decisionId: 'decision-1', userId: 'user-1', scanId: 'execution-scan-1',
  session: 'us', ticker: 'TEST', source: 'GET_BATCH_PRICES', priceBasis: 'UNVERIFIED', executableQuote: false,
  providerQuoteTime: null, bid: null, ask: null,
  fetchStartedAt: '2026-09-11T14:45:00.000Z', fetchCompletedAt: '2026-09-11T14:45:01.000Z',
  fetchError: null,
  evaluatedAt: '2026-09-11T14:45:02.000Z', scanPrice: 100, entryTrigger: 100,
  plannedStop: 95, referencePrice: 101, action: 'KEEP', reason: null,
};

describe('automated entry attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.committed = false;
    mocks.buy.mockResolvedValue({ id: 123 });
    mocks.order.mockResolvedValue({ filledQuantity: 2, filledValue: 200 });
    mocks.stop.mockResolvedValue({ id: 456 });
    mocks.position.mockResolvedValue({ id: 'position-1' });
    mocks.entry.mockResolvedValue({ id: 'entry-1' });
    mocks.execution.mockResolvedValue({});
    mocks.history.mockResolvedValue([]);
    mocks.cancel.mockResolvedValue(undefined);
    mocks.link.mockImplementation(async () => {
      expect(mocks.committed).toBe(true);
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('links the actual committed entry to the supplied decision scan', async () => {
    const pending = executeTrade('user-1', candidate);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ success: true, stopPlaced: true, positionId: 'position-1' });
    expect(mocks.link).toHaveBeenCalledWith('execution-scan-1', 'TEST', 'entry-1', 100);
    expect(mocks.buy).toHaveBeenCalledWith({ quantity: 2, ticker: 'TEST_US_EQ' });
    expect(mocks.stop).toHaveBeenCalledWith({ quantity: -2, stopPrice: 95, ticker: 'TEST_US_EQ', timeValidity: 'GOOD_TILL_CANCEL' });
    const complete = mocks.execution.mock.calls.find(([args]) => args.data.phase === 'COMPLETE')![0].data;
    expect(JSON.parse(complete.requestBody)).toEqual({ positionId: 'position-1', tradeLogId: 'entry-1',
      scanId: 'execution-scan-1', candidateLinked: true });
  });

  it.each(['missing-scan', 'missing-entry', 'link-rejected'])('preserves the filled position when attribution is %s', async (failure) => {
    if (failure === 'missing-entry') mocks.entry.mockRejectedValueOnce(new Error('entry write unavailable'));
    if (failure === 'link-rejected') mocks.link.mockResolvedValueOnce(false);
    const pending = executeTrade('user-1', { ...candidate,
      scanId: failure === 'missing-scan' ? null : candidate.scanId });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ success: true, stopPlaced: true, positionId: 'position-1' });
    expect(mocks.execution).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      phase: 'ATTRIBUTION_PENDING', orderId: '123', accountType: 'invest',
    }) }));
    if (failure !== 'link-rejected') expect(mocks.link).not.toHaveBeenCalled();
  });

  it('does not link an order rejected before a fill', async () => {
    mocks.buy.mockRejectedValueOnce(new Error('order rejected'));
    const result = await executeTrade('user-1', candidate);
    expect(result.success).toBe(false);
    expect(mocks.position).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains reference evidence without changing broker payloads (rejected=%s)', async rejected => {
    vi.setSystemTime(new Date('2026-09-11T14:46:00.000Z'));
    if (rejected) mocks.buy.mockRejectedValueOnce(new Error('order rejected'));
    const pending = executeTrade('user-1', { ...candidate, entryReference });
    await vi.runAllTimersAsync();
    expect((await pending).success).toBe(!rejected);
    expect(mocks.buy).toHaveBeenCalledExactlyOnceWith({ quantity: 2, ticker: 'TEST_US_EQ' });
    const phase = rejected ? 'BUY_FAILED' : 'BUY_PLACED';
    const row = mocks.execution.mock.calls.find(([args]) => args.data.phase === phase)![0].data;
    expect(JSON.parse(row.requestBody)).toEqual({ quantity: 2, ticker: 'TEST_US_EQ', userId: 'user-1',
      scanId: 'execution-scan-1', submissionStartedAt: '2026-09-11T14:46:00.000Z', entryReference });
    if (!rejected) expect(row.orderId).toBe('123');
  });

  it('marks reference evidence as missing for callers without a captured quote', async () => {
    mocks.buy.mockRejectedValueOnce(new Error('order rejected'));
    await executeTrade('user-1', candidate);
    const row = mocks.execution.mock.calls.find(([args]) => args.data.phase === 'BUY_FAILED')![0].data;
    expect(JSON.parse(row.requestBody).entryReference).toBeNull();
  });

  it('continues protecting a fill if observational log persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.execution.mockRejectedValue(new Error('log unavailable'));
    const pending = executeTrade('user-1', { ...candidate, entryReference });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ success: true, stopPlaced: true });
    expect(console.error).toHaveBeenCalledWith('[ExecutionLog] Failed to write log:', expect.any(Error));
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({ quantity: -2, stopPrice: 95,
      ticker: 'TEST_US_EQ', timeValidity: 'GOOD_TILL_CANCEL' });
  });

  it('captures the real response window and preserves the same forced-refresh price object', async () => {
    vi.setSystemTime(new Date('2026-09-11T14:45:00.000Z'));
    const prices = { TEST: 101, MISSING: NaN };
    mocks.prices.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-11T14:45:03.000Z'));
      return prices;
    });
    const batch = await fetchEntryReferencePrices(['TEST', 'MISSING']);
    expect(mocks.prices).toHaveBeenCalledExactlyOnceWith(['TEST', 'MISSING'], true);
    expect(batch.prices).toBe(prices);
    expect(batch).toMatchObject({ fetchStartedAt: '2026-09-11T14:45:00.000Z',
      fetchCompletedAt: '2026-09-11T14:45:03.000Z', fetchError: null });
    vi.setSystemTime(new Date('2026-09-11T14:46:00.000Z'));
    expect(batch.fetchCompletedAt).toBe('2026-09-11T14:45:03.000Z');
  });

  it('retains the existing empty-price failure path and records fetch failure explicitly', async () => {
    mocks.prices.mockRejectedValueOnce(new Error('provider unavailable'));
    const batch = await fetchEntryReferencePrices(['TEST']);
    expect(batch.prices).toEqual({});
    expect(batch.fetchError).toBe('provider unavailable');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('provider unavailable'));
  });

  it.each([
    ['pending-value', 'ORDER_VALUE_OVER_QUANTITY', 101, 3],
    ['planned-fallback', 'PLANNED_ENTRY_FALLBACK', 100, 3],
    ['history', 'HISTORY_HELPER', 101, 3],
    ['timeout', 'TIMEOUT_RECOVERY', 101, 60],
  ] as const)('records %s fill provenance before stop handling without changing execution', async (route, source, price, seconds) => {
    vi.setSystemTime(new Date('2026-09-11T14:46:00.000Z'));
    mocks.order.mockResolvedValue({ filledQuantity: 2, filledValue: route === 'planned-fallback' ? 0 : 202 });
    mocks.history.mockResolvedValue([{ id: 123, filledQuantity: 2, filledValue: 202, fills: [] }]);
    if (route === 'history') mocks.order.mockRejectedValue(new Trading212Error('gone', 404));
    if (route === 'timeout') mocks.order.mockResolvedValue({ filledQuantity: 0, filledValue: 0 });
    mocks.stop.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-11T14:48:00.000Z'));
      return { id: 456 };
    });
    const pending = executeTrade('user-1', { ...candidate, entryReference });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ success: true, stopPlaced: true, filledPrice: price });
    expect(mocks.buy).toHaveBeenCalledExactlyOnceWith({ quantity: 2, ticker: 'TEST_US_EQ' });
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({ quantity: -2, stopPrice: price - 5,
      ticker: 'TEST_US_EQ', timeValidity: 'GOOD_TILL_CANCEL' });
    const complete = mocks.execution.mock.calls.find(([args]) => args.data.phase === 'COMPLETE')![0].data;
    expect(complete.orderId).toBe('123');
    expect(complete.accountType).toBe('invest');
    expect(JSON.parse(complete.responseBody)).toEqual({ fillEvidence: {
      version: 1, userId: 'user-1', decisionId: 'decision-1', source,
      observedAt: new Date(Date.parse('2026-09-11T14:46:00.000Z') + seconds * 1000).toISOString(),
      brokerExecutionTime: null, usedPrice: price, usedQuantity: 2, priceBasis: 'UNVERIFIED',
    } });
    expect(mocks.cancel).toHaveBeenCalledTimes(route === 'timeout' ? 1 : 0);
  });
});