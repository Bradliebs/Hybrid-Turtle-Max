import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';

const fixture = vi.hoisted(() => ({ directory: '', enrich: vi.fn() }));
vi.mock('./candidate-outcome-enrichment', () => ({ enrichCandidateOutcomes: fixture.enrich }));
vi.mock('./prisma', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { PrismaClient } = await import('@prisma/client');
  fixture.directory = await mkdtemp(join(tmpdir(), 'candidate-trade-recovery-'));
  return { default: new PrismaClient({ datasources: { db: {
    url: `file:${join(fixture.directory, 'fixture.db').replace(/\\/g, '/')}`,
  } } }) };
});

import prisma from './prisma';
import { backfillTradeLinks } from './candidate-outcome';
import { POST } from '../app/api/analytics/candidate-outcomes/route';

const scanDate = new Date('2026-09-11T09:00:00Z');
const tradeDate = new Date('2026-09-11T10:00:00Z');

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`CREATE TABLE Scan (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, runDate DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE TradeLog (
    id TEXT PRIMARY KEY, ticker TEXT NOT NULL, tradeType TEXT NOT NULL,
    decision TEXT NOT NULL, positionId TEXT, userId TEXT NOT NULL,
    tradeDate DATETIME NOT NULL, actualFill REAL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE CandidateOutcome (
    id TEXT PRIMARY KEY, scanId TEXT NOT NULL, ticker TEXT NOT NULL,
    scanDate DATETIME NOT NULL, tradePlaced BOOLEAN NOT NULL DEFAULT false,
    tradeLogId TEXT, actualFill REAL, UNIQUE(scanId, ticker)
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE ExecutionLog (
    id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, phase TEXT NOT NULL,
    orderId TEXT, accountType TEXT NOT NULL, requestBody TEXT
  )`);
});

beforeEach(async () => {
  fixture.enrich.mockReset();
  for (const table of ['ExecutionLog', 'CandidateOutcome', 'TradeLog', 'Scan']) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${table}`);
  }
  await prisma.$executeRaw`INSERT INTO Scan VALUES ('scan-1', 'user-1', ${scanDate})`;
  await prisma.$executeRaw`INSERT INTO Scan VALUES ('nearby-scan', 'user-1', ${scanDate})`;
  await prisma.$executeRaw`INSERT INTO TradeLog VALUES
    ('entry-1', 'AAPL', 'ENTRY', 'TAKEN', 'position-1', 'user-1', ${tradeDate}, 100)`;
  await prisma.$executeRaw`INSERT INTO CandidateOutcome (id, scanId, ticker, scanDate)
    VALUES ('candidate-1', 'scan-1', 'AAPL', ${scanDate})`;
  await prisma.$executeRaw`INSERT INTO CandidateOutcome (id, scanId, ticker, scanDate)
    VALUES ('nearby-candidate', 'nearby-scan', 'AAPL', ${scanDate})`;
  const request = JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1' });
  await prisma.$executeRaw`INSERT INTO ExecutionLog VALUES
    (1, 'AAPL', 'COMPLETE', 'order-1', 'isa', ${request})`;
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(fixture.directory, { recursive: true, force: true });
});

const linkedRows = () => prisma.candidateOutcome.findMany({
  where: { tradePlaced: true }, select: { id: true, tradeLogId: true, actualFill: true },
});

describe('exact trade recovery using isolated SQLite and real Prisma', () => {
  it('recovers through the analytics POST without running enrichment', async () => {
    const request = () => new Request('http://localhost/api/analytics/candidate-outcomes', {
      method: 'POST', body: JSON.stringify({ action: 'link-trades' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await (await POST(request())).json()).toEqual({ ok: true, tradesLinked: 1 });
    expect(await (await POST(request())).json()).toEqual({ ok: true, tradesLinked: 0 });
    expect(fixture.enrich).not.toHaveBeenCalled();
  });

  it('links only the named candidate, persists it and counts no changes on retry', async () => {
    expect(await backfillTradeLinks()).toBe(1);
    await prisma.$disconnect();
    await prisma.$connect();
    expect(await backfillTradeLinks()).toBe(0);
    expect(await linkedRows()).toEqual([{ id: 'candidate-1', tradeLogId: 'entry-1', actualFill: 100 }]);
  });

  it('does not link another user, an exit or a post-trade scan', async () => {
    await prisma.$executeRaw`UPDATE Scan SET userId = 'other-user' WHERE id = 'scan-1'`;
    expect(await backfillTradeLinks()).toBe(0);
    await prisma.$executeRaw`UPDATE Scan SET userId = 'user-1' WHERE id = 'scan-1'`;
    await prisma.$executeRaw`UPDATE TradeLog SET tradeType = 'EXIT'`;
    expect(await backfillTradeLinks()).toBe(0);
    await prisma.$executeRaw`UPDATE TradeLog SET tradeType = 'ENTRY'`;
    await prisma.$executeRaw`UPDATE Scan SET runDate = ${new Date('2026-09-11T11:00:00Z')}`;
    expect(await backfillTradeLinks()).toBe(0);
    expect(await linkedRows()).toEqual([]);
  });

  it('does not overwrite existing attribution or assign one trade twice', async () => {
    await prisma.$executeRaw`UPDATE CandidateOutcome SET tradePlaced = true, tradeLogId = 'other-entry'
      WHERE id = 'candidate-1'`;
    expect(await backfillTradeLinks()).toBe(0);
    await prisma.$executeRaw`UPDATE CandidateOutcome SET tradePlaced = false, tradeLogId = null
      WHERE id = 'candidate-1'`;
    await prisma.$executeRaw`UPDATE CandidateOutcome SET tradePlaced = true, tradeLogId = 'entry-1'
      WHERE id = 'nearby-candidate'`;
    expect(await backfillTradeLinks()).toBe(0);
    expect(await linkedRows()).toEqual([{ id: 'nearby-candidate', tradeLogId: 'entry-1', actualFill: null }]);
  });

  it('leaves legacy entries without completion IDs unattributed', async () => {
    await prisma.$executeRaw`UPDATE ExecutionLog SET requestBody = '{"positionId":"position-1"}'`;
    expect(await backfillTradeLinks()).toBe(0);
    expect(await linkedRows()).toEqual([]);
  });

  it('rejects duplicate completion evidence before any write', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO ExecutionLog
      SELECT 2, ticker, phase, orderId, accountType, requestBody FROM ExecutionLog`);
    expect(await backfillTradeLinks()).toBe(0);
    expect(await linkedRows()).toEqual([]);
  });

  it('rejects two different trades claiming the same candidate instead of choosing the first', async () => {
    await prisma.$executeRaw`INSERT INTO TradeLog VALUES
      ('entry-2', 'AAPL', 'ENTRY', 'TAKEN', 'position-2', 'user-1', ${tradeDate}, 101)`;
    const request = JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-2', positionId: 'position-2' });
    await prisma.$executeRaw`INSERT INTO ExecutionLog VALUES
      (2, 'AAPL', 'COMPLETE', 'order-2', 'isa', ${request})`;
    expect(await backfillTradeLinks()).toBe(0);
    expect(await linkedRows()).toEqual([]);
  });
});