import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupDatabase, isBackupValid, restoreDatabase } from './db-backup';

describe('backupDatabase', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes committed rows that are still resident in the WAL', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hybridturtle-backup-'));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const source = new Database(path.join(root, 'prisma', 'dev.db'));
    source.pragma('journal_mode = WAL');
    source.pragma('wal_autocheckpoint = 0');
    source.exec('CREATE TABLE audit_value (value TEXT NOT NULL)');
    source.prepare('INSERT INTO audit_value (value) VALUES (?)').run('committed-in-wal');

    const result = await backupDatabase();
    expect(result.success).toBe(true);
    expect(result.filepath).toBeTruthy();

    const backup = new Database(result.filepath!, { readonly: true, fileMustExist: true });
    try {
      expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
      expect(backup.prepare('SELECT value FROM audit_value').pluck().get()).toBe('committed-in-wal');
    } finally {
      backup.close();
      source.close();
    }
  });

  it('rejects a corrupt file that looks like a managed backup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hybridturtle-backup-'));
    tempRoots.push(root);
    const backupDir = path.join(root, 'prisma', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const filename = 'dev.db.backup-2026-03-04-1200';
    fs.writeFileSync(path.join(backupDir, filename), 'not a sqlite database');

    expect(isBackupValid(filename)).toBe(false);
  });
});

describe('restoreDatabase', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function createDatabase(filePath: string, value: string): void {
    const db = new Database(filePath);
    try {
      db.exec('CREATE TABLE restore_value (value TEXT NOT NULL)');
      db.prepare('INSERT INTO restore_value (value) VALUES (?)').run(value);
    } finally {
      db.close();
    }
  }

  it('refuses to restore without explicit maintenance mode', async () => {
    const result = await restoreDatabase('dev.db.backup-2026-08-04-1200');
    expect(result.success).toBe(false);
    expect(result.error).toContain('application stopped');
  });

  it('restores a validated backup and preserves the previous database', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hybridturtle-restore-'));
    tempRoots.push(root);
    const prismaDir = path.join(root, 'prisma');
    const backupDir = path.join(prismaDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    createDatabase(path.join(prismaDir, 'dev.db'), 'current');
    const filename = 'dev.db.backup-2026-08-04-1200';
    createDatabase(path.join(backupDir, filename), 'backup');

    const result = await restoreDatabase(filename, { maintenanceMode: true });
    expect(result.success).toBe(true);
    expect(result.preRestoreBackup).toBeTruthy();

    const restored = new Database(path.join(prismaDir, 'dev.db'), { readonly: true });
    const preserved = new Database(path.join(backupDir, result.preRestoreBackup!), { readonly: true });
    try {
      expect(restored.prepare('SELECT value FROM restore_value').pluck().get()).toBe('backup');
      expect(restored.pragma('quick_check', { simple: true })).toBe('ok');
      expect(preserved.prepare('SELECT value FROM restore_value').pluck().get()).toBe('current');
      expect(preserved.pragma('quick_check', { simple: true })).toBe('ok');
    } finally {
      restored.close();
      preserved.close();
    }
  });

  it('rejects a corrupt backup before replacing the live database', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hybridturtle-restore-'));
    tempRoots.push(root);
    const prismaDir = path.join(root, 'prisma');
    const backupDir = path.join(prismaDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    createDatabase(path.join(prismaDir, 'dev.db'), 'current');
    const filename = 'dev.db.backup-2026-08-04-1200';
    fs.writeFileSync(path.join(backupDir, filename), Buffer.alloc(2048, 1));

    const result = await restoreDatabase(filename, { maintenanceMode: true });
    expect(result.success).toBe(false);
    const live = new Database(path.join(prismaDir, 'dev.db'), { readonly: true });
    try {
      expect(live.prepare('SELECT value FROM restore_value').pluck().get()).toBe('current');
    } finally {
      live.close();
    }
  });
});