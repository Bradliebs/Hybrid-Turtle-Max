/**
 * DEPENDENCIES
 * Consumed by: BackupPanel.tsx (settings page), restore-backup.bat
 * Consumes: db-backup.ts
 * Risk-sensitive: YES (replaces the live database!)
 * Last modified: 2026-03-04
 * Notes: POST restores a named backup file over dev.db.
 *        Creates a pre-restore safety backup automatically.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';

/**
 * POST /api/backup/restore
 * Body: { filename: "dev.db.backup-2026-03-04-1430" }
 * Restores the named backup over the live database.
 */
export async function POST(): Promise<NextResponse> {
  return apiError(
    409,
    'MAINTENANCE_MODE_REQUIRED',
    'Database restore is disabled while the app is running. Stop the app and run restore-backup.bat.',
  );
}
