import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireAutoTradeLock,
  releaseAutoTradeLock,
  AutoTradeLockContentionError,
  AUTO_TRADE_LOCK_KEY,
  STALE_LOCK_MINUTES,
  type LockHolder,
  type LockPrismaClient,
} from './auto-trade-lock';

class P2002 extends Error {
  code = 'P2002';
  constructor() {
    super('Unique constraint failed');
  }
}
class P2025 extends Error {
  code = 'P2025';
  constructor() {
    super('Record to delete does not exist');
  }
}

function makeStub(initial: { valueJson: unknown; updatedAt: Date } | null = null): LockPrismaClient {
  let row: { valueJson: unknown; updatedAt: Date } | null = initial;
  return {
    appSetting: {
      create: async ({ data }) => {
        if (row) throw new P2002();
        row = { valueJson: data.valueJson, updatedAt: new Date() };
        return data;
      },
      findUnique: async () => (row ? { valueJson: row.valueJson, updatedAt: row.updatedAt } : null),
      delete: async () => {
        if (!row) throw new P2025();
        row = null;
        return {};
      },
    },
  };
}

const FIXED_NOW = new Date('2026-06-17T18:00:00Z');

describe('acquireAutoTradeLock', () => {
  let stub: LockPrismaClient;
  beforeEach(() => {
    stub = makeStub();
  });

  it('acquires when no existing lock', async () => {
    const result = await acquireAutoTradeLock({
      session: 'uk',
      pid: 1234,
      host: 'test-host',
      now: FIXED_NOW,
      client: stub,
    });
    expect(result.holder.pid).toBe(1234);
    expect(result.holder.host).toBe('test-host');
    expect(result.holder.session).toBe('uk');
    expect(result.holder.acquiredAt).toBe(FIXED_NOW.toISOString());
    expect(result.reclaimedFrom).toBeNull();
    expect(result.reclaimedAgeMinutes).toBeNull();
  });

  it('throws AutoTradeLockContentionError when lock is fresh', async () => {
    const existingHolder: LockHolder = {
      pid: 999,
      host: 'other-host',
      session: 'us',
      acquiredAt: new Date(FIXED_NOW.getTime() - 60_000).toISOString(), // 1m old
    };
    stub = makeStub({ valueJson: existingHolder, updatedAt: new Date(FIXED_NOW.getTime() - 60_000) });

    await expect(
      acquireAutoTradeLock({
        session: 'uk',
        pid: 1234,
        host: 'test-host',
        now: FIXED_NOW,
        client: stub,
      }),
    ).rejects.toBeInstanceOf(AutoTradeLockContentionError);
  });

  it('contention error exposes holder and age', async () => {
    const existingHolder: LockHolder = {
      pid: 999,
      host: 'other-host',
      session: 'us',
      acquiredAt: new Date(FIXED_NOW.getTime() - 120_000).toISOString(),
    };
    stub = makeStub({ valueJson: existingHolder, updatedAt: new Date(FIXED_NOW.getTime() - 120_000) });

    try {
      await acquireAutoTradeLock({
        session: 'uk',
        pid: 1234,
        host: 'test-host',
        now: FIXED_NOW,
        client: stub,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AutoTradeLockContentionError);
      const e = err as AutoTradeLockContentionError;
      expect(e.holder?.pid).toBe(999);
      expect(e.ageMinutes).toBeCloseTo(2, 1);
      expect(e.message).toContain('pid=999');
      expect(e.message).toContain('host=other-host');
    }
  });

  it('reclaims a stale lock older than STALE_LOCK_MINUTES', async () => {
    const staleHolder: LockHolder = {
      pid: 999,
      host: 'crashed-host',
      session: 'us',
      acquiredAt: new Date(FIXED_NOW.getTime() - (STALE_LOCK_MINUTES + 5) * 60_000).toISOString(),
    };
    stub = makeStub({
      valueJson: staleHolder,
      updatedAt: new Date(FIXED_NOW.getTime() - (STALE_LOCK_MINUTES + 5) * 60_000),
    });

    const result = await acquireAutoTradeLock({
      session: 'uk',
      pid: 1234,
      host: 'test-host',
      now: FIXED_NOW,
      client: stub,
    });
    expect(result.holder.pid).toBe(1234);
    expect(result.holder.host).toBe('test-host');
    // Reclaim signal must surface so the caller can alert an operator
    // that a previous run crashed without releasing.
    expect(result.reclaimedFrom).not.toBeNull();
    expect(result.reclaimedFrom?.pid).toBe(999);
    expect(result.reclaimedFrom?.host).toBe('crashed-host');
    expect(result.reclaimedFrom?.session).toBe('us');
    expect(result.reclaimedAgeMinutes).toBeGreaterThanOrEqual(STALE_LOCK_MINUTES);
  });

  it('does NOT reclaim a lock exactly under the stale threshold', async () => {
    const holder: LockHolder = {
      pid: 999,
      host: 'other-host',
      session: 'us',
      acquiredAt: new Date(FIXED_NOW.getTime() - (STALE_LOCK_MINUTES - 1) * 60_000).toISOString(),
    };
    stub = makeStub({
      valueJson: holder,
      updatedAt: new Date(FIXED_NOW.getTime() - (STALE_LOCK_MINUTES - 1) * 60_000),
    });
    await expect(
      acquireAutoTradeLock({
        session: 'uk',
        pid: 1234,
        host: 'test-host',
        now: FIXED_NOW,
        client: stub,
      }),
    ).rejects.toBeInstanceOf(AutoTradeLockContentionError);
  });

  it('respects custom staleMinutes override', async () => {
    const holder: LockHolder = {
      pid: 999,
      host: 'other-host',
      session: 'us',
      acquiredAt: new Date(FIXED_NOW.getTime() - 90_000).toISOString(), // 1.5m old
    };
    stub = makeStub({ valueJson: holder, updatedAt: new Date(FIXED_NOW.getTime() - 90_000) });
    // With a 1-minute stale threshold, the 1.5m-old lock should be reclaimed.
    const result = await acquireAutoTradeLock({
      session: 'uk',
      pid: 1234,
      host: 'test-host',
      now: FIXED_NOW,
      staleMinutes: 1,
      client: stub,
    });
    expect(result.holder.pid).toBe(1234);
    expect(result.reclaimedFrom?.pid).toBe(999);
  });

  it('uses updatedAt as fallback when valueJson is unparseable', async () => {
    stub = makeStub({
      valueJson: { malformed: 'no pid' },
      updatedAt: new Date(FIXED_NOW.getTime() - 30_000),
    });
    try {
      await acquireAutoTradeLock({
        session: 'uk',
        pid: 1234,
        host: 'test-host',
        now: FIXED_NOW,
        client: stub,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AutoTradeLockContentionError);
      const e = err as AutoTradeLockContentionError;
      expect(e.holder).toBeNull();
      expect(e.ageMinutes).toBeCloseTo(0.5, 1);
    }
  });

  it('non-P2002 errors propagate unwrapped', async () => {
    const broken: LockPrismaClient = {
      appSetting: {
        create: async () => {
          throw new Error('db is on fire');
        },
        findUnique: async () => null,
        delete: async () => ({}),
      },
    };
    await expect(
      acquireAutoTradeLock({ session: 'uk', client: broken, now: FIXED_NOW }),
    ).rejects.toThrow('db is on fire');
  });
});

describe('releaseAutoTradeLock', () => {
  it('deletes lock and returns true when present', async () => {
    const holder: LockHolder = {
      pid: 1234,
      host: 'test-host',
      session: 'uk',
      acquiredAt: FIXED_NOW.toISOString(),
    };
    const stub = makeStub({ valueJson: holder, updatedAt: FIXED_NOW });
    const released = await releaseAutoTradeLock({ client: stub });
    expect(released).toBe(true);
  });

  it('returns false when lock is already absent', async () => {
    const stub = makeStub(null);
    const released = await releaseAutoTradeLock({ client: stub });
    expect(released).toBe(false);
  });

  it('refuses to release when holder does not match (anti-stomp)', async () => {
    const ownedByOther: LockHolder = {
      pid: 999,
      host: 'other-host',
      session: 'us',
      acquiredAt: FIXED_NOW.toISOString(),
    };
    const myHolder: LockHolder = {
      pid: 1234,
      host: 'test-host',
      session: 'uk',
      acquiredAt: new Date(FIXED_NOW.getTime() - 600_000).toISOString(),
    };
    const stub = makeStub({ valueJson: ownedByOther, updatedAt: FIXED_NOW });
    const released = await releaseAutoTradeLock({ holder: myHolder, client: stub });
    expect(released).toBe(false);
  });

  it('releases when holder DOES match', async () => {
    const me: LockHolder = {
      pid: 1234,
      host: 'test-host',
      session: 'uk',
      acquiredAt: FIXED_NOW.toISOString(),
    };
    const stub = makeStub({ valueJson: me, updatedAt: FIXED_NOW });
    const released = await releaseAutoTradeLock({ holder: me, client: stub });
    expect(released).toBe(true);
  });
});

describe('acquire/release end-to-end on shared stub', () => {
  it('second acquire blocks until first releases', async () => {
    const stub = makeStub();
    const first = await acquireAutoTradeLock({
      session: 'uk',
      pid: 1,
      host: 'h1',
      now: FIXED_NOW,
      client: stub,
    });
    await expect(
      acquireAutoTradeLock({
        session: 'us',
        pid: 2,
        host: 'h2',
        now: new Date(FIXED_NOW.getTime() + 60_000),
        client: stub,
      }),
    ).rejects.toBeInstanceOf(AutoTradeLockContentionError);
    await releaseAutoTradeLock({ holder: first.holder, client: stub });
    const second = await acquireAutoTradeLock({
      session: 'us',
      pid: 2,
      host: 'h2',
      now: new Date(FIXED_NOW.getTime() + 120_000),
      client: stub,
    });
    expect(second.holder.pid).toBe(2);
    expect(second.reclaimedFrom).toBeNull();
  });
});

it('lock key is the documented constant', () => {
  expect(AUTO_TRADE_LOCK_KEY).toBe('auto-trade.run-lock');
});
