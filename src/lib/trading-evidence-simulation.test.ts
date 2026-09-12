import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('./candidate-outcome-enrichment', () => ({
  enrichCandidateOutcomes: () => { throw new Error('No enrichment in the synthetic lifecycle'); },
}));
vi.mock('./prisma', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { PrismaClient } = await import('@prisma/client');
  fixture.directory = await mkdtemp(join(tmpdir(), 'trading-evidence-simulation-'));
  return { default: new PrismaClient({ datasources: { db: {
    url: `file:${join(fixture.directory, 'synthetic.db').replace(/\\/g, '/')}`,
  } } }) };
});

import prisma from './prisma';
import { backfillTradeLinks } from './candidate-outcome';
import { reconcileClosureEvidence } from './closure-evidence';
import { computeExecutionDrag } from './execution-drag';
import type { T212HistoricalOrder } from './trading212';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`CREATE TABLE Scan (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, runDate DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE TradeLog (
    id TEXT PRIMARY KEY, ticker TEXT NOT NULL, tradeType TEXT NOT NULL,
    decision TEXT NOT NULL, positionId TEXT, userId TEXT NOT NULL,
    tradeDate DATETIME NOT NULL, actualFill REAL, shares REAL,
    initialStop REAL, finalRMultiple REAL, plannedEntry REAL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE CandidateOutcome (
    id TEXT PRIMARY KEY, scanId TEXT NOT NULL, ticker TEXT NOT NULL,
    scanDate DATETIME NOT NULL, tradePlaced BOOLEAN NOT NULL DEFAULT false,
    tradeLogId TEXT, actualFill REAL, UNIQUE(scanId, ticker)
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE ExecutionLog (
    id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, phase TEXT NOT NULL,
    orderId TEXT, accountType TEXT NOT NULL, requestBody TEXT, responseBody TEXT
  )`);
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(fixture.directory, { recursive: true, force: true });
});

it('connects synthetic entry evidence, exact recovery, closure reconciliation and analytics', async () => {
  const scanDate = new Date('2026-06-01T09:00:00Z');
  const entryDate = new Date('2026-06-01T10:00:00Z');
  await prisma.$executeRaw`INSERT INTO Scan VALUES ('scan-1', 'synthetic-user', ${scanDate})`;
  await prisma.$executeRaw`INSERT INTO CandidateOutcome (id, scanId, ticker, scanDate)
    VALUES ('candidate-1', 'scan-1', 'SYNTHETIC', ${scanDate})`;
  await prisma.$executeRaw`INSERT INTO TradeLog VALUES
    ('entry-1', 'SYNTHETIC', 'ENTRY', 'TAKEN', 'position-1', 'synthetic-user', ${entryDate}, 101, 10, 95, null, 100)`;
  const request = JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1' });
  const response = JSON.stringify({ fillEvidence: {
    version: 1, userId: 'synthetic-user', decisionId: 'decision-1', source: 'ORDER_VALUE_OVER_QUANTITY',
    observedAt: '2026-06-01T10:00:01Z', brokerExecutionTime: null,
    usedPrice: 101, usedQuantity: 10, priceBasis: 'UNVERIFIED',
  } });
  await prisma.$executeRaw`INSERT INTO ExecutionLog VALUES
    (1, 'SYNTHETIC', 'COMPLETE', 'order-1', 'isa', ${request}, ${response})`;

  expect(await backfillTradeLinks()).toBe(1);
  await prisma.$disconnect();
  expect(await backfillTradeLinks()).toBe(0);
  expect(await prisma.candidateOutcome.findUnique({
    where: { id: 'candidate-1' }, select: { tradePlaced: true, tradeLogId: true, actualFill: true },
  })).toEqual({ tradePlaced: true, tradeLogId: 'entry-1', actualFill: 101 });

  const entryAnalytics = await computeExecutionDrag({ userId: 'synthetic-user' });
  expect(entryAnalytics.records[0]).toMatchObject({
    entrySlippagePct: 1, entryGapR: 0.2, actualR: null, modelR: null, rDrag: null,
    fillEvidenceStatus: 'ORDER_VALUE_OVER_QUANTITY',
  });
  expect((await computeExecutionDrag({ userId: 'other-user' })).records).toEqual([]);

  const sell = (id: number, quantity: number, price: number, pnl: number): T212HistoricalOrder => ({
    id: 2, ticker: 'SYNTHETIC_US_EQ', side: 'SELL', type: 'MARKET', status: 'FILLED',
    quantity: 10, filledQuantity: quantity, filledValue: quantity * price,
    dateCreated: '2026-06-02T09:00:00Z', dateExecuted: '2026-06-02T10:00:00Z',
    fills: [{ id, quantity, price, filledAt: '2026-06-02T10:00:00Z',
      walletImpact: { currency: 'GBP', realisedProfitLoss: pnl, netValue: quantity * price, fxRate: 1 } }],
  });
  const position = { t212Ticker: 'SYNTHETIC_US_EQ', shares: 10, entryDate };
  const first = sell(21, 4, 110, 36);
  const second = sell(22, 6, 115, 84);
  const closedAt = new Date('2026-06-03');
  expect(reconcileClosureEvidence(position, [first], closedAt)).toEqual({ ok: false, reason: 'INCOMPLETE_QUANTITY' });
  expect((await computeExecutionDrag()).records[0].actualR).toBeNull();
  const closure = reconcileClosureEvidence(position, [second, first, first], closedAt);
  expect(closure).toMatchObject({ ok: true, exitPrice: 113, pnlGbp: 120 });
  if (!closure.ok) throw new Error('Synthetic closure did not reconcile');
  const syntheticStoredR = closure.pnlGbp / ((101 - 95) * 10);
  await prisma.$executeRaw`UPDATE TradeLog SET finalRMultiple = ${syntheticStoredR} WHERE id = 'entry-1'`;
  expect((await computeExecutionDrag()).records[0]).toMatchObject({ actualR: 2, entryGapR: 0.2, rDrag: null });

  await prisma.$executeRawUnsafe('INSERT INTO ExecutionLog SELECT 2, ticker, phase, orderId, accountType, requestBody, responseBody FROM ExecutionLog');
  const invalid = await computeExecutionDrag();
  expect(invalid.records[0]).toMatchObject({
    fillEvidenceStatus: 'INVALID_EVIDENCE', actualEntry: null, entryGapR: null, actualR: 2,
  });
  expect(invalid.summary).toMatchObject({ withFills: 0, withEntryGapR: 0, avgEntryGapR: null });
});