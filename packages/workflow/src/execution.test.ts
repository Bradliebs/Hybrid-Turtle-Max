/**
 * DEPENDENCIES
 * Consumed by: Vitest Phase 13 CI suite
 * Consumes: execution.ts
 * Risk-sensitive: NO — test-only validation of planned-trade state transitions
 * Last modified: 2026-03-09
 * Notes: Covers the explicit Phase 13 requirement for plan state transition tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/src/prisma', () => ({
  prisma: {
    plannedTrade: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../broker/src/factory', () => ({
  getBrokerAdapter: vi.fn(),
}));

vi.mock('../../broker/src/repository', () => ({
  createAuditEvent: vi.fn(),
  upsertBrokerOrder: vi.fn(),
}));

vi.mock('./safety-controls', () => ({
  assertSubmissionAllowed: vi.fn(),
}));

import { PlannedTradeStatus } from '@prisma/client';
import { prisma } from '../../data/src/prisma';
import { createAuditEvent } from '../../broker/src/repository';
import { approvePlannedTrade, transitionPlannedTrade } from './execution';

describe('planned trade transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves a draft trade and writes an audit event', async () => {
    vi.mocked(prisma.plannedTrade.findUnique).mockResolvedValue({
      id: 'trade-1',
      symbol: 'AAPL',
      status: 'DRAFT',
    } as never);
    vi.mocked(prisma.plannedTrade.update).mockResolvedValue({ id: 'trade-1', status: 'APPROVED' } as never);

    const result = await approvePlannedTrade('trade-1');

    expect(result).toEqual({
      plannedTradeId: 'trade-1',
      symbol: 'AAPL',
      previousStatus: 'DRAFT',
      newStatus: 'APPROVED',
      success: true,
    });
    expect(prisma.plannedTrade.update).toHaveBeenCalledWith({
      where: { id: 'trade-1' },
      data: { status: PlannedTradeStatus.APPROVED },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      'PLANNED_TRADE_APPROVED',
      'PlannedTrade',
      'trade-1',
      { symbol: 'AAPL', previousStatus: 'DRAFT', newStatus: 'APPROVED' },
    );
  });

  it('rejects invalid transitions without mutating the trade', async () => {
    vi.mocked(prisma.plannedTrade.findUnique).mockResolvedValue({
      id: 'trade-2',
      symbol: 'MSFT',
      status: 'APPROVED',
    } as never);

    const result = await transitionPlannedTrade('trade-2', PlannedTradeStatus.SUBMITTED);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid transition: APPROVED → SUBMITTED.');
    expect(prisma.plannedTrade.update).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it('returns a not-found result for missing planned trades', async () => {
    vi.mocked(prisma.plannedTrade.findUnique).mockResolvedValue(null);

    const result = await transitionPlannedTrade('missing-trade', PlannedTradeStatus.APPROVED);

    expect(result).toEqual({
      plannedTradeId: 'missing-trade',
      symbol: '',
      previousStatus: '',
      newStatus: 'APPROVED',
      success: false,
      error: 'Trade not found.',
    });
  });
});