/**
 * DEPENDENCIES
 * Consumed by: frontend (signal run history)
 * Consumes: packages/data/src/prisma.ts, src/lib/api-response.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 5 gap fix — GET signal run by ID with candidates.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../packages/data/src/prisma';
import { apiError } from '@/lib/api-response';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return apiError(400, 'INVALID_REQUEST', 'Signal run ID is required');
    }

    const run = await prisma.signalRun.findUnique({
      where: { id },
      include: {
        candidates: {
          orderBy: { rankScore: 'desc' },
        },
      },
    });

    if (!run) {
      return apiError(404, 'SIGNAL_RUN_NOT_FOUND', `Signal run ${id} not found`);
    }

    return NextResponse.json({
      run: {
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        status: run.status,
        runType: run.runType,
        strategyName: run.strategyName,
        regime: run.regime,
        source: run.source,
        universeSize: run.universeSize,
        staleSymbolCount: run.staleSymbolCount,
        notes: run.notes,
        parametersJson: run.parametersJson,
        candidateCount: run.candidates.length,
        candidates: run.candidates.map((c) => ({
          id: c.id,
          symbol: c.symbol,
          currentPrice: c.currentPrice,
          triggerPrice: c.triggerPrice,
          initialStop: c.initialStop,
          stopDistancePercent: c.stopDistancePercent,
          riskPerShare: c.riskPerShare,
          setupStatus: c.setupStatus,
          rankScore: c.rankScore,
          reasons: c.reasonsJson,
          warnings: c.warningsJson,
        })),
      },
    });
  } catch (error) {
    console.error('Signal run fetch error:', error);
    return apiError(500, 'SIGNAL_RUN_FETCH_FAILED', 'Failed to fetch signal run', (error as Error).message, true);
  }
}
