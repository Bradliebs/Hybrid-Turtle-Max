/**
 * DEPENDENCIES
 * Consumed by: frontend (risk evaluation)
 * Consumes: packages/risk/src/index.ts, src/lib/api-response.ts, src/lib/request-validation.ts
 * Risk-sensitive: NO — read-only risk assessment, does not execute trades
 * Last modified: 2026-03-09
 * Notes: Phase 6 gap fix — standalone risk evaluation for a batch of candidate trades.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCandidateBatch } from '../../../../../packages/risk/src';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';

const evaluatePlanSchema = z.object({
  candidates: z.array(z.object({
    symbol: z.string().trim().min(1),
    entryPrice: z.number().positive(),
    stopPrice: z.number().positive(),
  })).min(1).max(50),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, evaluatePlanSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { accountState, assessments } = await validateCandidateBatch(parsed.data.candidates);

    return NextResponse.json({
      accountState,
      assessments: assessments.map((a) => ({
        symbol: a.symbol,
        approved: a.approved,
        rationale: a.rationale,
        sizing: a.sizing,
        violations: a.violations,
      })),
    });
  } catch (error) {
    console.error('Risk evaluate-plan error:', error);
    return apiError(500, 'RISK_EVALUATE_FAILED', 'Failed to evaluate plan risk', (error as Error).message, true);
  }
}
