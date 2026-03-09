/**
 * DEPENDENCIES
 * Consumed by: frontend (order history)
 * Consumes: packages/data/src/prisma.ts, src/lib/api-response.ts
 * Risk-sensitive: NO — read-only
 * Last modified: 2026-03-09
 * Notes: Phase 7 gap fix — broker order listing with pagination and filtering.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../packages/data/src/prisma';
import { apiError } from '@/lib/api-response';

function decimalToNumber(value: { toNumber(): number } | null | undefined): number | null {
  return value ? value.toNumber() : null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status');
    const symbol = searchParams.get('symbol');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (symbol) where.symbol = symbol;

    const [orders, total] = await Promise.all([
      prisma.brokerOrder.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
        include: {
          instrument: { select: { name: true, exchange: true } },
        },
      }),
      prisma.brokerOrder.count({ where }),
    ]);

    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        brokerOrderId: o.brokerOrderId,
        symbol: o.symbol,
        instrumentName: o.instrument?.name ?? null,
        side: o.side,
        orderType: o.orderType,
        status: o.status,
        quantity: o.quantity.toNumber(),
        filledQuantity: decimalToNumber(o.filledQuantity),
        limitPrice: decimalToNumber(o.limitPrice),
        stopPrice: decimalToNumber(o.stopPrice),
        averageFillPrice: decimalToNumber(o.averageFillPrice),
        accountType: o.accountType,
        plannedTradeId: o.plannedTradeId,
        submittedAt: o.submittedAt?.toISOString() ?? null,
        updatedAt: o.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Broker orders fetch error:', error);
    return apiError(500, 'BROKER_ORDERS_FAILED', 'Failed to fetch broker orders', (error as Error).message, true);
  }
}
