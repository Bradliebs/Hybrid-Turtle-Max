import { PrismaClient, type Prisma } from '@prisma/client';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { reconcileClosureEvidence } from '../src/lib/closure-evidence';
import type { T212HistoricalOrder } from '../src/lib/trading212';

export const ARCHIVE_SHA256 = '0a41156bd2f757e48f531d8eca86ea7d4f3a9852e1c293cd0318abb772be2e1b';
export const APPROVED = [
  { ticker: 'UNH', id: 'cmp8yvrnq03qevb04cf9ww3sk', order: 51064787629, oldGbp: null, oldR: null, gbp: -2.15, profitR: -0.4216250395194454 },
  { ticker: 'TKNO', id: 'cmpr2u2w2000hvbfsfwsi9hw4', order: 51820280473, oldGbp: 0.65, oldR: 0.8548742442642828, gbp: 5.60, profitR: 1.1081410633320372 },
  { ticker: 'GCBC', id: 'cmq5bwn1t0008vbs8sltrisrr', order: 52522044922, oldGbp: 1.37, oldR: 0.501944149876282, gbp: 2.41, profitR: 0.36773889478025573 },
  { ticker: 'CLDX', id: 'cmr0unphk0004vbrsvzoc3u53', order: 53460865768, oldGbp: -1.77, oldR: -1.047206229595311, gbp: -14.57, profitR: -1.1044599307286358 },
  { ticker: 'HAYW', id: 'cmr123gnf0002vb90g8t2u095', order: 53565199834, oldGbp: -1.13, oldR: -0.928417021361458, gbp: -10.90, profitR: -0.9389969287448048 },
  { ticker: 'DSFIR.AS', id: 'cmr3it9au000avbsscbvqg0ax', order: 54511302683, oldGbp: 0, oldR: 0, gbp: -6.57, profitR: -0.1672119954502221 },
  { ticker: 'CCRN', id: 'cmrnkt9of0002vbm06hal4nc6', order: 54563439464, oldGbp: null, oldR: null, gbp: 0.97, profitR: 0.00738770194564438 },
  { ticker: 'PEBO', id: 'cmrnx3fd30002vbuovjo6dsoa', order: 54261752626, oldGbp: -1.43, oldR: -0.9324599783259114, gbp: -2.61, profitR: -0.96603760648257 },
  { ticker: 'CRON', id: 'cmt8qdmqp0002vbck1r9fkqqy', order: 56309129372, oldGbp: null, oldR: null, gbp: -0.92, profitR: -0.6509301209914997 },
] as const;

type RepairPosition = Prisma.PositionGetPayload<{ include: { stock: { select: { ticker: true } }; tradeLogs: true } }>;
const archiveSchema = z.object({
  accountIdHash: z.string().length(64), accountMatches: z.literal(true),
  historyComplete: z.literal(true), environment: z.literal('live'), accountType: z.literal('isa'),
  failure: z.null(), orders: z.array(z.unknown()).min(1),
});
type Archive = z.infer<typeof archiveSchema>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function readArchive(bytes: Buffer): Archive {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), ARCHIVE_SHA256, 'ARCHIVE_HASH_MISMATCH');
  return archiveSchema.parse(JSON.parse(bytes.toString('utf8')));
}

export function planCorrection(position: RepairPosition, orders: T212HistoricalOrder[]) {
  const approved = APPROVED.find(item => item.id === position.id);
  assert.ok(approved, 'UNAPPROVED_POSITION');
  assert.equal(position.stock.ticker, approved.ticker);
  assert.equal(position.userId, 'default-user');
  assert.equal(position.accountType, 'isa');
  assert.equal(position.status, 'CLOSED');
  assert.ok(position.t212Ticker && position.exitDate, 'MISSING_POSITION_EVIDENCE');
  const evidence = reconcileClosureEvidence({ ...position, t212Ticker: position.t212Ticker }, orders, position.exitDate);
  assert.ok(evidence.ok, evidence.ok ? '' : evidence.reason);
  assert.equal(evidence.order.id, approved.order);
  assert.equal(evidence.order.type, approved.ticker === 'CCRN' ? 'MARKET' : 'STOP');
  const initialR = position.initial_R ?? position.initialRisk;
  assert.ok(Number.isFinite(initialR) && initialR > 0, 'INVALID_ORIGINAL_RISK');
  const profitR = (evidence.exitPrice - position.entryPrice) / initialR;
  assert.ok(Math.abs(evidence.pnlGbp - approved.gbp) < 1e-8, 'UNAPPROVED_GBP_RESULT');
  assert.ok(Math.abs(profitR - approved.profitR) < 1e-10, 'UNAPPROVED_R_RESULT');
  const exits = position.tradeLogs.filter(log => ['EXIT', 'STOP_HIT'].includes(log.tradeType));
  assert.ok(exits.length <= 1, 'AMBIGUOUS_EXIT_LOG');
  const existing = exits[0];
  if (existing) {
    assert.equal(existing.userId, position.userId);
    assert.equal(existing.ticker, approved.ticker);
    assert.ok(existing.t212OrderId == null || existing.t212OrderId === String(approved.order), 'CONFLICTING_ORDER_ID');
  }
  const exitReason = approved.ticker === 'CCRN' ? 'MANUAL_SALE' : 'STOP_HIT';
  const positionData = {
    exitPrice: evidence.exitPrice, exitDate: evidence.exitDate, exitReason,
    exitProfitR: profitR, realisedPnlR: profitR, realisedPnlGbp: evidence.pnlGbp,
    closedBy: 'BROKER_RECONCILIATION',
  };
  const logData = {
    userId: position.userId, positionId: position.id, ticker: approved.ticker,
    tradeDate: evidence.exitDate, tradeType: exitReason === 'STOP_HIT' ? 'STOP_HIT' : 'EXIT',
    decision: 'TAKEN', entryPrice: position.entryPrice, initialR, shares: position.shares,
    exitPrice: evidence.exitPrice, exitReason, finalRMultiple: profitR, gainLossGbp: evidence.pnlGbp,
    daysHeld: Math.floor((evidence.exitDate.getTime() - position.entryDate.getTime()) / 86400000),
    t212OrderId: String(approved.order), t212Ticker: position.t212Ticker,
    fillPrice: evidence.exitPrice, fillQuantity: position.shares, fillTimestamp: evidence.exitDate,
    fxRateAtFill: evidence.fxRate, netValueGbp: evidence.netValueGbp,
    realisedPnlT212: evidence.pnlGbp, initiatedFrom: evidence.order.initiatedFrom ?? null,
  };
  const matches = (record: object, desired: object) => Object.entries(desired)
    .every(([key, value]) => {
      const actual: unknown = Reflect.get(record, key);
      return typeof value === 'number' && typeof actual === 'number'
        ? Math.abs(actual - value) <= 1e-10 : same(actual, value);
    });
  const applied = matches(position, positionData) && existing != null && matches(existing, logData);
  if (!applied) {
    assert.equal(position.realisedPnlGbp, approved.oldGbp, 'OLD_GBP_CHANGED');
    assert.equal(position.realisedPnlR, approved.oldR, 'OLD_R_CHANGED');
  }
  return { ticker: approved.ticker, before: position, positionData, logData,
    logId: existing?.id ?? `broker-closure-${approved.order}`, applied,
    fillIds: evidence.order.fills!.map(fill => fill.id) };
}

async function makePlan(client: Prisma.TransactionClient, archive: Archive) {
  const user = await client.user.findUniqueOrThrow({ where: { id: 'default-user' },
    select: { t212IsaAccountId: true, t212Environment: true, t212IsaConnected: true } });
  assert.equal(user.t212Environment, 'live');
  assert.equal(user.t212IsaConnected, true);
  assert.ok(user.t212IsaAccountId);
  assert.equal(createHash('sha256').update(user.t212IsaAccountId).digest('hex'), archive.accountIdHash, 'ACCOUNT_CHANGED');
  const positions = await client.position.findMany({ where: { id: { in: APPROVED.map(item => item.id) } },
    include: { stock: { select: { ticker: true } }, tradeLogs: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
  assert.equal(positions.length, 9, 'MISSING_APPROVED_POSITION');
  const plans = positions.map(position => planCorrection(position, archive.orders as T212HistoricalOrder[]));
  const collisions = await client.tradeLog.findMany({ where: { t212OrderId: { in: APPROVED.map(item => String(item.order)) } } });
  for (const log of collisions) {
    assert.ok(plans.some(plan => plan.logId === log.id && plan.before.id === log.positionId), 'ORDER_ALREADY_LINKED_ELSEWHERE');
  }
  return plans;
}

export async function repairClosures(source: string, archivePath: string, outputDirectory?: string) {
  const archive = readArchive(await readFile(archivePath));
  const readonly = new Database(source, { readonly: true, fileMustExist: true });
  readonly.pragma('query_only = ON');
  const client = new PrismaClient({ datasourceUrl: `file:${path.resolve(source).replaceAll('\\', '/')}` });
  try {
    const plans = await client.$transaction(tx => makePlan(tx, archive));
    const pending = plans.filter(plan => !plan.applied);
    const summary = { pending: pending.length, alreadyApplied: plans.length - pending.length,
      updates: pending.map(plan => ({ ticker: plan.ticker, gbp: plan.positionData.realisedPnlGbp,
        profitR: plan.positionData.realisedPnlR, log: plan.before.tradeLogs.some(log => log.id === plan.logId) ? 'update' : 'create' })) };
    if (!outputDirectory || !pending.length) return { ...summary, applied: 0 };
    const relative = path.relative(path.resolve('prisma/backups'), path.resolve(outputDirectory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'OUTPUT_MUST_BE_UNDER_BACKUPS');
    await mkdir(outputDirectory);
    const backupPath = path.join(outputDirectory, 'before.db');
    await readonly.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok', 'BACKUP_INVALID'); }
    finally { backup.close(); }
    await writeFile(path.join(outputDirectory, 'intent.json'), JSON.stringify({ archiveSha256: ARCHIVE_SHA256,
      source: path.resolve(source), backupPath, plans }, null, 2), { flag: 'wx' });
    await client.$transaction(async tx => {
      assert.ok(same(await makePlan(tx, archive), plans), 'STALE_PLAN_NO_WRITES');
      for (const plan of pending) {
        await tx.position.update({ where: { id: plan.before.id }, data: plan.positionData });
        if (plan.before.tradeLogs.some(log => log.id === plan.logId)) {
          await tx.tradeLog.update({ where: { id: plan.logId }, data: plan.logData });
        } else {
          await tx.tradeLog.create({ data: { id: plan.logId, ...plan.logData,
            initialStop: plan.before.initial_stop ?? plan.before.stopLoss, atrAtEntry: plan.before.atr_at_entry } });
        }
      }
      assert.ok((await makePlan(tx, archive)).every(plan => plan.applied), 'POSTCONDITION_FAILED');
    }, { timeout: 20_000 });
    const result = { ...summary, applied: pending.length, backupPath };
    await writeFile(path.join(outputDirectory, 'receipt.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    return result;
  } finally {
    readonly.close();
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, archive, mode, output] = process.argv.slice(2);
  assert.ok(source && archive && (!mode || mode === '--apply'), 'USAGE: source.db archive.json [--apply new-backup-directory]');
  assert.ok(mode !== '--apply' || output, 'BACKUP_DIRECTORY_REQUIRED');
  repairClosures(source, archive, output).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'REPAIR_FAILED'); process.exitCode = 1; });
}