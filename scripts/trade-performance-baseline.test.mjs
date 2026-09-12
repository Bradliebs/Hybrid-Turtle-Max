import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { readBaseline, summarizePositions, timestamp } from './trade-performance-baseline.mjs';

const from = '2026-03-10T00:00:00.000Z';
const asOf = '2026-09-10T15:25:00.000Z';
const position = overrides => ({ id: 'position', ticker: 'TEST', status: 'CLOSED',
  entryDate: '2026-06-01T00:00:00.000Z', exitDate: '2026-06-03T00:00:00.000Z',
  entryPrice: 100, exitPrice: 110, initialRisk: 5, initial_R: 5,
  realisedPnlR: 2, realisedPnlGbp: 8, shares: 1, ...overrides });

test('empty evidence has unavailable rates, not a performance verdict', () => {
  const result = summarizePositions([], [], from, asOf);
  assert.equal(result.winRate, null);
  assert.equal(result.profitFactorR, null);
  assert.equal(result.expectancyStoredR, null);
  assert.equal(result.sampleGate, 'INSUFFICIENT_ENTRY_DAYS');
});

test('excludes invalid risk, incomplete exits, open and out-of-window positions', () => {
  const rows = [position({}), position({ initial_R: 0 }), position({ realisedPnlR: null, exitPrice: null }),
    position({ status: 'OPEN', exitDate: null }), position({ entryDate: '2026-01-01' }),
    position({ exitDate: '2026-09-11' }), position({ exitDate: '2026-05-01' })];
  const result = summarizePositions(rows, [], from, asOf);
  assert.equal(result.positionCount, 6);
  assert.equal(result.measured, 1);
  assert.equal(result.closed, 4);
  assert.equal(result.open, 1);
  assert.equal(result.unclassifiedAtCutoff, 1);
  assert.equal(result.excludedClosed.length, 3);
});

test('separates flat trades, weights trades equally and counts distinct entry days', () => {
  const rows = [position({}), position({realisedPnlR: -1, exitPrice: 95}), position({realisedPnlR: 0, exitPrice: 100})];
  const result = summarizePositions(rows, [], from, asOf);
  assert.equal(result.distinctEntryDays, 1);
  assert.equal(result.totalStoredR, 1);
  assert.equal(result.winRate, 1 / 3);
  assert.equal(result.averageLossR, -1);
  assert.equal(result.profitFactorR, 2);
  assert.equal(result.flat, 1);
});

test('reconciles only unique ID-linked exits; no ticker/date guessing or FX assumptions', () => {
  const exit = { positionId:'position', tradeDate:'2026-06-03', tradeType:'EXIT',
    t212OrderId:'order', realisedPnlT212:8, fillQuantity:-1, fillTimestamp:'2026-06-02' };
  const result = summarizePositions([position({})], [exit], from, asOf).reconciliation[0];
  assert.equal(result.rMatches, true);
  assert.equal(result.gbpMatches, true);
  assert.equal(result.quantityMatches, true);
  assert.equal(summarizePositions([position({})], [exit,exit], from, asOf).reconciliation[0].linkedBrokerPnl, null);
  assert.equal(summarizePositions([position({})], [{...exit,positionId:null}], from, asOf).reconciliation[0].linkedBrokerPnl, null);
});

test('flags inconsistent R and quantities without rewriting outcomes', () => {
  const result = summarizePositions([position({realisedPnlR:3})], [{ positionId:'position',
    tradeDate:'2026-06-03',tradeType:'EXIT',fillQuantity:0.5 }], from, asOf);
  assert.equal(result.totalStoredR, 3);
  assert.equal(result.reconciliation[0].rMatches, false);
  assert.equal(result.reconciliation[0].quantityMatches, false);
  assert.equal(result.reconciliation[0].gbpMatches, null);
});

test('timestamps accept SQLite milliseconds and ISO, rejecting invalid intervals', () => {
  assert.equal(timestamp(1789030050000), 1789030050000);
  assert.equal(timestamp(null), null);
  assert.throws(()=>timestamp('invalid'));
  assert.throws(()=>summarizePositions([],[],asOf,from));
});

test('reports missing GBP and zero-loss profit factor as unavailable', () => {
  const result = summarizePositions([position({realisedPnlGbp:null})], [], from, asOf);
  assert.equal(result.profitFactorR, null);
  assert.equal(result.storedGbpCount, 0);
  assert.equal(result.reconciliation[0].gbpMatches, null);
});

test('queues missing outcomes without inventing exit prices or matching ticker-only records', () => {
  const missing = position({exitPrice:null,realisedPnlR:null,realisedPnlGbp:null});
  const unrelated = {positionId:null,ticker:'TEST',tradeDate:'2026-06-03',tradeType:'EXIT'};
  const queue = summarizePositions([missing],[unrelated],from,asOf).reconciliationQueue;
  assert.equal(queue.length,1);
  assert.deepEqual(queue[0].reasons,['MISSING_OR_INVALID_OUTCOME','MISSING_GBP_OUTCOME','NO_LINKED_EXIT']);
  assert.equal(queue[0].linkedExitQuantity,null);
  assert.equal(queue[0].repairAuthorized,false);
  assert.equal(missing.exitPrice,null);
});

test('queues partial, duplicate and out-of-window exits without scaling broker P&L', () => {
  const exit = {positionId:'position',tradeDate:'2026-06-03',tradeType:'EXIT',
    t212OrderId:'order',fillTimestamp:'2026-06-02',fillPrice:110,fillQuantity:-0.5,realisedPnlT212:8};
  const partial = summarizePositions([position({})],[exit],from,asOf);
  assert.deepEqual(partial.reconciliationQueue[0].reasons,['EXIT_QUANTITY_MISMATCH']);
  assert.equal(partial.reconciliationQueue[0].linkedExitQuantity,0.5);
  assert.equal(partial.storedGbpSubtotal,8);
  assert.deepEqual(summarizePositions([position({})],[exit,exit],from,asOf).reconciliationQueue[0].reasons,['MULTIPLE_LINKED_EXITS']);
  assert.ok(summarizePositions([position({})],[{...exit,fillTimestamp:'2026-05-31'}],from,asOf)
    .reconciliationQueue[0].reasons.includes('FILL_OUTSIDE_HOLDING_WINDOW'));
});

test('complete internal agreement is not added to the exception queue or labeled verified profit', () => {
  const exit = {positionId:'position',tradeDate:'2026-06-03',tradeType:'EXIT',t212OrderId:'order',
    fillTimestamp:'2026-06-03',fillPrice:110,fillQuantity:-1,realisedPnlT212:8};
  const result = summarizePositions([position({})],[exit],from,asOf);
  assert.deepEqual(result.reconciliationQueue,[]);
  assert.equal(result.evidence,'DESCRIPTIVE_ONLY_NOT_VERIFIED_NET_ACCOUNT_PERFORMANCE');
});

test('rejects a missing database instead of creating an empty one', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'trade-baseline-missing-'));
  try {
    assert.throws(() => readBaseline(path.join(directory,'missing.db'),from,asOf));
  } finally {
    rmSync(directory,{recursive:true,force:true});
  }
});

test('database path is read-only, deterministic and keeps source/account cohorts separate', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'trade-baseline-'));
  const databasePath = path.join(directory,'fixture.db');
  try {
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE Stock (id TEXT, ticker TEXT, currency TEXT);
      CREATE TABLE Position (id TEXT,userId TEXT,stockId TEXT,status TEXT,source TEXT,accountType TEXT,
        entryPrice REAL,exitPrice REAL,entryDate INTEGER,exitDate INTEGER,initialRisk REAL,initial_R REAL,
        shares REAL,realisedPnlR REAL,realisedPnlGbp REAL,exitReason TEXT);
      CREATE TABLE TradeLog (id TEXT,positionId TEXT,tradeDate INTEGER,tradeType TEXT,decision TEXT,
        t212OrderId TEXT,fillTimestamp INTEGER,fillQuantity REAL,fillPrice REAL,fxRateAtFill REAL,
        netValueGbp REAL,realisedPnlT212 REAL,importedFromT212 INTEGER,plannedEntry REAL,actualFill REAL,
        slippagePct REAL,fillTime INTEGER,rankScore REAL,ncsScore REAL,regime TEXT);
      CREATE TABLE CandidateOutcome (scanDate INTEGER,enrichedAt INTEGER,fwdReturn20d REAL,tradePlaced INTEGER,tradeLogId TEXT);
      CREATE TABLE EquitySnapshot (capturedAt INTEGER);
      INSERT INTO Stock VALUES ('stock','TEST','GBX');
    `);
    const insert = database.prepare(`INSERT INTO Position VALUES (?,?,'stock','CLOSED',?,?,100,110,?,?,5,5,1,2,NULL,NULL)`);
    insert.run('first','user','auto-trade','isa',timestamp('2026-06-01'),timestamp('2026-06-03'));
    insert.run('second','user','trading212','invest',timestamp('2026-06-01'),timestamp('2026-06-03'));
    database.close();
    const before = readFileSync(databasePath);
    const result = readBaseline(databasePath,from,asOf);
    const repeated = readBaseline(databasePath,from,asOf);
    assert.equal(result.readOnly,true);
    assert.equal(result.periodPositions.measured,2);
    assert.equal(result.cohorts.length,2);
    assert.equal(result.cohorts[0].accountType,'isa');
    assert.equal(result.cohorts[1].accountType,'invest');
    assert.equal(result.cohorts[0].storedGbpCount,0);
    assert.equal(result.fingerprint,repeated.fingerprint);
    assert.deepEqual(readFileSync(databasePath),before);
    assert.equal(JSON.stringify(result).includes('confirmed-live'),true);
  } finally {
    rmSync(directory,{recursive:true,force:true});
  }
});