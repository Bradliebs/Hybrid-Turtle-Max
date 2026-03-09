/**
 * DEPENDENCIES
 * Consumed by: src/components/dashboard/EveningReviewSummary.tsx
 * Consumes: packages/portfolio/src/index.ts, src/lib/api-response.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 summary API for the dashboard evening-review widget.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getEveningReviewSummary } from '../../../../../packages/portfolio/src';
import { apiError } from '@/lib/api-response';

export async function GET() {
  try {
    const summary = await getEveningReviewSummary();
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('Review summary error:', error);
    return apiError(500, 'REVIEW_SUMMARY_FAILED', 'Failed to fetch evening review summary', (error as Error).message, true);
  }
}