import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const day = value => new Date(value).toISOString().slice(0, 10);

export function summarizeCoverage(rows, asOf) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('Explicit valid as-of timestamp required');
  const cohort = rows.filter(row => finite(row.scanDate) && row.scanDate <= cutoff);
  const observed = row => finite(row.enrichedAt) && row.enrichedAt <= cutoff;
  const has20 = row => observed(row) && finite(row.fwdReturn20d);
  const old = row => cutoff - row.scanDate >= 42 * 86400000;
  const count = (items, predicate) => items.filter(predicate).length;
  const summarize = items => ({
    rows: items.length,
    scans: new Set(items.map(row => row.scanId)).size,
    days: new Set(items.map(row => day(row.scanDate))).size,
    tickers: new Set(items.map(row => row.ticker)).size,
    tickerDays: new Set(items.map(row => JSON.stringify([row.ticker, day(row.scanDate)]))).size,
    first: items.length ? day(Math.min(...items.map(row => row.scanDate))) : null,
    last: items.length ? day(Math.max(...items.map(row => row.scanDate))) : null,
    enriched: count(items, observed),
    forward5: count(items, row => observed(row) && finite(row.fwdReturn5d)),
    forward10: count(items, row => observed(row) && finite(row.fwdReturn10d)),
    forward20: count(items, has20),
    forward20Days: new Set(items.filter(has20).map(row => day(row.scanDate))).size,
    enrichedMissing20: count(items, row => observed(row) && !finite(row.fwdReturn20d)),
    old42Days: count(items, old),
    old42Missing20: count(items, row => old(row) && !has20(row)),
    old42NeverEnriched: count(items, row => old(row) && !observed(row)),
    recentMissing20: count(items, row => !old(row) && !has20(row)),
    scorePresent: count(items, row => finite(row.ncs)),
    invalidScanPrice: count(items, row => !finite(row.price) || row.price <= 0),
    linkedEntries: count(items, row => row.tradePlaced === 1 && row.tradeLogId != null),
  });
  const grouped = key => {
    const groups = new Map();
    for (const row of cohort) {
      const label = key(row);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right))
      .map(([label, items]) => ({ label, ...summarize(items) }));
  };
  const byTicker = grouped(row => row.ticker);
  return {
    asOf: new Date(cutoff).toISOString(),
    sourceFingerprint: createHash('sha256').update(JSON.stringify(cohort)).digest('hex'),
    excludedFutureOrInvalidScanRows: rows.length - cohort.length,
    overall: summarize(cohort),
    byMonth: grouped(row => day(row.scanDate).slice(0, 7)),
    byGrade: grouped(row => row.grade ?? 'UNMATCHED_OR_AMBIGUOUS'),
    byStatus: grouped(row => row.status),
    tickerCoverage: {
      total: byTicker.length,
      with20: count(byTicker, row => row.forward20 > 0),
      without20: count(byTicker, row => row.forward20 === 0),
      withOldMissing20: count(byTicker, row => row.old42Missing20 > 0),
      largestOldGaps: [...byTicker].sort((left, right) => right.old42Missing20 - left.old42Missing20).slice(0, 10),
    },
  };
}

export function readCoverage(databasePath, asOf) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    return database.transaction(() => {
      const rows = database.prepare(`
        WITH grades AS (
          SELECT result.scanId, stock.ticker,
            CASE WHEN count(*) = 1 THEN min(result.grade) ELSE NULL END AS grade
          FROM ScanResult result JOIN Stock stock ON stock.id = result.stockId
          GROUP BY result.scanId, stock.ticker
        )
        SELECT outcome.id, outcome.scanId, outcome.scanDate, outcome.ticker, outcome.status,
          outcome.price, outcome.ncs, outcome.enrichedAt, outcome.fwdReturn5d,
          outcome.fwdReturn10d, outcome.fwdReturn20d, outcome.tradePlaced, outcome.tradeLogId,
          grades.grade
        FROM CandidateOutcome outcome LEFT JOIN grades
          ON grades.scanId = outcome.scanId AND grades.ticker = outcome.ticker
        ORDER BY outcome.scanDate, outcome.id
      `).all();
      return summarizeCoverage(rows, asOf);
    })();
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [databasePath, asOf] = process.argv.slice(2);
  if (!databasePath || !asOf) throw new Error('Usage: node scripts/candidate-outcome-coverage.mjs <database> <as-of-ISO>');
  console.log(JSON.stringify(readCoverage(databasePath, asOf), null, 2));
}