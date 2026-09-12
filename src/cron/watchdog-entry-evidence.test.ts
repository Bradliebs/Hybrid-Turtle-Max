import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ default: { executionLog: {
  count: (args: Parameters<PrismaClient['executionLog']['count']>[0]) => fixture.client!.executionLog.count(args),
} } }));
vi.mock('@/lib/cron-logger', () => ({ createCronLogger: () => ({}) }));
vi.mock('@/lib/telegram', () => ({ sendThrottledTelegramAlert: vi.fn() }));

import { countBuyAttemptsSince } from './watchdog';
import { checkZeroTradesOnBullishDay } from './watchdog-checks';

let directory: string;
const since = new Date('2026-09-11T00:00:00.000Z');

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'watchdog-entry-evidence-'));
  fixture.client = new PrismaClient({ datasources: { db: {
    url: `file:${join(directory, 'fixture.db').replace(/\\/g, '/')}`,
  } } });
  await fixture.client.$executeRawUnsafe(
    'CREATE TABLE ExecutionLog (id TEXT PRIMARY KEY, phase TEXT NOT NULL, createdAt DATETIME NOT NULL)',
  );
});

beforeEach(async () => {
  await fixture.client!.$executeRawUnsafe('DELETE FROM ExecutionLog');
});

afterAll(async () => {
  await fixture.client?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function insert(phase: string, time = since) {
  await fixture.client!.$executeRawUnsafe(
    'INSERT INTO ExecutionLog (id, phase, createdAt) VALUES (?, ?, ?)',
    `${phase}-${time.getTime()}`, phase, time.getTime(),
  );
}

describe('watchdog buy attempt evidence', () => {
  it('does not let reference observations or stop logs suppress the zero-buy warning', async () => {
    for (const phase of ['LIVE_REVAL_KEEP', 'LIVE_REVAL_SKIP', 'STOP_PLACED', 'COMPLETE', 'CLIENT_ERROR']) {
      await insert(phase);
    }
    const buyAttemptsToday = await countBuyAttemptsSince(since);
    expect(buyAttemptsToday).toBe(0);
    expect(checkZeroTradesOnBullishDay({ regime: 'BULLISH', aGradeWithShares: 2,
      buyAttemptsToday, ukDayOfWeek: 5, ukHourOfDay: 17 })).toHaveLength(1);
  });

  it('counts placed and failed submissions in the window, including its exact start', async () => {
    await insert('BUY_PLACED', new Date(since.getTime() - 1));
    await insert('BUY_PLACED');
    await insert('BUY_FAILED', new Date(since.getTime() + 1));
    await insert('LIVE_REVAL_KEEP');
    expect(await countBuyAttemptsSince(since)).toBe(2);
  });
});