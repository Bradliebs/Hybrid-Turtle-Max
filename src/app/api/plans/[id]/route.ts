/**
 * DEPENDENCIES
 * Consumed by: frontend (planned trade editing)
 * Consumes: packages/data/src/prisma.ts, src/lib/api-response.ts, src/lib/request-validation.ts
 * Risk-sensitive: NO — status transitions only, no execution
 * Last modified: 2026-03-09
 * Notes: Phase 7 gap fix — PATCH a planned trade (status, notes, quantity updates).
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PlannedTradeStatus } from '@prisma/client';
import { prisma } from '../../../../../packages/data/src/prisma';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';

const VALID_STATUSES = Object.values(PlannedTradeStatus);

const patchSchema = z.object({
  status: z.enum(VALID_STATUSES as [string, ...string[]]).optional(),
  notes: z.string().max(2000).optional(),
  plannedQuantity: z.number().positive().optional(),
  plannedEntryPrice: z.number().positive().optional(),
  plannedStopPrice: z.number().positive().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// Allowed status transitions to prevent invalid jumps
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['READY', 'DRAFT', 'CANCELLED'],
  READY: ['SUBMITTED', 'APPROVED', 'CANCELLED'],
  SUBMITTED: ['FILLED', 'CANCELLED', 'REJECTED'],
  FILLED: [],
  CANCELLED: ['DRAFT'],
  REJECTED: ['DRAFT'],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return apiError(400, 'INVALID_REQUEST', 'Planned trade ID is required');
    }

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const existing = await prisma.plannedTrade.findUnique({ where: { id } });
    if (!existing) {
      return apiError(404, 'PLANNED_TRADE_NOT_FOUND', `Planned trade ${id} not found`);
    }

    // Validate status transition if status is being changed
    if (parsed.data.status && parsed.data.status !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(parsed.data.status)) {
        return apiError(
          400,
          'INVALID_STATUS_TRANSITION',
          `Cannot transition from ${existing.status} to ${parsed.data.status}`,
          `Allowed transitions from ${existing.status}: ${allowed.join(', ') || 'none'}`
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.status) updateData.status = parsed.data.status;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
    if (parsed.data.plannedQuantity !== undefined) updateData.plannedQuantity = parsed.data.plannedQuantity;
    if (parsed.data.plannedEntryPrice !== undefined) updateData.plannedEntryPrice = parsed.data.plannedEntryPrice;
    if (parsed.data.plannedStopPrice !== undefined) updateData.plannedStopPrice = parsed.data.plannedStopPrice;

    const updated = await prisma.plannedTrade.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      trade: {
        id: updated.id,
        symbol: updated.symbol,
        side: updated.side,
        status: updated.status,
        plannedQuantity: updated.plannedQuantity.toNumber(),
        plannedEntryPrice: updated.plannedEntryPrice.toNumber(),
        plannedStopPrice: updated.plannedStopPrice.toNumber(),
        rationale: updated.rationale,
        notes: updated.notes,
        executionSessionDate: updated.executionSessionDate.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Planned trade patch error:', error);
    return apiError(500, 'PLANNED_TRADE_PATCH_FAILED', 'Failed to update planned trade', (error as Error).message, true);
  }
}
