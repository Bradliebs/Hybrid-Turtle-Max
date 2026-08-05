import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock('./prisma', () => ({ default: prismaMock }));

import { claimExecutionIntent, hashExecutionPayload, hasActiveBrokerSubmissionLease, updateExecutionIntent } from './execution-intent';

describe('execution-intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims a new operation atomically', async () => {
    prismaMock.$executeRaw.mockResolvedValue(1);

    await expect(claimExecutionIntent({
      operationId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      payloadHash: 'hash-1',
      stockId: 'stock-1',
      ticker: 'AAPL',
      accountType: 'invest',
      requestedQuantity: 10,
      stopPrice: 175,
    })).resolves.toEqual({ claimed: true });

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns the existing state when an operation was already claimed', async () => {
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.$queryRaw.mockResolvedValue([{
      operationId: '11111111-1111-4111-8111-111111111111',
      payloadHash: 'hash-1',
      status: 'BROKER_SUBMITTED',
      orderId: '12345',
      positionId: null,
    }]);

    await expect(claimExecutionIntent({
      operationId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      payloadHash: 'hash-1',
      stockId: 'stock-1',
      ticker: 'AAPL',
      accountType: 'invest',
      requestedQuantity: 10,
      stopPrice: 175,
    })).resolves.toEqual({
      claimed: false,
      operationId: '11111111-1111-4111-8111-111111111111',
      sameOperation: true,
      payloadMismatch: false,
      status: 'BROKER_SUBMITTED',
      orderId: '12345',
      positionId: null,
    });
  });

  it('detects reuse of an operation ID with different trade details', async () => {
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.$queryRaw.mockResolvedValue([{
      operationId: '11111111-1111-4111-8111-111111111111',
      payloadHash: 'different-hash',
      status: 'IN_PROGRESS',
      orderId: null,
      positionId: null,
    }]);

    const claim = await claimExecutionIntent({
      operationId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      payloadHash: 'hash-1',
      stockId: 'stock-1',
      ticker: 'AAPL',
      accountType: 'invest',
      requestedQuantity: 10,
      stopPrice: 175,
    });

    expect(claim).toMatchObject({ claimed: false, payloadMismatch: true });
  });

  it('blocks a new operation ID while an equivalent payload remains active', async () => {
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.$queryRaw.mockResolvedValue([{
      operationId: '22222222-2222-4222-8222-222222222222',
      payloadHash: 'hash-1',
      status: 'BROKER_OUTCOME_UNKNOWN',
      orderId: null,
      positionId: null,
    }]);

    const claim = await claimExecutionIntent({
      operationId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      payloadHash: 'hash-1',
      stockId: 'stock-1',
      ticker: 'AAPL',
      accountType: 'invest',
      requestedQuantity: 10,
      stopPrice: 175,
    });

    expect(claim).toMatchObject({
      claimed: false,
      operationId: '22222222-2222-4222-8222-222222222222',
      sameOperation: false,
      payloadMismatch: false,
      status: 'BROKER_OUTCOME_UNKNOWN',
    });
  });

  it('hashes equal parsed payloads consistently and records state updates', async () => {
    expect(hashExecutionPayload({ ticker: 'AAPL', quantity: 10 }))
      .toBe(hashExecutionPayload({ ticker: 'AAPL', quantity: 10 }));

    prismaMock.$executeRaw.mockResolvedValue(1);
    await expect(updateExecutionIntent('operation-1', {
      status: 'COMPLETED',
      orderId: '12345',
      positionId: 'position-1',
    })).resolves.toBeUndefined();
  });

  it('treats only fresh pyramid submissions as actively owned', () => {
    const now = Date.parse('2026-08-04T20:02:00Z');

    expect(hasActiveBrokerSubmissionLease(
      'PYRAMID_BROKER_SUBMITTED',
      new Date('2026-08-04T20:01:00Z'),
      now,
    )).toBe(true);
    expect(hasActiveBrokerSubmissionLease(
      'PYRAMID_BROKER_SUBMITTED',
      new Date('2026-08-04T19:59:00Z'),
      now,
    )).toBe(false);
    expect(hasActiveBrokerSubmissionLease(
      'PYRAMID_RECONCILIATION_REQUIRED',
      new Date('2026-08-04T20:01:00Z'),
      now,
    )).toBe(false);
  });
});