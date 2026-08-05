import { describe, expect, it, vi } from 'vitest';
import type { T212HistoricalOrder } from './trading212';
import { getHistoricalFill, recoverTimedOutBuy } from './buy-timeout-recovery';

function makeHistory(overrides: Partial<T212HistoricalOrder> = {}): T212HistoricalOrder {
  return {
    id: 123,
    ticker: 'ALVd_EQ',
    type: 'MARKET',
    side: 'BUY',
    status: 'FILLED',
    quantity: 0.54,
    filledQuantity: 0.54,
    filledValue: 226.476,
    dateCreated: '2026-07-03T07:00:04Z',
    dateExecuted: '2026-07-03T07:00:05Z',
    ...overrides,
  };
}

function makeClient(history: T212HistoricalOrder[] = []) {
  return {
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    getOrderHistory: vi.fn().mockResolvedValue(history),
  };
}

describe('recoverTimedOutBuy', () => {
  it('releases only when exact history confirms terminal cancellation without a fill', async () => {
    const client = makeClient([makeHistory({ status: 'CANCELLED', filledQuantity: 0, filledValue: 0 })]);

    await expect(recoverTimedOutBuy(client, 123)).resolves.toEqual({ status: 'CANCELLED' });
    expect(client.cancelOrder).toHaveBeenCalledWith(123);
  });

  it('recovers a fill only from the exact broker order ID', async () => {
    const client = makeClient([makeHistory()]);

    await expect(recoverTimedOutBuy(client, 123)).resolves.toEqual({
      status: 'FILLED',
      filledQuantity: 0.54,
      filledPrice: 419.4,
    });
  });

  it('does not attribute another same-ticker order to this timeout', async () => {
    const client = makeClient([makeHistory({ id: 999 })]);

    await expect(recoverTimedOutBuy(client, 123)).resolves.toEqual({
      status: 'UNRESOLVED',
      error: 'Order 123 is not yet terminal in broker history',
    });
  });

  it('does not release immediately after cancellation acceptance', async () => {
    const client = makeClient([]);

    await expect(recoverTimedOutBuy(client, 123)).resolves.toEqual({
      status: 'UNRESOLVED',
      error: 'Order 123 is not yet terminal in broker history',
    });
  });

  it('accepts exact fill history even when the cancellation request failed', async () => {
    const client = makeClient([makeHistory()]);
    client.cancelOrder.mockRejectedValue(new Error('already filled'));

    await expect(recoverTimedOutBuy(client, 123)).resolves.toMatchObject({ status: 'FILLED' });
  });

  it('remains unresolved when broker history cannot be read', async () => {
    const client = makeClient();
    client.getOrderHistory.mockRejectedValue(new Error('history unavailable'));

    await expect(recoverTimedOutBuy(client, 123)).resolves.toEqual({
      status: 'UNRESOLVED',
      error: 'Order cancellation was not independently verified: history unavailable',
    });
  });
});

describe('getHistoricalFill', () => {
  it('ignores a filled order with a different ID', () => {
    expect(getHistoricalFill([makeHistory({ id: 999 })], 123)).toBeNull();
  });
});