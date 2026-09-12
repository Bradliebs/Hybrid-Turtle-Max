import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';

const fixture = vi.hoisted(() => ({ directory: '', databasePath: '' }));
vi.mock('../packages/data/src/prisma', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { PrismaClient } = await import('@prisma/client');
  fixture.directory = await mkdtemp(join(tmpdir(), 'trading-simulation-'));
  fixture.databasePath = join(fixture.directory, 'research.db');
  return {
    prisma: new PrismaClient({ datasources: { db: {
      url: `file:${fixture.databasePath.replace(/\\/g, '/')}?connection_limit=1`,
    } } }),
    round: (value: number, precision = 4) => Number(value.toFixed(precision)),
  };
});

import { prisma } from '../packages/data/src/prisma';
import {
  applyExecutionCostScenario, isCompleteBacktestTrade, runBacktest,
  simulateCashConstrainedPortfolio, simulateStopLadder,
} from '../packages/backtest/src/runner';
import type { BacktestMode, BacktestTrade } from '../packages/backtest/src/types';
import { screenEntryPolicy } from './entry-policy-screen';

const sourcePath = process.env.HT_SIMULATION_SOURCE;
const reportPath = process.env.HT_SIMULATION_REPORT;
const holdoutStart = new Date('2026-08-01T00:00:00Z').getTime();
const costScenarios = [0, 0.25, 0.5];
const modes: BacktestMode[] = ['FULL', 'CORE_LITE'];
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const blockedFetch = vi.fn(() => { throw new Error('Simulation network access prohibited'); });
let databaseHash: string | null = null;
let networkGuard: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vi.stubGlobal('fetch', blockedFetch);
  networkGuard = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('Simulation socket access prohibited');
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(fixture.directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deterministic synthetic execution stress', () => {
  it.each([
    { open: 99, low: 89, close: 100, expectedR: -1 },
    { open: 90, low: 85, close: 95, expectedR: -1 },
    { open: 80, low: 75, close: 120, expectedR: -2 },
    { open: 50, low: 45, close: 100, expectedR: -5 },
  ])('prices stop execution at $expectedR R for an open of $open', scenario => {
    const result = simulateStopLadder(100, 90, [{
      date: '2026-06-02', atr14: 2, ...scenario,
    }]);
    expect(result.hitR).toBe(scenario.expectedR);
    expect(result.maxFavR).toBe(0);
  });

  it('charges both sides of an adverse gap and respects whole-share risk sizing', () => {
    const trade: BacktestTrade = {
      ticker: 'SYNTHETIC', name: 'Synthetic only', sleeve: 'CORE', regime: 'BULLISH',
      signalDate: '2026-06-01T22:00:00Z', entryPrice: 100, entryTrigger: 100,
      stopLevel: 90, riskPerShare: 10, currency: 'GBP', entryFxToGbp: 1, exitFxToGbp: 1,
      bqs: 80, fws: 10, ncs: 80, bps: 70, actionNote: 'SYNTHETIC',
      stopHit: true, stopHitDate: '2026-06-02T00:00:00Z', stopHitR: -2,
      maxFavorableR: 0, maxAdverseR: -2, realizedR: -2,
      exitDate: '2026-06-02T00:00:00Z', exitReason: 'STOP_HIT', daysHeld: 1,
    };
    expect(applyExecutionCostScenario({ ...trade, realizedR: -2 }, 0.5)).toBe(-2.09);
    const portfolio = simulateCashConstrainedPortfolio([trade], 10_000, 2, 0.5, 4);
    expect(portfolio.funded[0]).toMatchObject({ quantity: 20, riskAmount: 200, netPnl: -418 });
    expect(portfolio.endingCash).toBe(9582);
    expect(simulateCashConstrainedPortfolio([], 10_000, 2, 0.5, 4).endingCash).toBe(10_000);
  });
});

describe.skipIf(!sourcePath)('isolated historical development replay', () => {
  beforeAll(async () => {
    const source = new Database(resolve(sourcePath!), { readonly: true, fileMustExist: true });
    try {
      source.pragma('query_only = ON');
      await source.backup(fixture.databasePath);
    } finally {
      source.close();
    }
    const sandbox = new Database(fixture.databasePath, { fileMustExist: true });
    try {
      sandbox.pragma('foreign_keys = OFF');
      sandbox.pragma('secure_delete = ON');
      const keepTables = new Set(['Snapshot', 'SnapshotTicker', 'Stock', 'Instrument', 'DailyBar']);
      const tables = sandbox.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      for (const { name } of tables) {
        if (!keepTables.has(name) && !name.startsWith('sqlite_')) {
          sandbox.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
        }
      }
      sandbox.prepare('DELETE FROM SnapshotTicker WHERE snapshotId IN (SELECT id FROM Snapshot WHERE createdAt >= ?)').run(holdoutStart);
      sandbox.prepare('DELETE FROM Snapshot WHERE createdAt >= ?').run(holdoutStart);
      sandbox.prepare('DELETE FROM DailyBar WHERE date >= ?').run(holdoutStart);
      sandbox.exec('VACUUM');
      expect(sandbox.pragma('quick_check', { simple: true })).toBe('ok');
    } finally {
      sandbox.close();
    }
    databaseHash = sha256(await readFile(fixture.databasePath));
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA query_only = ON');
    const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>('SELECT file FROM pragma_database_list WHERE name = \'main\'');
    expect(resolve(databases[0].file)).toBe(resolve(fixture.databasePath));
    await expect(prisma.$executeRawUnsafe('DELETE FROM Snapshot WHERE 1 = 0')).rejects.toThrow();
  }, 120_000);

  it('runs the fixed mode/cost grid and missed-entry stress without writes or network', async () => {
    const scenarios = [];
    const policyScreens = [];
    const policyRows = await prisma.snapshotTicker.findMany({
      where: { snapshot: { createdAt: {
        gte: new Date('2026-05-01T00:00:00Z'), lte: new Date('2026-06-30T23:59:59Z'),
      } } },
      select: { ticker: true, status: true, close: true, entryTrigger: true,
        marketRegime: true, volRatio: true, rsVsBenchmarkPct: true, atrSpiking: true,
        snapshot: { select: { createdAt: true } } },
    });
    const rowsByIdentity = new Map<string, typeof policyRows>();
    for (const row of policyRows) {
      const key = `${row.ticker}|${row.snapshot.createdAt.toISOString()}`;
      const rows = rowsByIdentity.get(key) ?? [];
      rows.push(row);
      rowsByIdentity.set(key, rows);
    }
    for (const mode of modes) {
      for (const executionCostPctPerSide of costScenarios) {
        const result = await runBacktest({
          startDate: new Date('2026-05-01T00:00:00Z'),
          endDate: new Date('2026-06-30T23:59:59Z'),
          mode, initialCapital: 10_000, riskPerTradePct: 2, maxPositions: 4,
          executionCostPctPerSide,
        });
        expect(result.summary.validity).not.toBe('VALID');
        expect(result.summary.totalReturnPct).toBeNull();
        expect(result.equityCurve).toEqual([]);
        expect(result.trades.every(trade => new Date(trade.signalDate) < new Date('2026-07-01'))).toBe(true);
        expect(result.trades.every(trade => !trade.exitDate || new Date(trade.exitDate).getTime() < holdoutStart)).toBe(true);
        if (mode === 'FULL') {
          for (const minVolumeRatio of [0.15, 0.4, 0.5, 0.6]) {
            const observations = result.trades.map(trade => {
              const rows = rowsByIdentity.get(`${trade.ticker}|${trade.signalDate}`) ?? [];
              const row = rows.length === 1 ? rows[0] : null;
              const screen = screenEntryPolicy({
                regime: row?.marketRegime ?? null, status: row?.status ?? null,
                price: row?.close ?? null, trigger: row?.entryTrigger ?? null,
                ncs: trade.ncs, bqs: trade.bqs, fws: trade.fws,
                volumeRatio: row?.volRatio ?? null, relativeStrength: row?.rsVsBenchmarkPct ?? null,
                atrSpiking: row?.atrSpiking ?? null,
              }, minVolumeRatio);
              return { ticker: trade.ticker, signalDate: trade.signalDate,
                exactSnapshotMatches: rows.length, ...screen };
            });
            const notRejected = result.trades.filter((_, index) =>
              observations[index].verdict === 'INCOMPLETE');
            const modeled = simulateCashConstrainedPortfolio(
              notRejected, 10_000, 2, executionCostPctPerSide, 4,
            );
            const completed = modeled.funded.filter(position => isCompleteBacktestTrade(position.trade));
            const rejectedByReason: Record<string, number> = {};
            for (const observation of observations) {
              for (const reason of observation.rejected) {
                rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
              }
            }
            expect(observations.length).toBe(result.trades.length);
            expect(observations.every(observation => observation.verdict !== 'INCOMPLETE'
              || observation.unresolved.length > 0)).toBe(true);
            policyScreens.push({
              kind: 'NECESSARY_CONDITIONS_ONLY_NOT_EXECUTION_ELIGIBILITY',
              minVolumeRatio, executionCostPctPerSide, inputCandidates: observations.length,
              rejected: observations.filter(observation => observation.verdict === 'REJECTED').length,
              incomplete: notRejected.length, rejectedByReason,
              unmatchedOrAmbiguousSnapshots: observations.filter(observation => observation.exactSnapshotMatches !== 1).length,
              candidatesWithMissingFields: observations.filter(observation => observation.missing.length > 0).length,
              modeledFunded: modeled.funded.length, modeledCompleted: completed.length,
              modeledSignalDates: new Set(completed.map(position => position.trade.signalDate.slice(0, 10))).size,
              exploratoryClosedPnlGbp: completed.length
                ? completed.reduce((sum, position) => sum + (position.netPnl ?? 0), 0) : null,
              observations: executionCostPctPerSide === 0 ? observations : undefined,
            });
          }
        }
        for (const missedEntryStress of [false, true]) {
          const ordered = [...result.trades].sort((left, right) =>
            left.signalDate.localeCompare(right.signalDate) || left.ticker.localeCompare(right.ticker));
          const candidates = missedEntryStress ? ordered.filter((_, index) => index % 4 !== 0) : ordered;
          const portfolio = simulateCashConstrainedPortfolio(candidates, 10_000, 2, executionCostPctPerSide, 4);
          const completed = portfolio.funded.filter(position => isCompleteBacktestTrade(position.trade));
          const netR = completed.map(position => applyExecutionCostScenario(
            position.trade as BacktestTrade & { realizedR: number }, executionCostPctPerSide,
          ));
          scenarios.push({
            mode, executionCostPctPerSide, missedEntryStress,
            inputCandidates: candidates.length, funded: portfolio.funded.length,
            completedFunded: completed.length,
            fundedSignalDates: new Set(completed.map(position => position.trade.signalDate.slice(0, 10))).size,
            fundedMeanNetR: netR.length ? netR.reduce((sum, value) => sum + value, 0) / netR.length : null,
            modeledClosedPnlGbp: completed.length
              ? completed.reduce((sum, position) => sum + (position.netPnl ?? 0), 0) : null,
            cashRejected: portfolio.cashRejected, fxRejected: portfolio.fxRejected,
            positionRejected: portfolio.positionRejected,
            allSignalSummary: missedEntryStress ? null : result.summary,
          });
        }
      }
    }
    expect(blockedFetch).not.toHaveBeenCalled();
    expect(networkGuard).not.toHaveBeenCalled();
    await prisma.$disconnect();
    expect(sha256(await readFile(fixture.databasePath))).toBe(databaseHash);
    const report = {
      generatedAt: new Date().toISOString(), kind: 'DEVELOPMENT_SIMULATION_NOT_LIVE_PROFIT',
      databaseHash, sourceOpenedReadOnly: true, sandboxByteUnchanged: true,
      networkCalls: 0, holdoutExcludedFrom: new Date(holdoutStart).toISOString(),
      limitations: [
        'Snapshot trigger crossings are not the live scan/review/risk-gated execution policy.',
        'FULL and CORE_LITE are existing research modes, not newly optimized strategies.',
        'Costs are fixed adverse assumptions; spreads, FX fees, liquidity and attainable fills are not observed.',
        'Every fourth chronological ticker signal is omitted in stress cases; this is not an empirical fill probability.',
        'Bar adjustment basis, historical metadata and fetch-time provenance are not certified.',
        'Stored snapshot closes are assumed entry fills; no executable quote is reconstructed.',
        'Time exits approximate 20 calendar days, not 20 trading sessions.',
        'Missing future FX can affect selection; this is not a strictly point-in-time execution replay.',
        'All-signal confidence metrics are not funded-portfolio confidence metrics.',
        'Closed-trade P&L is modeled, excludes marking unresolved holdings, and is not verified portfolio return.',
        'No independent holdout evaluation, historical closure repair or live strategy change occurred.',
        'Policy screens test only necessary observable A-grade conditions under current rules, not historical policy compliance.',
        'Policy-screen scores are recomputed research scores; schema-defaulted snapshot fields lack certified observation provenance.',
        'Session volume thresholds are sensitivity cases, not reconstructed intraday session data or tuned challengers.',
        'Non-rejected candidates remain INCOMPLETE: fresh quotes, technical filters, portfolio gates and broker evidence are unresolved.',
        'Policy-screen subset P&L is exploratory, not an executable strategy return or evidence of profit improvement.',
      ],
      scenarios, policyScreens,
    };
    if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.table(scenarios.map(({ allSignalSummary: _summary, ...scenario }) => scenario));
    console.table(policyScreens.map(({ observations: _observations, rejectedByReason: _reasons, ...screen }) => screen));
  }, 120_000);
});