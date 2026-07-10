import { describe, expect, it, vi } from 'vitest';
import type { T212Position } from './trading212';
import { recoverTimedOutBuy } from './buy-timeout-recovery';

function makePosition(ticker: string): T212Position {
  return {
    averagePricePaid: 419.4,
    createdAt: '2026-07-03T07:00:04Z',
    currentPrice: 423.3,
    instrument: {
      isin: 'TEST-ISIN',
      currencyCode: 'EUR',
      name: ticker,
      ticker,
    },
    quantity: 0.54,
    quantityAvailableForTrading: 0.54,
    quantityInPies: 0,
    walletImpact: {
      investedValue: 226.48,
      result: 2.1,
      resultCoef: 0.01,
      value: 228.58,
      valueInAccountCurrency: 195,
    },
  };
}

describe('recoverTimedOutBuy', () => {
  it('cancels a still-pending order and confirms no broker position exists', async () => {
    const client = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
      getPositions: vi.fn().mockResolvedValue([]),
    };

    await expect(recoverTimedOutBuy(client, 123, 'ALVd_EQ')).resolves.toEqual({ status: 'CANCELLED' });
    expect(client.cancelOrder).toHaveBeenCalledWith(123);
  });

  it('treats a fill racing with cancellation as filled', async () => {
    const client = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
      getPositions: vi.fn().mockResolvedValue([makePosition('ALVd_EQ')]),
    };

    await expect(recoverTimedOutBuy(client, 123, 'ALVd_EQ')).resolves.toEqual({
      status: 'FILLED',
      filledQuantity: 0.54,
      filledPrice: 419.4,
    });
  });

  it('reports unresolved exposure when cancellation fails and no fill is visible', async () => {
    const client = {
      cancelOrder: vi.fn().mockRejectedValue(new Error('broker unavailable')),
      getPositions: vi.fn().mockResolvedValue([]),
    };

    await expect(recoverTimedOutBuy(client, 123, 'ALVd_EQ')).resolves.toEqual({
      status: 'UNRESOLVED',
      error: 'Cancel failed: broker unavailable',
    });
  });

  it('does not claim cancellation when the position check fails', async () => {
    const client = {
      cancelOrder: vi.fn().mockResolvedValue(undefined),
      getPositions: vi.fn().mockRejectedValue(new Error('positions unavailable')),
    };

    await expect(recoverTimedOutBuy(client, 123, 'ALVd_EQ')).resolves.toEqual({
      status: 'UNRESOLVED',
      error: 'Order cancellation was not independently verified: positions unavailable',
    });
  });
});