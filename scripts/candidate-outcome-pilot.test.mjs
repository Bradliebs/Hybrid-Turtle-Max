import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { PILOT, pilotSessions, readPilot, reconstructWindow, validateIdentity } from './candidate-outcome-pilot.mjs';

const cutoff = Date.parse('2026-09-10');
const sessions = Array.from({ length: 35 }, (_, index) => new Date(Date.UTC(2026, 5, 1 + index)))
  .filter(date => date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
  .map(date => ({ day: date.toISOString().slice(0, 10), closeAt: date.getTime() + 20 * 3600000 }));
const bars = sessions.map((session, index) => ({ id: `bar-${index}`, date: Date.parse(session.day),
  open: 100 + index, high: 102 + index, low: 99 + index, close: 100 + index,
  adjustedClose: 100 + index, source: 'YAHOO', fetchedAt: cutoff - 86400000 }));
const candidate = { id: 'candidate', scanDate: Date.parse('2026-06-01T21:00:00Z'), price: 100,
  fwdReturn5d: 0, fwdReturn10d: null, fwdReturn20d: 11, enrichedAt: cutoff };
const run = (inputBars = bars, inputCandidate = candidate) => reconstructWindow(inputCandidate, inputBars, sessions, cutoff);

test('anchors after scan date and reconstructs chronological horizons regardless of input order', () => {
  const result = run([...bars].reverse());
  assert.deepEqual(result.horizons.map(item => item.status), Array(3).fill('ACCEPTED_CONDITIONAL'));
  for (const item of result.horizons) assert.ok(Math.abs(item.reconstructed - item.horizon) < 1e-10);
  assert.ok(Math.abs(result.horizons[0].differencePercentagePoints - 5) < 1e-10);
  assert.equal(result.horizons[1].differencePercentagePoints, null);
  assert.equal(result.horizons[2].evidence.length, 20);
});

test('rejects missing sessions without shifting horizon and accepts independently complete shorter windows', () => {
  const result = run(bars.filter((_, index) => index !== 8));
  assert.equal(result.horizons[0].status, 'ACCEPTED_CONDITIONAL');
  assert.equal(result.horizons[1].reconstructed, null);
  assert.match(result.horizons[1].reasons.join(','), /MISSING_SESSION/);
});

test('rejects duplicate session dates even at different timestamps or sources', () => {
  for (const extra of [{ ...bars[2], date: bars[2].date + 3600000 }, { ...bars[2], source: 'OTHER' }]) {
    assert.match(run([...bars, extra]).horizons[0].reasons.join(','), /DUPLICATE_SESSION/);
  }
});

test('rejects adjusted/raw mismatch, absent adjustments, invalid OHLC and unfinished or future evidence', () => {
  for (const [change, reason] of [
    [{ adjustedClose: 50 }, 'ADJUSTMENT_FACTOR_CHANGED'],
    [{ adjustedClose: null }, 'ADJUSTMENT_BASIS_UNRESOLVED'],
    [{ low: 150 }, 'INVALID_OHLC'], [{ close: NaN }, 'INVALID_OHLC'],
    [{ fetchedAt: bars[2].date + 3600000 }, 'POSSIBLY_UNFINISHED_BAR'],
    [{ fetchedAt: cutoff + 1 }, 'UNOBSERVED_AT_CUTOFF'], [{ source: 'OTHER' }, 'UNSUPPORTED_SOURCE'],
  ]) {
    const changed = bars.map((bar, index) => index === 2 ? { ...bar, ...change } : bar);
    assert.ok(run(changed).horizons[0].reasons.some(value => value.startsWith(reason)), reason);
  }
});

test('rejects uncertain scan baseline, pre-close scans, invalid prices and non-session bars', () => {
  assert.ok(run(bars, { ...candidate, price: 1 }).horizons[0].reasons.includes('SCAN_BASELINE_MISMATCH'));
  assert.ok(run(bars, { ...candidate, price: 0 }).horizons[0].reasons.includes('INVALID_SCAN_PRICE'));
  assert.ok(run(bars, { ...candidate, scanDate: Date.parse('2026-06-01T15:00Z') }).horizons[0].reasons.includes('SCAN_BEFORE_POST_CLOSE_CUTOFF'));
  assert.ok(run([...bars, { ...bars[2], date: Date.parse('2026-06-06') }]).horizons[0].reasons.includes('NON_SESSION_BAR'));
});

test('never substitutes zero for missing or not-yet-observed stored outcomes', () => {
  assert.equal(run(bars, { ...candidate, enrichedAt: cutoff + 1 }).horizons[0].stored, null);
  assert.equal(run().horizons[0].stored, 0);
  assert.throws(() => reconstructWindow(candidate, bars, sessions, NaN));
});

test('constant adjustment factors cancel; a factor changing inside the horizon does not', () => {
  for (const factor of [0.997, 0.5, 2]) {
    const adjusted = bars.map(bar => ({ ...bar, adjustedClose: bar.close * factor }));
    const result = run(adjusted);
    assert.deepEqual(result.horizons.map(item => item.reconstructed), run().horizons.map(item => item.reconstructed));
    for (const horizon of result.horizons) {
      const ratioReturn = (horizon.evidence.at(-1).bar.adjustedClose / adjusted[0].adjustedClose - 1) * 100;
      assert.ok(Math.abs(ratioReturn - horizon.reconstructed) < 1e-10);
    }
    adjusted[8] = { ...adjusted[8], adjustedClose: adjusted[8].close * factor * 0.9 };
    assert.equal(run(adjusted).horizons[0].status, 'ACCEPTED_CONDITIONAL');
    assert.ok(run(adjusted).horizons[1].reasons.includes('ADJUSTMENT_FACTOR_CHANGED'));
  }
});

test('frozen regional calendars distinguish actual holidays and remain outside holdout', () => {
  assert.equal(pilotSessions('US').some(session => session.day === '2026-06-19'), false);
  assert.equal(pilotSessions('UK').some(session => session.day === '2026-05-25'), false);
  assert.equal(pilotSessions('AMS').some(session => session.day === '2026-05-25'), true);
  assert.equal(pilotSessions('US').some(session => session.day === '2026-07-03'), false);
  for (const market of ['US', 'UK', 'AMS']) {
    assert.ok(pilotSessions(market).every(session => session.day < PILOT.holdoutStart));
  }
  assert.throws(() => pilotSessions('UNKNOWN'));
});

test('uses canonical alias and refuses venue or currency guesses; GBp is pence, not GBP', () => {
  const sample = PILOT.symbols.find(item => item.ticker === 'AIAI');
  const stock = { ticker: 'AIAI', yahooTicker: null, currency: 'GBP' };
  const instrument = { symbol: 'AIAI.L', exchange: 'LSE', currency: 'USD', dataSource: 'YAHOO' };
  assert.deepEqual(validateIdentity(sample, [stock], [instrument]), ['CURRENCY_UNIT_CONFLICT']);
  assert.deepEqual(validateIdentity(sample, [{ ...stock, currency: 'GBX' }], [{ ...instrument, currency: 'GBp' }]), []);
  assert.deepEqual(validateIdentity(sample, [stock], [{ ...instrument, currency: 'GBp' }]), ['CURRENCY_UNIT_CONFLICT']);
  assert.deepEqual(validateIdentity(sample, [{ ...stock, yahooTicker: 'AIAI' }], [instrument]), ['SYMBOL_MAPPING_CONFLICT']);
  assert.deepEqual(validateIdentity(sample, [stock], []), ['MISSING_OR_AMBIGUOUS_INSTRUMENT']);
  assert.deepEqual(validateIdentity(sample, [stock, stock], [instrument]), ['MISSING_OR_AMBIGUOUS_STOCK']);
  assert.ok(validateIdentity(sample, [stock], [{ ...instrument, exchange: 'NMS' }]).includes('EXCHANGE_CONFLICT'));
});

test('SQLite pilot selects earliest status rows, preserves bytes and ignores holdout outcomes and bars', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'outcome-pilot-'));
  const filename = path.join(directory, 'fixture.db');
  try {
    const database = new Database(filename);
    database.exec(`CREATE TABLE Stock (id TEXT,ticker TEXT,yahooTicker TEXT,currency TEXT,region TEXT);
      CREATE TABLE Instrument (id TEXT,symbol TEXT,exchange TEXT,currency TEXT,dataSource TEXT);
      CREATE TABLE CandidateOutcome (id TEXT,scanId TEXT,ticker TEXT,scanDate INTEGER,price REAL,
        enrichedAt INTEGER,fwdReturn5d REAL,fwdReturn10d REAL,fwdReturn20d REAL);
      CREATE TABLE DailyBar (id TEXT,instrumentId TEXT,date INTEGER,open REAL,high REAL,low REAL,
        close REAL,adjustedClose REAL,source TEXT,fetchedAt INTEGER);
      INSERT INTO Stock VALUES ('stock','AA',NULL,'USD','US');
      INSERT INTO Instrument VALUES ('instrument','AA','NYQ','USD','YAHOO');`);
    const insertCandidate = database.prepare('INSERT INTO CandidateOutcome VALUES (?,?,?,?,?,?,?,?,?)');
    insertCandidate.run('first', 'scan', 'AA', candidate.scanDate, 100, null, null, null, null);
    insertCandidate.run('later', 'scan2', 'AA', candidate.scanDate + 86400000, 101, null, null, null, null);
    insertCandidate.run('holdout', 'holdout', 'AA', Date.parse('2026-08-03'), 100, cutoff, 999, 999, 999);
    const validSessions = pilotSessions('US').filter(session => session.day >= '2026-06-01').slice(0, 21);
    const insertBar = database.prepare('INSERT INTO DailyBar VALUES (?,?,?,?,?,?,?,?,?,?)');
    validSessions.forEach((session, index) => insertBar.run(`bar${index}`, 'instrument', Date.parse(session.day),
      100 + index, 102 + index, 99 + index, 100 + index, 100 + index, 'YAHOO', cutoff - 1));
    database.close();
    const before = readFileSync(filename);
    const report = readPilot(filename);
    assert.equal(report.summary.selectedRows, 1);
    assert.equal(report.rows[0].candidate.id, 'first');
    assert.equal(report.summary.acceptedAllHorizons, 1);
    assert.equal(report.rows[0].sourceBars.length, 21);
    assert.equal(report.sourceFingerprint, readPilot(filename).sourceFingerprint);
    assert.deepEqual(before, readFileSync(filename));
    const writer = new Database(filename);
    writer.prepare('UPDATE CandidateOutcome SET fwdReturn20d = -999 WHERE id = ?').run('holdout');
    insertUnusedBar(writer);
    writer.close();
    assert.equal(report.sourceFingerprint, readPilot(filename).sourceFingerprint);
    const missing = path.join(directory, 'missing.db');
    assert.throws(() => readPilot(missing));
    assert.equal(existsSync(missing), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function insertUnusedBar(database) {
  database.prepare('INSERT INTO DailyBar VALUES (?,?,?,?,?,?,?,?,?,?)').run('holdout-bar', 'instrument',
    Date.parse('2026-08-04'), 999, 1000, 998, 999, 999, 'YAHOO', cutoff);
}