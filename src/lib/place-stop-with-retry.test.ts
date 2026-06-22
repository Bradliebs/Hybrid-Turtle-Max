/**
 * Tests for placeStopWithRetry — the shared immediate widen-retry tier used by
 * the MANUAL portal buy path (src/app/api/positions/execute) per audit F1.
 *
 * The helper is pure aside from the injected client + sleep, so the contract
 * (retry, widen, terminal-abort, no-throw) is locked down here with a mock
 * client. A fake `sleep` keeps the test instant.
 */
import { describe, it, expect, vi } from 'vitest';
import { placeStopWithRetry, type StopOrderPlacer } from './place-stop-with-retry';
import { Trading212Error, type T212PendingOrder } from './trading212';
import { STOP_RETRY_WIDEN_FACTORS } from '@/cron/auto-trade';

const noSleep = async () => {};

/** Minimal filled-stop order — the helper only reads `.id`. */
function fakeOrder(id: number): T212PendingOrder {
  return { id } as T212PendingOrder;
}

function transient(): Trading212Error {
  return new Trading212Error('price too close', 400);
}

describe('placeStopWithRetry', () => {
  it('places on the first attempt at the exact intended stop (factor 1.0)', async () => {
    const placeStopOrder = vi.fn().mockResolvedValue(fakeOrder(111));
    const client: StopOrderPlacer = { placeStopOrder };

    const result = await placeStopWithRetry({
      client,
      t212Ticker: 'AAPL_US_EQ',
      filledPrice: 100,
      filledQuantity: 10,
      baseStopPrice: 95,
      sleep: noSleep,
    });

    expect(result.placed).toBe(true);
    expect(result.terminal).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.stopPrice).toBeCloseTo(95, 6);
    expect(result.orderId).toBe('111');
    expect(placeStopOrder).toHaveBeenCalledTimes(1);
    // Stop quantity must be negative (sell-to-close).
    expect(placeStopOrder.mock.calls[0][0].quantity).toBe(-10);
  });

  it('retries with a WIDER stop after a transient rejection, then succeeds', async () => {
    const placeStopOrder = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce(fakeOrder(222));
    const client: StopOrderPlacer = { placeStopOrder };

    const result = await placeStopWithRetry({
      client,
      t212Ticker: 'AAPL_US_EQ',
      filledPrice: 100,
      filledQuantity: 5,
      baseStopPrice: 95,
      sleep: noSleep,
    });

    expect(result.placed).toBe(true);
    expect(result.attempts).toHaveLength(2);
    // Second attempt widens the 5-point gap by factor 1.33 -> 93.35.
    expect(result.stopPrice).toBeCloseTo(93.35, 6);
    expect(result.stopPrice).toBeLessThan(95); // wider = further below entry
    expect(result.orderId).toBe('222');
  });

  it('exhausts all widen attempts on persistent transient failure (no throw)', async () => {
    const placeStopOrder = vi.fn().mockRejectedValue(transient());
    const client: StopOrderPlacer = { placeStopOrder };

    const result = await placeStopWithRetry({
      client,
      t212Ticker: 'AAPL_US_EQ',
      filledPrice: 100,
      filledQuantity: 10,
      baseStopPrice: 95,
      sleep: noSleep,
    });

    expect(result.placed).toBe(false);
    expect(result.terminal).toBe(false);
    expect(result.attempts).toHaveLength(STOP_RETRY_WIDEN_FACTORS.length);
    expect(placeStopOrder).toHaveBeenCalledTimes(STOP_RETRY_WIDEN_FACTORS.length);
    expect(result.attempts.every((a) => a.error !== undefined)).toBe(true);
  });

  it('aborts immediately on a terminal auth error (403) — widening cannot fix it', async () => {
    const placeStopOrder = vi.fn().mockRejectedValue(new Trading212Error('forbidden', 403));
    const client: StopOrderPlacer = { placeStopOrder };

    const result = await placeStopWithRetry({
      client,
      t212Ticker: 'AAPL_US_EQ',
      filledPrice: 100,
      filledQuantity: 10,
      baseStopPrice: 95,
      sleep: noSleep,
    });

    expect(result.placed).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(placeStopOrder).toHaveBeenCalledTimes(1);
    expect(result.attempts[0].statusCode).toBe(403);
  });
});
