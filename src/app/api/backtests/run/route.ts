/**
 * DEPENDENCIES
 * Consumed by: src/app/backtest/page.tsx
 * Consumes: packages/backtest/src/index.ts, src/lib/request-validation.ts, src/lib/api-response.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 11 run endpoint. Validates a date range and stores the resulting backtest run for later retrieval.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAndStoreBacktest } from '../../../../../packages/backtest/src';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';

const requestSchema = z.object({
  startDate: z.string().trim().min(1),
  endDate: z.string().trim().min(1),
  replayDate: z.string().trim().min(1).nullable().optional(),
  mode: z.enum(['FULL', 'CORE_LITE']).optional(),
  sleeve: z.string().trim().min(1).nullable().optional(),
  regime: z.string().trim().min(1).nullable().optional(),
  ticker: z.string().trim().min(1).nullable().optional(),
  initialCapital: z.number().positive().max(1_000_000).optional(),
  riskPerTradePct: z.number().positive().max(25).optional(),
});

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, requestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const startDate = parseDate(parsed.data.startDate);
  const endDate = parseDate(parsed.data.endDate);
  const replayDate = parsed.data.replayDate ? parseDate(parsed.data.replayDate) : null;

  if (!startDate || !endDate) {
    return apiError(400, 'INVALID_DATE_RANGE', 'Backtest start and end dates must be valid ISO dates.');
  }
  if (startDate > endDate) {
    return apiError(400, 'INVALID_DATE_RANGE', 'Backtest start date must be on or before the end date.');
  }
  if (replayDate && (replayDate < startDate || replayDate > endDate)) {
    return apiError(400, 'INVALID_REPLAY_DATE', 'Replay date must sit inside the selected date range.');
  }

  try {
    const run = await runAndStoreBacktest({
      startDate,
      endDate,
      replayDate,
      mode: parsed.data.mode,
      sleeve: parsed.data.sleeve ?? null,
      regime: parsed.data.regime ?? null,
      ticker: parsed.data.ticker ?? null,
      initialCapital: parsed.data.initialCapital,
      riskPerTradePct: parsed.data.riskPerTradePct,
    });

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return apiError(
      500,
      'BACKTEST_RUN_FAILED',
      'Failed to run backtest.',
      error instanceof Error ? error.message : 'Unknown backtest failure',
      true,
    );
  }
}