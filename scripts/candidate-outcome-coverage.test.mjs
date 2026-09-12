import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { readCoverage, summarizeCoverage } from './candidate-outcome-coverage.mjs';

const asOf = '2026-09-10T00:00:00Z';
const row = { id: 'row-1', scanId: 'scan-1', ticker: 'TEST', status: 'READY',
  scanDate: Date.parse('2026-06-01T20:00:00Z'), price: 100, ncs: 75,
  enrichedAt: Date.parse('2026-06-10T20:00:00Z'),
  fwdReturn5d: 0, fwdReturn10d: null, fwdReturn20d: null,
  tradePlaced: 0, tradeLogId: null, grade: 'A_GRADE_BUY' };

test('separates permanently partial, old unenriched, and recent missing outcomes; zero is observed', () => {
  const report = summarizeCoverage([row, { ...row, id: 'row-2', ticker: 'OTHER', enrichedAt: null },
    { ...row, id: 'row-3', scanDate: Date.parse('2026-09-09'), enrichedAt: null }], asOf);
  assert.equal(report.overall.forward5, 1);
  assert.equal(report.overall.enrichedMissing20, 1);
  assert.equal(report.overall.old42Missing20, 2);
  assert.equal(report.overall.old42NeverEnriched, 1);
  assert.equal(report.overall.recentMissing20, 1);
});

test('counts same-ticker same-day repeats once for ticker-days, not as independent days', () => {
  const report = summarizeCoverage([row, { ...row, id: 'row-2', scanId: 'scan-2' }], asOf);
  assert.equal(report.overall.rows, 2);
  assert.equal(report.overall.scans, 2);
  assert.equal(report.overall.days, 1);
  assert.equal(report.overall.tickerDays, 1);
});

test('excludes future scans and does not treat future enrichment as observed at the cutoff', () => {
  const report = summarizeCoverage([{ ...row, enrichedAt: Date.parse('2026-09-11'), fwdReturn20d: 0 },
    { ...row, scanDate: Date.parse('2026-09-11') }], asOf);
  assert.equal(report.excludedFutureOrInvalidScanRows, 1);
  assert.equal(report.overall.forward20, 0);
  assert.throws(() => summarizeCoverage([], 'invalid'));
  assert.equal(summarizeCoverage([], asOf).overall.first, null);
});

test('reads SQLite without mutation and refuses to choose an ambiguous grade', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'outcome-coverage-'));
  const filename = path.join(directory, 'fixture.db');
  try {
    const database = new Database(filename);
    database.exec(`CREATE TABLE CandidateOutcome (id TEXT, scanId TEXT, scanDate INTEGER, ticker TEXT,
      status TEXT, price REAL, ncs REAL, enrichedAt INTEGER, fwdReturn5d REAL, fwdReturn10d REAL,
      fwdReturn20d REAL, tradePlaced INTEGER, tradeLogId TEXT);
      CREATE TABLE Stock (id TEXT, ticker TEXT);
      CREATE TABLE ScanResult (scanId TEXT, stockId TEXT, grade TEXT);
      INSERT INTO Stock VALUES ('stock-1','TEST');
      INSERT INTO ScanResult VALUES ('scan-1','stock-1','A_GRADE_BUY');
      INSERT INTO ScanResult VALUES ('scan-1','stock-1','B_GRADE_WATCH');`);
    const { grade, ...stored } = row;
    assert.equal(grade, 'A_GRADE_BUY');
    database.prepare(`INSERT INTO CandidateOutcome (${Object.keys(stored).join(',')})
      VALUES (${Object.keys(stored).map(() => '?').join(',')})`).run(...Object.values(stored));
    database.close();
    const before = readFileSync(filename);
    const report = readCoverage(filename, asOf);
    assert.equal(report.byGrade[0].label, 'UNMATCHED_OR_AMBIGUOUS');
    assert.equal(report.overall.rows, 1);
    assert.equal(readCoverage(filename, asOf).sourceFingerprint, report.sourceFingerprint);
    assert.deepEqual(readFileSync(filename), before);
    const missing = path.join(directory, 'missing.db');
    assert.throws(() => readCoverage(missing, asOf));
    assert.equal(existsSync(missing), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});