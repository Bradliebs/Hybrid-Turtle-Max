import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  position: { findFirst: vi.fn() },
}));

vi.mock('./prisma', () => ({ default: prismaMock }));

import { reconcileExecutionIntent } from './execution-reconciliation';

const submittedAt = new Date('2026-08-04T10:00:00Z');

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'operation-1',
    userId: 'user-1',
    stockId: 'stock-1',
    ticker: 'AAPL_US_EQ',
    accountType: 'invest',
    status: 'BROKER_OUTCOME_UNKNOWN',
    orderId: '101',
    stopOrderId: '202',
    positionId: 'position-1',
    requestedQuantity: 10,
    baselineQuantity: 5,
    baselineAveragePrice: 180,
    brokerSubmittedAt: submittedAt,
    ...overrides,
  };
}

function makeClient() {
  return {
    getPositions: vi.fn().mockResolvedValue([]),
    getPendingOrders: vi.fn().mockResolvedValue([]),
    getOrderHistory: vi.fn().mockResolvedValue([]),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
  };
}

function makePending(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    createdAt: '2026-08-04T10:00:01Z',
    currency: 'USD',
    extendedHours: false,
    filledQuantity: 0,
    filledValue: 0,
    initiatedFrom: 'API',
    instrument: { currency: 'USD', isin: 'US1', name: 'Apple', ticker: 'AAPL_US_EQ' },
    quantity: 10,
    side: 'BUY' as const,
    status: 'NEW',
    strategy: 'QUANTITY',
    ticker: 'AAPL_US_EQ',
    timeInForce: 'DAY' as const,
    type: 'MARKET',
    value: 0,
    ...overrides,
  };
}

function makeHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    ticker: 'AAPL_US_EQ',
    type: 'MARKET',
    side: 'BUY' as const,
    status: 'FILLED',
    quantity: 10,
    filledQuantity: 10,
    filledValue: 1850,
    dateCreated: '2026-08-04T10:00:01Z',
    dateExecuted: '2026-08-04T10:00:02Z',
    ...overrides,
  };
}

describe('reconcileExecutionIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([makeIntent()]);
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.position.findFirst.mockResolvedValue(null);
  });

  it('retains an unknown outcome during the grace period', async () => {
    const result = await reconcileExecutionIntent(
      'operation-1',
      makeClient(),
      new Date('2026-08-04T10:01:00Z'),
    );

    expect(result).toMatchObject({ released: false, status: 'RECONCILIATION_REQUIRED' });
  });

  it('releases only when exact broker history is terminal with no fill', async () => {
    const client = makeClient();
    client.getOrderHistory.mockResolvedValue([makeHistory({
      status: 'CANCELLED',
      filledQuantity: 0,
      filledValue: 0,
    })]);

    const result = await reconcileExecutionIntent(
      'operation-1',
      client,
      new Date('2026-08-04T10:03:00Z'),
    );

    expect(result).toMatchObject({ released: true, status: 'CANCELLED' });
  });

  it('keeps the intent blocked after requesting cancellation of an exact pending buy', async () => {
    const client = makeClient();
    client.getPendingOrders.mockResolvedValue([makePending()]);

    const result = await reconcileExecutionIntent('operation-1', client, new Date('2026-08-04T10:03:00Z'));

    expect(client.cancelOrder).toHaveBeenCalledWith(101);
    expect(result).toMatchObject({ released: false, status: 'RECONCILIATION_REQUIRED' });
    expect(result.message).toContain('awaiting terminal broker history');
  });

  it('releases a fill only when its database position and broker stop are verified', async () => {
    const client = makeClient();
    client.getOrderHistory.mockResolvedValue([makeHistory()]);
    client.getPendingOrders.mockResolvedValue([makePending({
      id: 202,
      side: 'SELL',
      type: 'STOP',
      quantity: -10,
    })]);
    prismaMock.position.findFirst.mockResolvedValue({ id: 'position-1' });

    const result = await reconcileExecutionIntent('operation-1', client, new Date('2026-08-04T10:03:00Z'));

    expect(result).toMatchObject({
      released: true,
      status: 'COMPLETED_RECONCILED',
      orderId: '101',
      positionId: 'position-1',
    });
  });

  it('retains a confirmed fill when protection cannot be verified', async () => {
    const client = makeClient();
    client.getOrderHistory.mockResolvedValue([makeHistory()]);

    const result = await reconcileExecutionIntent('operation-1', client, new Date('2026-08-04T10:03:00Z'));

    expect(result).toMatchObject({ released: false, status: 'RECONCILIATION_REQUIRED' });
    expect(result.message).toContain('broker stop');
  });

  it('never adopts or cancels a heuristic match when the exact order ID is missing', async () => {
    prismaMock.$queryRaw.mockResolvedValue([makeIntent({ orderId: null })]);
    const client = makeClient();
    client.getPendingOrders.mockResolvedValue([makePending({ id: 999 })]);
    client.getOrderHistory.mockResolvedValue([makeHistory({ id: 999 })]);

    const result = await reconcileExecutionIntent('operation-1', client, new Date('2026-08-04T10:03:00Z'));

    expect(result).toMatchObject({ released: false, status: 'RECONCILIATION_REQUIRED' });
    expect(result.message).toContain('No exact broker order ID');
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });
});