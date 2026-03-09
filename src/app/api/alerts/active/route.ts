/**
 * DEPENDENCIES
 * Consumed by: src/components/dashboard/SafetyAlertsPanel.tsx
 * Consumes: src/lib/api-response.ts, src/lib/safety-alerts.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 10 active-alert API. Optional `sync=true` triggers cooldown-controlled notification delivery.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getActiveSafetyAlerts, syncActiveSafetyAlerts } from '@/lib/safety-alerts';

export async function GET(request: NextRequest) {
  try {
    const sync = request.nextUrl.searchParams.get('sync') === 'true';
    const snapshot = sync ? await syncActiveSafetyAlerts() : await getActiveSafetyAlerts();
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('GET /api/alerts/active error:', error);
    return apiError(500, 'ACTIVE_ALERTS_FAILED', 'Failed to load active safety alerts', (error as Error).message, true);
  }
}