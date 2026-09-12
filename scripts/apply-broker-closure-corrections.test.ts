import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPROVED, planCorrection, readArchive, repairClosures } from './apply-broker-closure-corrections';
import type { T212HistoricalOrder } from '../src/lib/trading212';

function position(): Parameters<typeof planCorrection>[0] {
  return {
    id: APPROVED[0].id, userId: 'default-user', stockId: 'stock-unh', stock: { ticker: 'UNH' },
    status: 'CLOSED', source: 'trading212', t212Ticker: 'UNH_US_EQ', entryPrice: 395.375,
    entryDate: new Date('2026-05-12T00:00:00Z'), shares: 0.72, stopLoss: 387.64,
    initialRisk: 19.76875, currentStop: 387.64, protectionLevel: 'INITIAL', exitPrice: null,
    exitDate: new Date('2026-05-18T15:00:00Z'), exitReason: 'Closed on Trading 212 (ISA)',
    exitProfitR: null, realisedPnlGbp: null, realisedPnlR: null, closedBy: null,
    whipsawCount: 0, notes: null, createdAt: new Date(), updatedAt: new Date(),
    atr_at_entry: null, entry_price: 395.375, entry_type: 'BREAKOUT', initial_R: 19.76875,
    initial_stop: 375.60625, profile_used: 'SMALL_ACCOUNT', accountType: 'isa',
    breakoutFailureDetectedAt: null, nearStopAlertSentAt: null, entryTrigger: null, tradeLogs: [],
  };
}

function orders(): T212HistoricalOrder[] {
  return [{ id: 51064787629, ticker: 'UNH_US_EQ', type: 'STOP', side: 'SELL', status: 'FILLED',
    quantity: -0.72, filledQuantity: 0.72, filledValue: 278.6688,
    dateCreated: '2026-05-12T00:00:00Z', dateExecuted: '2026-05-18T13:31:33Z',
    fills: [{ id: 51261797448, quantity: 0.72, price: 387.04, filledAt: '2026-05-18T13:31:33Z',
      walletImpact: { currency: 'GBP', realisedProfitLoss: -2.15 } }] }];
}

describe('approved closure correction plan', () => {
  it('uses verified fills while preserving original risk and entry state', () => {
    const before = position();
    const original = structuredClone(before);
    const plan = planCorrection(before, orders());
    expect(plan.applied).toBe(false);
    expect(plan.positionData.realisedPnlGbp).toBe(-2.15);
    expect(plan.logData.tradeType).toBe('STOP_HIT');
    expect(plan.logData.fillQuantity).toBe(0.72);
    expect(plan.logId).toBe('broker-closure-51064787629');
    expect(before).toEqual(original);
    expect(plan.positionData).not.toHaveProperty('initial_R');
    expect(plan.positionData).not.toHaveProperty('currentStop');
  });

  it.each([
    { id: 'unapproved' }, { accountType: 'invest' }, { userId: 'another-user' },
    { status: 'OPEN' }, { realisedPnlGbp: 1 }, { realisedPnlR: 1 },
    { initial_R: 0 }, { initial_R: 20 }, { shares: 1 },
  ])('rejects changed identity, state, quantity or risk: %j', changes => {
    expect(() => planCorrection({ ...position(), ...changes }, orders())).toThrow();
  });

  it('rejects altered broker outcomes and order identity', () => {
    const wrongAmount = orders();
    wrongAmount[0].fills![0].walletImpact!.realisedProfitLoss = 2;
    expect(() => planCorrection(position(), wrongAmount)).toThrow('UNAPPROVED_GBP_RESULT');
    const wrongOrder = orders();
    wrongOrder[0].id = 123;
    expect(() => planCorrection(position(), wrongOrder)).toThrow();
  });

  it('rejects any archive other than the reviewed bytes', () => {
    expect(() => readArchive(Buffer.from('{}'))).toThrow('ARCHIVE_HASH_MISMATCH');
  });
});

function snapshot(database: Database.Database) {
  const excluded = APPROVED.map(item => item.id);
  const placeholders = excluded.map(() => '?').join(',');
  return {
    otherPositions: database.prepare(`SELECT * FROM Position WHERE id NOT IN (${placeholders}) ORDER BY id`).all(...excluded),
    otherLogs: database.prepare(`SELECT * FROM TradeLog WHERE positionId IS NULL OR positionId NOT IN (${placeholders}) OR tradeType NOT IN ('EXIT','STOP_HIT') ORDER BY id`).all(...excluded),
    stops: database.prepare('SELECT * FROM StopHistory ORDER BY id').all(),
    originalRisk: database.prepare('SELECT id,status,shares,entryPrice,entryDate,initial_R,initialRisk,initial_stop,stopLoss,currentStop,accountType FROM Position ORDER BY id').all(),
  };
}

describe.skipIf(!process.env.HT_CLOSURE_REPAIR_SOURCE)('isolated approved historical repair', () => {
  it('backs up, rolls back failures, applies nine only and repeats without writes', async () => {
    const directory = await mkdtemp(path.resolve('prisma/backups/closure-rehearsal-'));
    const source = new Database(process.env.HT_CLOSURE_REPAIR_SOURCE!, { readonly: true, fileMustExist: true });
    const copyPath = path.join(directory, 'rehearsal.db');
    let copy: Database.Database | undefined;
    let backup: Database.Database | undefined;
    try {
      source.pragma('query_only = ON');
      const sourceBefore = JSON.stringify(snapshot(source));
      await source.backup(copyPath);
      const archivePath = path.resolve('prisma/backups/broker-reconciliation-full-2026-09-12.json');
      const dryRun = await repairClosures(copyPath, archivePath);
      expect(dryRun.pending).toBe(9);
      copy = new Database(copyPath);
      const before = JSON.stringify(snapshot(copy));
      const positionsBefore = copy.prepare('SELECT * FROM Position ORDER BY id').all();
      const logsBefore = copy.prepare('SELECT * FROM TradeLog ORDER BY id').all();
      copy.exec(`CREATE TRIGGER fail_repair BEFORE UPDATE ON Position WHEN OLD.id='${APPROVED[3].id}' BEGIN SELECT RAISE(ABORT, 'TEST_ROLLBACK'); END`);
      await expect(repairClosures(copyPath, archivePath, path.join(directory, 'failed'))).rejects.toThrow();
      expect(copy.prepare('SELECT * FROM Position ORDER BY id').all()).toEqual(positionsBefore);
      expect(copy.prepare('SELECT * FROM TradeLog ORDER BY id').all()).toEqual(logsBefore);
      copy.exec('DROP TRIGGER fail_repair');
      const result = await repairClosures(copyPath, archivePath, path.join(directory, 'applied'));
      expect(result.applied).toBe(9);
      expect(JSON.stringify(snapshot(copy))).toBe(before);
      const totals = copy.prepare("SELECT COUNT(*) AS measured,SUM(realisedPnlGbp) AS gbp,SUM(realisedPnlR) AS profitR FROM Position WHERE status='CLOSED' AND userId='default-user' AND accountType='isa' AND realisedPnlR IS NOT NULL").get() as { measured: number; gbp: number; profitR: number };
      expect(totals.measured).toBe(28);
      expect(totals.gbp).toBeCloseTo(-42.36, 8);
      expect(totals.profitR).toBeCloseTo(-4.9059260508793, 10);
      backup = new Database(path.join(directory, 'applied/before.db'), { readonly: true });
      expect(backup.prepare('SELECT * FROM Position ORDER BY id').all()).toEqual(positionsBefore);
      expect(backup.prepare('SELECT * FROM TradeLog ORDER BY id').all()).toEqual(logsBefore);
      backup.close();
      copy.close();
      const fingerprint = createHash('sha256').update(await readFile(copyPath)).digest('hex');
      const repeat = await repairClosures(copyPath, archivePath, path.join(directory, 'repeat'));
      expect(repeat).toMatchObject({ pending: 0, alreadyApplied: 9, applied: 0 });
      expect(createHash('sha256').update(await readFile(copyPath)).digest('hex')).toBe(fingerprint);
      expect(JSON.stringify(snapshot(source))).toBe(sourceBefore);
    } finally {
      if (backup?.open) backup.close();
      if (copy?.open) copy.close();
      source.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});