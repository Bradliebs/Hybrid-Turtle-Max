/**
 * DEPENDENCIES
 * Consumed by: Vitest Phase 13 CI suite
 * Consumes: mock-adapter.ts, docs/fixtures/mock-broker-state.json
 * Risk-sensitive: NO — adapter contract verification against mock fixture data only
 * Last modified: 2026-03-09
 * Notes: Covers the explicit Phase 13 requirement for broker adapter contract tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/src/env', () => ({
  env: {
    BROKER_MOCK_DATA_FILE: './docs/fixtures/mock-broker-state.json',
  },
}));

describe('MockBrokerAdapter', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns the fixture portfolio snapshot', async () => {
    const { MockBrokerAdapter } = await import('./mock-adapter');
    const adapter = new MockBrokerAdapter();

    const portfolio = await adapter.getPortfolio();

    expect(portfolio.accountId).toBe('demo-invest-001');
    expect(portfolio.currency).toBe('USD');
    expect(portfolio.totalMarketValue).toBe(35810);
  });

  it('normalizes broker dates from the fixture into Date objects', async () => {
    const { MockBrokerAdapter } = await import('./mock-adapter');
    const adapter = new MockBrokerAdapter();

    const positions = await adapter.getPositions();
    const orders = await adapter.getOrders();

    expect(positions).toHaveLength(3);
    expect(positions[0]?.updatedAt).toBeInstanceOf(Date);
    expect(orders[0]?.submittedAt).toBeInstanceOf(Date);
    expect(orders[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it('returns a dry-run order payload for placeOrder', async () => {
    const { MockBrokerAdapter } = await import('./mock-adapter');
    const adapter = new MockBrokerAdapter();

    const result = await adapter.placeOrder({
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 5,
      limitPrice: 180,
    });

    expect(result.status).toBe('PENDING');
    expect(result.rawPayload).toMatchObject({
      adapter: 'mock',
      dryRun: true,
      input: {
        symbol: 'AAPL',
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: 5,
        limitPrice: 180,
      },
    });
  });

  it('returns instrument metadata when a symbol exists in the fixture', async () => {
    const { MockBrokerAdapter } = await import('./mock-adapter');
    const adapter = new MockBrokerAdapter();

    const instrument = await adapter.getInstrumentMeta('SPY');

    expect(instrument).toMatchObject({
      symbol: 'SPY',
      exchange: 'NYSEARCA',
      assetType: 'ETF',
    });
  });
});