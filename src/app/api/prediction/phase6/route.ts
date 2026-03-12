export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: /prediction-status page, manual training trigger
 * Consumes: trainer.ts, ranker.ts, prisma.ts
 * Risk-sensitive: NO — advisory prediction model management
 * Last modified: 2026-03-11
 * Notes: GET returns model status + ranked READY candidates.
 *        POST triggers model training (manual action only).
 */

import { NextResponse } from 'next/server';
import { getModelStatus, trainModel } from '@/lib/prediction/phase6/trainer';
import { rankReadyCandidates } from '@/lib/prediction/phase6/ranker';
import prisma from '@/lib/prisma';

// ── GET: Model status + ranked candidates ──────────────────────────

export async function GET() {
  try {
    const status = await getModelStatus();

    // Get current READY candidates from latest snapshot for ranking
    const latestSnapshot = await prisma.snapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    let ranking = null;
    if (latestSnapshot) {
      const readyTickers = await prisma.snapshotTicker.findMany({
        where: {
          snapshotId: latestSnapshot.id,
          status: { in: ['READY', 'WATCH'] },
        },
        select: {
          ticker: true,
          adx14: true,
          atrPct: true,
          marketRegime: true,
          volRatio: true,
          bisScore: true,
          rsVsBenchmarkPct: true,
          distanceTo20dHighPct: true,
          entropy63: true,
          netIsolation: true,
          smartMoney21: true,
          fractalDim: true,
          complexity: true,
        },
      });

      // We need NCS/BQS/FWS — check ScoreBreakdown for these tickers
      const recentScores = await prisma.scoreBreakdown.findMany({
        where: {
          ticker: { in: readyTickers.map((t) => t.ticker) },
        },
        orderBy: { scoredAt: 'desc' },
        distinct: ['ticker'],
        select: {
          ticker: true,
          ncsTotal: true,
          bqsTotal: true,
          fwsTotal: true,
        },
      });

      const scoreMap = new Map(recentScores.map((s) => [s.ticker, s]));

      const candidates = readyTickers.map((t) => {
        const scores = scoreMap.get(t.ticker);
        return {
          ticker: t.ticker,
          features: {
            ncs: scores?.ncsTotal ?? null,
            bqs: scores?.bqsTotal ?? null,
            fws: scores?.fwsTotal ?? null,
            adx: t.adx14,
            atrPct: t.atrPct,
            regime: t.marketRegime,
            efficiency: null,
            relativeStrength: t.rsVsBenchmarkPct,
            volRatio: t.volRatio,
            bisScore: t.bisScore,
            distancePct: t.distanceTo20dHighPct,
            entropy63: t.entropy63,
            netIsolation: t.netIsolation,
            smartMoney21: t.smartMoney21,
            fractalDim: t.fractalDim,
            complexity: t.complexity,
          },
        };
      });

      if (candidates.length > 0) {
        ranking = rankReadyCandidates(candidates);
      }
    }

    return NextResponse.json({
      ok: true,
      status,
      ranking,
    });
  } catch (error) {
    console.error('[phase6] Status error:', error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// ── POST: Train the model ──────────────────────────────────────────

export async function POST() {
  try {
    const result = await trainModel();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[phase6] Training error:', error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
