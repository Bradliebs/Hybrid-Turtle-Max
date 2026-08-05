/**
 * DEPENDENCIES
 * Consumed by: /api/backup/route.ts, /api/backup/restore/route.ts, nightly.ts
 * Consumes: fs, path (Node built-ins), better-sqlite3
 * Risk-sensitive: RESTORE IS DESTRUCTIVE (replaces live DB with a backup copy)
 * Last modified: 2026-03-04
 * Notes: SQLite DB backup utility. Uses SQLite's online backup API to write
 *        timestamped filename. Keeps only the 7 most recent backups.
 *        Restore copies a backup file OVER dev.db (creates a pre-restore backup first).
 *        Never throws — always returns a result object.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// ── Types ──

export interface BackupResult {
  success: boolean;
  filename: string | null;
  filepath: string | null;
  sizeBytes: number | null;
  error: string | null;
  timestamp: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

// ── Constants ──

const DB_FILENAME = 'dev.db';
const BACKUP_DIR = 'prisma/backups';
const MAX_BACKUPS = 7;

/** Resolve a path relative to the project root (process.cwd()) */
function projectPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

// ── Core backup function ──

export async function backupDatabase(): Promise<BackupResult> {
  const timestamp = new Date().toISOString();
  let incompleteBackupPath: string | null = null;

  try {
    // 1. Locate source DB
    const srcPath = projectPath('prisma', DB_FILENAME);
    if (!fs.existsSync(srcPath)) {
      return {
        success: false,
        filename: null,
        filepath: null,
        sizeBytes: null,
        error: `Source database not found at ${srcPath}`,
        timestamp,
      };
    }

    // 2. Ensure backup directory exists
    const backupDir = projectPath(BACKUP_DIR);
    fs.mkdirSync(backupDir, { recursive: true });

    // 3. Generate timestamped filename
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const timeStr = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');
    const filename = `${DB_FILENAME}.backup-${dateStr}-${timeStr}`;
    const destPath = path.join(backupDir, filename);
    incompleteBackupPath = destPath;

    // 4. Use SQLite's online backup API so committed WAL pages are included.
    const sourceDb = new Database(srcPath, { readonly: true, fileMustExist: true });
    try {
      await sourceDb.backup(destPath);
    } finally {
      sourceDb.close();
    }

    // 5. Verify copy
    if (!fs.existsSync(destPath)) {
      return {
        success: false,
        filename,
        filepath: destPath,
        sizeBytes: null,
        error: 'SQLite backup completed but the backup file was not found',
        timestamp,
      };
    }
    const destStats = fs.statSync(destPath);
    const backupDb = new Database(destPath, { readonly: true, fileMustExist: true });
    let integrityResult: string;
    try {
      integrityResult = backupDb.pragma('quick_check', { simple: true }) as string;
    } finally {
      backupDb.close();
    }
    if (integrityResult !== 'ok') {
      fs.rmSync(destPath, { force: true });
      incompleteBackupPath = null;
      return {
        success: false,
        filename,
        filepath: null,
        sizeBytes: null,
        error: `Backup integrity check failed: ${integrityResult}`,
        timestamp,
      };
    }

    // 6. Prune old backups — keep only the most recent MAX_BACKUPS
    try {
      pruneOldBackups(backupDir);
    } catch (pruneErr) {
      // Non-critical — log but still return success
      console.warn('[db-backup] Prune failed:', (pruneErr as Error).message);
    }

    // 7. Return success
    incompleteBackupPath = null;
    return {
      success: true,
      filename,
      filepath: destPath,
      sizeBytes: destStats.size,
      error: null,
      timestamp,
    };
  } catch (err) {
    if (incompleteBackupPath) {
      fs.rmSync(incompleteBackupPath, { force: true });
    }
    return {
      success: false,
      filename: null,
      filepath: null,
      sizeBytes: null,
      error: (err as Error).message || 'Unknown backup error',
      timestamp,
    };
  }
}

export function isBackupValid(filename: string): boolean {
  if (path.basename(filename) !== filename) return false;

  const backupPath = projectPath(BACKUP_DIR, filename);
  if (!fs.existsSync(backupPath)) return false;

  let backupDb: Database.Database | null = null;
  try {
    backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    return backupDb.pragma('quick_check', { simple: true }) === 'ok';
  } catch {
    return false;
  } finally {
    backupDb?.close();
  }
}

// ── Prune helper ──

function pruneOldBackups(backupDir: string): void {
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(`${DB_FILENAME}.backup-`))
    .sort(); // Timestamp format sorts chronologically

  if (files.length <= MAX_BACKUPS) return;

  const toDelete = files.slice(0, files.length - MAX_BACKUPS);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(path.join(backupDir, file));
      console.log(`[db-backup] Pruned old backup: ${file}`);
    } catch {
      // Best-effort — skip files that can't be deleted
    }
  }
}

// ── List existing backups ──

export function listBackups(): BackupFileInfo[] {
  const backupDir = projectPath(BACKUP_DIR);

  if (!fs.existsSync(backupDir)) return [];

  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(`${DB_FILENAME}.backup-`))
    .sort()
    .reverse(); // Newest first

  return files.map((filename) => {
    const filePath = path.join(backupDir, filename);
    const stats = fs.statSync(filePath);

    // Parse timestamp from filename: dev.db.backup-YYYY-MM-DD-HHmm
    const match = filename.match(/backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/);
    let createdAt = stats.mtime.toISOString();
    if (match) {
      const [, year, month, day, hour, min] = match;
      createdAt = new Date(`${year}-${month}-${day}T${hour}:${min}:00`).toISOString();
    }

    return {
      filename,
      sizeBytes: stats.size,
      createdAt,
    };
  });
}

// ── Restore function ──

export interface RestoreResult {
  success: boolean;
  restoredFrom: string;
  preRestoreBackup: string | null;
  error: string | null;
  timestamp: string;
}

export interface RestoreOptions {
  maintenanceMode?: boolean;
}

/**
 * Restore the database from a named backup file while the application is
 * stopped. The operation validates and stages the target, creates an online
 * pre-restore backup, and rolls back if the installed database fails checks.
 */
export async function restoreDatabase(
  backupFilename: string,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const timestamp = new Date().toISOString();
  let preRestoreBackup: string | null = null;
  let stagedPath: string | null = null;
  let displacedPath: string | null = null;

  try {
    if (!options.maintenanceMode) {
      return {
        success: false,
        restoredFrom: backupFilename,
        preRestoreBackup: null,
        error: 'Restore requires maintenance mode with the application stopped. Run restore-backup.bat.',
        timestamp,
      };
    }

    // Validate filename — must match the expected pattern (no path traversal)
    if (!backupFilename.startsWith(`${DB_FILENAME}.backup-`) || backupFilename.includes('..') || backupFilename.includes('/') || backupFilename.includes('\\')) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: 'Invalid backup filename', timestamp };
    }

    const backupDir = projectPath(BACKUP_DIR);
    const backupPath = path.join(backupDir, backupFilename);
    const dbPath = projectPath('prisma', DB_FILENAME);

    // 1. Check backup file exists
    if (!fs.existsSync(backupPath)) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: `Backup file not found: ${backupFilename}`, timestamp };
    }

    // 2. Validate the selected SQLite backup before touching the live database.
    const backupStats = fs.statSync(backupPath);
    if (backupStats.size < 1024) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: `Backup file too small (${backupStats.size} bytes) — likely corrupt`, timestamp };
    }
    if (!isBackupValid(backupFilename)) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: 'Backup failed SQLite integrity validation', timestamp };
    }

    stagedPath = `${dbPath}.restore-staged-${Date.now()}`;
    fs.copyFileSync(backupPath, stagedPath);
    const stagedDb = new Database(stagedPath, { readonly: true, fileMustExist: true });
    try {
      if (stagedDb.pragma('quick_check', { simple: true }) !== 'ok') {
        throw new Error('Staged restore failed SQLite integrity validation');
      }
    } finally {
      stagedDb.close();
    }

    // 3. Create a WAL-safe pre-restore snapshot of the current database.
    if (fs.existsSync(dbPath)) {
      const preRestoreName = `${DB_FILENAME}.pre-restore-${Date.now()}`;
      const preRestorePath = path.join(backupDir, preRestoreName);
      fs.mkdirSync(backupDir, { recursive: true });
      const liveDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        await liveDb.backup(preRestorePath);
      } finally {
        liveDb.close();
      }
      const preRestoreDb = new Database(preRestorePath, { readonly: true, fileMustExist: true });
      try {
        if (preRestoreDb.pragma('quick_check', { simple: true }) !== 'ok') {
          throw new Error('Pre-restore backup failed SQLite integrity validation');
        }
      } finally {
        preRestoreDb.close();
      }
      preRestoreBackup = preRestoreName;
    }

    // 4. Install the staged database. Renaming the current file first lets us
    // detect open handles on Windows before the replacement is committed.
    if (fs.existsSync(dbPath)) {
      displacedPath = `${dbPath}.restore-displaced-${Date.now()}`;
      fs.renameSync(dbPath, displacedPath);
    }
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    fs.renameSync(stagedPath, dbPath);
    stagedPath = null;

    // 5. Verify the installed database, rolling back from the complete online
    // snapshot if any post-swap check fails.
    try {
      const restoredDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        if (restoredDb.pragma('quick_check', { simple: true }) !== 'ok') {
          throw new Error('Restored database failed SQLite integrity validation');
        }
      } finally {
        restoredDb.close();
      }
    } catch (restoreError) {
      fs.rmSync(dbPath, { force: true });
      if (preRestoreBackup) {
        fs.copyFileSync(path.join(backupDir, preRestoreBackup), dbPath);
      } else if (displacedPath && fs.existsSync(displacedPath)) {
        fs.renameSync(displacedPath, dbPath);
        displacedPath = null;
      }
      throw new Error(`Restore verification failed and the previous database was restored: ${(restoreError as Error).message}`);
    }

    if (displacedPath) {
      fs.rmSync(displacedPath, { force: true });
      displacedPath = null;
    }

    return {
      success: true,
      restoredFrom: backupFilename,
      preRestoreBackup,
      error: null,
      timestamp,
    };
  } catch (err) {
    if (stagedPath) fs.rmSync(stagedPath, { force: true });
    if (displacedPath && !fs.existsSync(projectPath('prisma', DB_FILENAME))) {
      fs.renameSync(displacedPath, projectPath('prisma', DB_FILENAME));
      displacedPath = null;
    }
    return {
      success: false,
      restoredFrom: backupFilename,
      preRestoreBackup,
      error: (err as Error).message || 'Unknown restore error',
      timestamp,
    };
  }
}
