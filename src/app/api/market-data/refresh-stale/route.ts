/**
 * DEPENDENCIES
 * Consumed by: src/app/scan/page.tsx (stale-data fix button)
 * Consumes: packages/data/src/service.ts, packages/workflow/src/safety-controls.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Refreshes only stale instruments so scans can proceed. Designed for first-run and recovery scenarios.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../packages/data/src/prisma';
import { refreshUniverseDailyBars } from '../../../../../packages/data/src';
import { apiError } from '@/lib/api-response';

export async function POST() {
  try {
    // Find which instruments are stale
    const staleInstruments = await prisma.instrument.findMany({
      where: { isActive: true, isPriceDataStale: true },
      select: { symbol: true, staleReason: true },
    });

    if (staleInstruments.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No stale instruments found.',
        refreshed: 0,
      });
    }

    const symbols = staleInstruments.map((i) => i.symbol);

    // Refresh only the stale symbols (not the full universe)
    const result = await refreshUniverseDailyBars({ symbols, force: true });

    const stillStale = result.results.filter((r) => r.staleAfterRun);

    return NextResponse.json({
      ok: true,
      message: stillStale.length === 0
        ? `Refreshed ${result.succeededSymbols} symbol${result.succeededSymbols === 1 ? '' : 's'}. All data is now current.`
        : `Refreshed ${result.succeededSymbols} of ${symbols.length}. ${stillStale.length} still stale.`,
      refreshed: result.succeededSymbols,
      stillStale: stillStale.length,
      symbols: result.results.map((r) => ({ symbol: r.symbol, status: r.status })),
    });
  } catch (error) {
    return apiError(
      500,
      'REFRESH_FAILED',
      'Failed to refresh stale market data.',
      error instanceof Error ? error.message : 'Unknown error',
      true,
    );
  }
}
