/**
 * DEPENDENCIES
 * Consumed by: frontend (audit log viewer)
 * Consumes: packages/data/src/prisma.ts, src/lib/api-response.ts
 * Risk-sensitive: NO — read-only
 * Last modified: 2026-03-09
 * Notes: Phase 13 gap fix — generic audit event log with pagination and filtering.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../packages/data/src/prisma';
import { apiError } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const eventType = searchParams.get('eventType');
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 500);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

    const where: Record<string, unknown> = {};
    if (eventType) where.eventType = eventType;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        entityType: e.entityType,
        entityId: e.entityId,
        payloadJson: e.payloadJson,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Audit events fetch error:', error);
    return apiError(500, 'AUDIT_EVENTS_FAILED', 'Failed to fetch audit events', (error as Error).message, true);
  }
}
