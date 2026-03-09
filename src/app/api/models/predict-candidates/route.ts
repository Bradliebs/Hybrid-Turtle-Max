/**
 * DEPENDENCIES
 * Consumed by: optional external callers, scan experimentation workflows
 * Consumes: packages/model/src/index.ts, src/lib/request-validation.ts, src/lib/api-response.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 12 candidate scoring API. Advisory only.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyModelLayerToCandidates } from '../../../../../packages/model/src';
import type { ScanCandidate } from '@/types';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';

const candidateSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  name: z.string(),
  sleeve: z.enum(['CORE', 'HIGH_RISK', 'ETF', 'HEDGE']),
  sector: z.string(),
  cluster: z.string(),
  price: z.number(),
  entryTrigger: z.number(),
  stopPrice: z.number(),
  distancePercent: z.number(),
  status: z.string(),
  rankScore: z.number(),
  passesAllFilters: z.boolean(),
  technicals: z.object({
    currentPrice: z.number(),
    ma200: z.number(),
    adx: z.number(),
    plusDI: z.number(),
    minusDI: z.number(),
    atr: z.number(),
    atr20DayAgo: z.number(),
    atrSpiking: z.boolean(),
    medianAtr14: z.number(),
    atrPercent: z.number(),
    twentyDayHigh: z.number(),
    efficiency: z.number(),
    relativeStrength: z.number(),
    volumeRatio: z.number(),
    failedBreakoutAt: z.any().nullable(),
    weeklyAdx: z.number().optional(),
    bis: z.number().optional(),
  }),
  filterResults: z.object({
    priceAboveMa200: z.boolean(),
    adxAbove20: z.boolean(),
    plusDIAboveMinusDI: z.boolean(),
    atrPercentBelow8: z.boolean(),
    efficiencyAbove30: z.boolean(),
    dataQuality: z.boolean(),
  }).passthrough(),
  earningsInfo: z.any().optional(),
}).passthrough();

const requestSchema = z.object({
  candidates: z.array(candidateSchema),
  marketRegime: z.enum(['BULLISH', 'SIDEWAYS', 'BEARISH', 'NEUTRAL']).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, requestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = applyModelLayerToCandidates(parsed.data.candidates as ScanCandidate[], {
      enabled: parsed.data.enabled ?? true,
    }, parsed.data.marketRegime);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(500, 'MODEL_PREDICT_FAILED', 'Failed to score candidates.', (error as Error).message, true);
  }
}