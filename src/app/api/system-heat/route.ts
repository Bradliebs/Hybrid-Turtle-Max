import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';
import { RISK_PROFILES } from '@/types';
import type { RiskProfileType } from '@/types';
import { computeSystemHeat } from '@/lib/system-heat';

export const dynamic = 'force-dynamic';

/**
 * System Heat — advisory-only analytics endpoint.
 * Computes capital deployment metrics during bullish regime weeks.
 * Display-only: no execution effect whatsoever.
 */

export async function GET() {
  try {
    const userId = await ensureDefaultUser();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { riskProfile: true },
    });
    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const profile = RISK_PROFILES[user.riskProfile as RiskProfileType];
    if (!profile) {
      return apiError(400, 'INVALID_PROFILE', 'Unknown risk profile');
    }

    // Look back 12 weeks for rolling calculations
    const lookbackDate = new Date();
    lookbackDate.setUTCDate(lookbackDate.getUTCDate() - 84);

    const [regimeRows, equitySnapshots, tradeLogs, openPositionCount] = await Promise.all([
      prisma.regimeHistory.findMany({
        where: { date: { gte: lookbackDate }, benchmark: 'SPY' },
        orderBy: { date: 'asc' },
        select: { date: true, regime: true },
      }),
      prisma.equitySnapshot.findMany({
        where: { userId, capturedAt: { gte: lookbackDate } },
        orderBy: { capturedAt: 'asc' },
        select: { capturedAt: true, openRiskPercent: true },
      }),
      prisma.tradeLog.findMany({
        where: { userId, tradeDate: { gte: lookbackDate }, decision: 'BUY' },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, regime: true },
      }),
      prisma.position.count({
        where: { userId, status: 'OPEN', stock: { sleeve: { not: 'HEDGE' } } },
      }),
    ]);

    const result = computeSystemHeat({
      maxRiskPct: profile.maxOpenRisk,
      maxPositions: profile.maxPositions,
      regimeRows,
      equitySnapshots,
      tradeLogs,
      openPositionCount,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[SystemHeat] Error:', error);
    return apiError(500, 'SYSTEM_HEAT_FAILED', 'Failed to compute system heat metrics', (error as Error).message, true);
  }
}
