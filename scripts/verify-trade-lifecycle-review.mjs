import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readBaseline } from './trade-performance-baseline.mjs';
import { toYahooTicker } from '../src/lib/ticker-maps.ts';

const [databasePath, reportPath] = process.argv.slice(2);
assert.ok(databasePath && reportPath,
  'Usage: node scripts/verify-trade-lifecycle-review.mjs <sqlite-path> <report-path>');
const text = fs.readFileSync(reportPath, 'utf8');
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
let checked = 0;
let gaps = 0;
let coverageRows = 0;
try {
  database.pragma('query_only = ON');
  assert.equal(database.readonly, true);
  assert.equal(database.pragma('query_only', { simple: true }), 1);
  database.transaction(() => {
    const imported = database.prepare(`SELECT entryPrice,initialRisk,notes FROM Position
      WHERE userId=? AND source=?`).all('default-user', 'trading212');
    assert.equal(imported.length, 15);
    assert.equal(imported.filter(position => /default|5%/i.test(position.notes ?? '')).length, 8);
    assert.ok(imported.every(position => Math.abs(position.initialRisk / position.entryPrice - 0.05) < 1e-9));
    for (const line of text.split('\n')) {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
      if (!/^[A-Z][A-Z.]*$/.test(cells[0] ?? '') || !/^2026-/.test(cells[1] ?? '')) continue;
      const positions = database.prepare(`SELECT p.*,s.ticker FROM Position p
        JOIN Stock s ON s.id=p.stockId WHERE s.ticker=? AND p.userId=?`)
        .all(cells[0], 'default-user')
        .filter(position => new Date(position.entryDate).toISOString().slice(0, 10) === cells[1]);
      assert.equal(positions.length, 1, `${cells[0]} ambiguous report row`);
      const position = positions[0];
      assert.equal(position.status, 'CLOSED');
      assert.equal(new Date(position.exitDate).toISOString().slice(0, 10), cells[2]);
      const near = (actual, expected, tolerance, label) => {
        assert.ok(Number.isFinite(actual) && Number.isFinite(expected)
          && Math.abs(actual - expected) < tolerance, `${position.ticker} ${label}`);
      };
      near((position.exitDate - position.entryDate) / 86400000, Number(cells[3]), 0.0051, 'days');
      near(position.realisedPnlR, Number(cells[4]), 0.000051, 'stored R');
      const stops = database.prepare(`SELECT reason FROM StopHistory
        WHERE positionId=? AND createdAt BETWEEN ? AND ?`)
        .all(position.id, position.entryDate, position.exitDate);
      const highs = stops.map(stop => /^Trailing ATR stop: High ([0-9.]+)/.exec(stop.reason))
        .filter(Boolean).map(match => Number(match[1]));
      if (highs.length) {
        near((Math.max(...highs) - position.entryPrice) / (position.initial_R ?? position.initialRisk),
          Number(cells[5]), 0.00051, 'logged close reference');
      } else {
        assert.equal(cells[5], 'unknown');
      }
      if (cells.length === 8) {
        assert.equal(position.source, 'auto-trade');
        const entries = database.prepare(`SELECT plannedEntry,actualFill,initialStop FROM TradeLog
          WHERE positionId=? AND userId=? AND tradeType=?`)
          .all(position.id, position.userId, 'ENTRY');
        assert.equal(entries.length, 1);
        const entry = entries[0];
        assert.ok(entry.plannedEntry > entry.initialStop);
        near((entry.actualFill - entry.plannedEntry) / (entry.plannedEntry - entry.initialStop),
          Number(cells[6]), 0.000051, 'planned-risk entry gap');
        gaps++;
      } else {
        assert.equal(position.source, 'trading212');
      }
      checked++;
    }
    const exitBars = database.prepare(`SELECT b.open,b.high,b.low,b.close,b.adjustedClose,i.currency
      FROM DailyBar b JOIN Instrument i ON i.id=b.instrumentId
      WHERE i.symbol=? AND b.date>=? AND b.date<?`)
      .all('SCHW', Date.parse('2026-08-26T00:00:00Z'), Date.parse('2026-08-27T00:00:00Z'));
    assert.equal(exitBars.length, 1);
    const exitBar = exitBars[0];
    assert.equal(exitBar.currency, 'USD');
    for (const [field, value] of Object.entries({ open: 108.25, high: 110.32, low: 106.34, close: 109.39 })) {
      assert.ok(Math.abs(exitBar[field] - value) < 0.005, `SCHW ${field}`);
    }
    assert.equal(exitBar.adjustedClose, exitBar.close);
    for (const line of text.split('\n')) {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.length !== 4 || !/^[A-Z][A-Z.]*$/.test(cells[0] ?? '')) continue;
      const positions = database.prepare(`SELECT p.*,s.ticker,s.yahooTicker FROM Position p
        JOIN Stock s ON s.id=p.stockId WHERE s.ticker=? AND p.userId=?
        AND p.source=? AND p.status=? AND p.realisedPnlR IS NOT NULL`)
        .all(cells[0], 'default-user', 'auto-trade', 'CLOSED');
      assert.equal(positions.length, 1);
      const position = positions[0];
      const symbol = toYahooTicker(position.ticker, position.yahooTicker);
      assert.equal(symbol, cells[1]);
      const bars = database.prepare(`SELECT b.date,b.close FROM DailyBar b
        JOIN Instrument i ON i.id=b.instrumentId WHERE i.symbol=? AND b.date>=? AND b.date<?`)
        .all(symbol, (Math.floor(position.entryDate / 86400000) + 1) * 86400000,
          Math.floor(position.exitDate / 86400000) * 86400000);
      assert.equal(bars.length, Number(cells[2]));
      assert.equal(new Set(bars.map(bar => new Date(bar.date).toISOString().slice(0, 10))).size, bars.length);
      if (bars.length) {
        const observedR = (Math.max(...bars.map(bar => bar.close)) - position.entryPrice)
          / (position.initial_R ?? position.initialRisk);
        assert.ok(Math.abs(observedR - Number(cells[3])) < 0.00051, `${symbol} cached close R`);
      } else {
        assert.equal(cells[3], 'unknown');
      }
      coverageRows++;
    }
  })();
} finally {
  database.close();
}
assert.equal(checked, 25);
assert.equal(gaps, 11);
assert.equal(coverageRows, 11);
for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
  assert.ok(fs.existsSync(path.resolve(path.dirname(reportPath), match[1])), match[1]);
}
const baseline = readBaseline(databasePath, '1970-01-01T00:00:00.000Z', new Date().toISOString());
assert.equal(baseline.allHistoryPositions.measured, 25);
assert.ok(Math.abs(baseline.allHistoryPositions.totalStoredR + 3.6911969242) < 1e-9);
console.log(`Verified ${checked} trade rows, holding times, stored R, logged references,
${gaps} entry gaps, ${coverageRows} cached-coverage rows, SCHW exit-session prices,
baseline total and report links. Source database opened read-only.`);