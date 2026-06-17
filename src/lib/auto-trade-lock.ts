/**
 * DEPENDENCIES
 * Consumed by: src/cron/auto-trade.ts (entry-point guard)
 * Consumes: src/lib/prisma.ts (AppSetting model)
 * Risk-sensitive: YES (deduplication gate — prevents concurrent buy-order placement)
 * Notes: Acquires/releases an exclusive run-lock for the auto-trade cron
 *        via an atomic INSERT on AppSetting.key (UNIQUE). If a previous
 *        run crashed without releasing, a stale lock older than
 *        STALE_LOCK_MINUTES is automatically reclaimed. Without this,
 *        a double-fire of the Task Scheduler entry — or a manual run
 *        racing the cron — could submit duplicate buy orders against
 *        the same READY candidate.
 */

import defaultPrisma from './prisma';

export const AUTO_TRADE_LOCK_KEY = 'auto-trade.run-lock';
export const STALE_LOCK_MINUTES = 15;

export interface LockHolder {
  pid: number;
  host: string;
  session: string;
  acquiredAt: string; // ISO timestamp
}

export class AutoTradeLockContentionError extends Error {
  readonly holder: LockHolder | null;
  readonly ageMinutes: number | null;
  constructor(message: string, holder: LockHolder | null, ageMinutes: number | null) {
    super(message);
    this.name = 'AutoTradeLockContentionError';
    this.holder = holder;
    this.ageMinutes = ageMinutes;
  }
}

// Minimal subset of PrismaClient we need — lets tests inject a stub
// without dragging the full Prisma surface into the type signature.
export interface LockPrismaClient {
  appSetting: {
    create: (args: { data: { key: string; value: string; valueJson: unknown; description?: string } }) => Promise<unknown>;
    findUnique: (args: { where: { key: string }; select?: { valueJson?: true; updatedAt?: true } }) => Promise<{ valueJson: unknown; updatedAt: Date } | null>;
    delete: (args: { where: { key: string } }) => Promise<unknown>;
  };
}

export interface AcquireOptions {
  session: string;
  pid?: number;
  host?: string;
  now?: Date;
  staleMinutes?: number;
  client?: LockPrismaClient;
}

export interface AcquireResult {
  holder: LockHolder;
  // Set when the previous lock was reclaimed because it was older than
  // staleMinutes. Indicates a prior run crashed without releasing — the
  // caller should alert an operator, because that's an upstream safety
  // signal worth investigating even though the current run can proceed.
  reclaimedFrom: LockHolder | null;
  // Age (in minutes) of the reclaimed lock at the moment of reclaim.
  reclaimedAgeMinutes: number | null;
}

function parseHolder(valueJson: unknown): LockHolder | null {
  if (!valueJson || typeof valueJson !== 'object') return null;
  const v = valueJson as Record<string, unknown>;
  if (
    typeof v.pid === 'number' &&
    typeof v.host === 'string' &&
    typeof v.session === 'string' &&
    typeof v.acquiredAt === 'string'
  ) {
    return { pid: v.pid, host: v.host, session: v.session, acquiredAt: v.acquiredAt };
  }
  return null;
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'P2002';
}

function isRecordNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'P2025';
}

/**
 * Acquire the auto-trade run-lock. Throws AutoTradeLockContentionError if
 * another run holds the lock and it is not yet stale.
 *
 * Returns the new holder plus a `reclaimedFrom` field — when non-null,
 * a stale lock was stolen from a crashed prior run and the caller should
 * alert an operator.
 */
export async function acquireAutoTradeLock(opts: AcquireOptions): Promise<AcquireResult> {
  const client = opts.client ?? (defaultPrisma as unknown as LockPrismaClient);
  const now = opts.now ?? new Date();
  const staleMinutes = opts.staleMinutes ?? STALE_LOCK_MINUTES;

  const holder: LockHolder = {
    pid: opts.pid ?? process.pid,
    host: opts.host ?? 'unknown-host',
    session: opts.session,
    acquiredAt: now.toISOString(),
  };
  const payload = {
    data: {
      key: AUTO_TRADE_LOCK_KEY,
      value: JSON.stringify(holder),
      valueJson: holder as unknown,
      description: 'Auto-trade exclusive run-lock (prevents concurrent execution)',
    },
  };

  try {
    await client.appSetting.create(payload);
    return { holder, reclaimedFrom: null, reclaimedAgeMinutes: null };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
  }

  // Contention — inspect the current holder to decide if it's stale.
  const existing = await client.appSetting.findUnique({
    where: { key: AUTO_TRADE_LOCK_KEY },
    select: { valueJson: true, updatedAt: true },
  });

  // Vanished between create and read (another caller released) — retry once.
  if (!existing) {
    try {
      await client.appSetting.create(payload);
      return { holder, reclaimedFrom: null, reclaimedAgeMinutes: null };
    } catch (err2) {
      if (!isUniqueConstraintError(err2)) throw err2;
      throw new AutoTradeLockContentionError(
        'Lock contention — another run acquired between probe and retry',
        null,
        null,
      );
    }
  }

  const existingHolder = parseHolder(existing.valueJson);
  const lockTs = existingHolder ? new Date(existingHolder.acquiredAt) : existing.updatedAt;
  const ageMinutes = (now.getTime() - lockTs.getTime()) / 60_000;

  if (ageMinutes < staleMinutes) {
    throw new AutoTradeLockContentionError(
      `Lock held by pid=${existingHolder?.pid ?? '?'} host=${existingHolder?.host ?? '?'} session=${existingHolder?.session ?? '?'} (age ${ageMinutes.toFixed(1)}m, stale threshold ${staleMinutes}m)`,
      existingHolder,
      ageMinutes,
    );
  }

  // Stale — reclaim by delete + create. Tolerate the delete race.
  try {
    await client.appSetting.delete({ where: { key: AUTO_TRADE_LOCK_KEY } });
  } catch (err) {
    if (!isRecordNotFoundError(err)) throw err;
  }
  try {
    await client.appSetting.create(payload);
    return { holder, reclaimedFrom: existingHolder, reclaimedAgeMinutes: ageMinutes };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    // Lost a race against another reclaimer. Surface as contention.
    throw new AutoTradeLockContentionError(
      'Lost reclaim race against another auto-trade instance',
      existingHolder,
      ageMinutes,
    );
  }
}

export interface ReleaseOptions {
  holder?: LockHolder | null;
  client?: LockPrismaClient;
}

/**
 * Release the auto-trade run-lock. Safe to call when the lock is already
 * gone (e.g. it was stolen as stale by another reclaimer). Returns true
 * if a row was actually deleted, false if it was already absent.
 *
 * If `holder` is provided, the current lock-holder is checked first and
 * release is skipped when the holder does not match — preventing a late-
 * arriving release from a crashed run from clearing a fresh successor's
 * lock.
 */
export async function releaseAutoTradeLock(opts: ReleaseOptions = {}): Promise<boolean> {
  const client = opts.client ?? (defaultPrisma as unknown as LockPrismaClient);

  if (opts.holder) {
    const existing = await client.appSetting.findUnique({
      where: { key: AUTO_TRADE_LOCK_KEY },
      select: { valueJson: true },
    });
    if (!existing) return false;
    const currentHolder = parseHolder(existing.valueJson);
    if (
      !currentHolder ||
      currentHolder.pid !== opts.holder.pid ||
      currentHolder.acquiredAt !== opts.holder.acquiredAt
    ) {
      return false;
    }
  }

  try {
    await client.appSetting.delete({ where: { key: AUTO_TRADE_LOCK_KEY } });
    return true;
  } catch (err) {
    if (isRecordNotFoundError(err)) return false;
    throw err;
  }
}
