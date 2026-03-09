/**
 * DEPENDENCIES
 * Consumed by: optional external callers, future model diagnostics UI
 * Consumes: packages/model/src/index.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 12 model version manifest.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getModelVersions } from '../../../../../packages/model/src';

export async function GET() {
  return NextResponse.json({
    ok: true,
    versions: getModelVersions(),
  });
}