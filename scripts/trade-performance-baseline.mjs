import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

export function timestamp(value) {
  if (value == null || value === '') return null;
  const milliseconds = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid evidence timestamp');
  return milliseconds;
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => values.length ? sum(values) / values.length : null;

export function summarizePositions(positions, trades, from, asOf) {
  const start = timestamp(from);
  const end = timestamp(asOf);
  if (start == null || end == null || start > end) throw new Error('Invalid reporting interval');
  const cohort = positions.filter(position => {
    const entered = timestamp(position.entryDate);
    return entered != null && entered >= start && entered <= end;
  });
  const availableTrades = trades.filter(trade => {
    const recorded = timestamp(trade.tradeDate);
    return recorded != null && recorded <= end;
  });
  const closed = cohort.filter(position => position.status === 'CLOSED'
    && timestamp(position.exitDate) != null && timestamp(position.exitDate) <= end);
  const measured = closed.filter(position => finite(position.realisedPnlR)
    && finite(position.entryPrice) && position.entryPrice > 0
    && finite(position.exitPrice) && position.exitPrice > 0
    && finite(position.initial_R ?? position.initialRisk)
    && (position.initial_R ?? position.initialRisk) > 0
    && timestamp(position.exitDate) >= timestamp(position.entryDate));
  const values = measured.map(position => position.realisedPnlR);
  const wins = values.filter(value => value > 0);
  const losses = values.filter(value => value < 0);
  const heldDays = measured.map(position =>
    (timestamp(position.exitDate) - timestamp(position.entryDate)) / 86400000).sort((left, right) => left - right);
  const reconciliation = measured.map(position => {
    const exits = availableTrades.filter(trade => trade.positionId === position.id
      && ['EXIT', 'STOP_HIT'].includes(trade.tradeType));
    const exit = exits.length === 1 ? exits[0] : null;
    const linkedBrokerPnl = exit?.t212OrderId != null && finite(exit.realisedPnlT212)
      ? exit.realisedPnlT212 : null;
    const recomputedR = (position.exitPrice - position.entryPrice) / (position.initial_R ?? position.initialRisk);
    return {
      ticker: position.ticker, source: position.source, accountType: position.accountType,
      entryDate: new Date(timestamp(position.entryDate)).toISOString(),
      exitDate: new Date(timestamp(position.exitDate)).toISOString(),
      storedR: position.realisedPnlR, recomputedR,
      rMatches: Math.abs(position.realisedPnlR - recomputedR) <= 1e-8,
      storedGbp: position.realisedPnlGbp, linkedExitLogs: exits.length, linkedBrokerPnl,
      gbpMatches: linkedBrokerPnl == null || !finite(position.realisedPnlGbp) ? null
        : Math.abs(linkedBrokerPnl - position.realisedPnlGbp) <= 0.01,
      exitFillDate: exit?.fillTimestamp == null ? null : new Date(timestamp(exit.fillTimestamp)).toISOString(),
      quantityMatches: exit == null || !finite(exit.fillQuantity) || !finite(position.shares) ? null
        : Math.abs(Math.abs(exit.fillQuantity) - position.shares) <= 1e-8,
    };
  });
  const distinctEntryDays = new Set(measured.map(position =>
    new Date(timestamp(position.entryDate)).toISOString().slice(0, 10))).size;
  const reconciliationQueue = closed.flatMap(position => {
    const exits = availableTrades.filter(trade => trade.positionId === position.id
      && ['EXIT', 'STOP_HIT'].includes(trade.tradeType));
    const exit = exits.length === 1 ? exits[0] : null;
    const reasons = [];
    if (!measured.includes(position)) reasons.push('MISSING_OR_INVALID_OUTCOME');
    if (!finite(position.realisedPnlGbp)) reasons.push('MISSING_GBP_OUTCOME');
    if (exits.length === 0) reasons.push('NO_LINKED_EXIT');
    if (exits.length > 1) reasons.push('MULTIPLE_LINKED_EXITS');
    if (exit) {
      if (!exit.t212OrderId || exit.fillTimestamp == null || !finite(exit.fillPrice)
        || exit.fillPrice <= 0 || !finite(exit.realisedPnlT212)) reasons.push('INCOMPLETE_BROKER_EXIT');
      if (!finite(exit.fillQuantity) || !finite(position.shares)
        || position.shares <= 0 || Math.abs(exit.fillQuantity) <= 0) reasons.push('INVALID_QUANTITY');
      else if (Math.abs(Math.abs(exit.fillQuantity) - position.shares) > 1e-8) reasons.push('EXIT_QUANTITY_MISMATCH');
      if (exit.fillTimestamp != null && (timestamp(exit.fillTimestamp) < timestamp(position.entryDate)
        || timestamp(exit.fillTimestamp) > timestamp(position.exitDate))) reasons.push('FILL_OUTSIDE_HOLDING_WINDOW');
      if (finite(exit.realisedPnlT212) && finite(position.realisedPnlGbp)
        && Math.abs(exit.realisedPnlT212 - position.realisedPnlGbp) > 0.01) reasons.push('GBP_MISMATCH');
    }
    if (measured.includes(position) && Math.abs(position.realisedPnlR
      - (position.exitPrice - position.entryPrice) / (position.initial_R ?? position.initialRisk)) > 1e-8) reasons.push('R_MISMATCH');
    return reasons.length ? [{
      positionId: position.id, ticker: position.ticker, accountType: position.accountType,
      source: position.source, entryDate: new Date(timestamp(position.entryDate)).toISOString(),
      recordedClosureDate: new Date(timestamp(position.exitDate)).toISOString(),
      positionQuantity: position.shares, linkedExitCount: exits.length,
      linkedExitQuantity: finite(exit?.fillQuantity) ? Math.abs(exit.fillQuantity) : null,
      reasons, action: 'REVIEW_ACCOUNT_SCOPED_FILL_HISTORY', repairAuthorized: false,
    }] : [];
  });
  return {
    positionCount: cohort.length,
    open: cohort.filter(position => position.status === 'OPEN').length,
    closed: closed.length,
    unclassifiedAtCutoff: cohort.length - closed.length - cohort.filter(position => position.status === 'OPEN').length,
    measured: measured.length,
    excludedClosed: closed.filter(position => !measured.includes(position)).map(position => ({
      ticker: position.ticker, source: position.source, exitReason: position.exitReason,
      hasExitPrice: finite(position.exitPrice), hasR: finite(position.realisedPnlR), hasGbp: finite(position.realisedPnlGbp),
    })),
    distinctEntryDays,
    totalStoredR: sum(values), expectancyStoredR: mean(values),
    wins: wins.length, losses: losses.length, flat: values.filter(value => value === 0).length,
    winRate: values.length ? wins.length / values.length : null,
    averageWinR: mean(wins), averageLossR: mean(losses),
    profitFactorR: losses.length ? sum(wins) / Math.abs(sum(losses)) : null,
    averageHoldDays: mean(heldDays),
    medianHoldDays: heldDays.length ? (heldDays[Math.floor((heldDays.length - 1) / 2)] + heldDays[Math.floor(heldDays.length / 2)]) / 2 : null,
    storedGbpCount: measured.filter(position => finite(position.realisedPnlGbp)).length,
    storedGbpSubtotal: sum(measured.map(position => position.realisedPnlGbp).filter(finite)),
    evidence: 'DESCRIPTIVE_ONLY_NOT_VERIFIED_NET_ACCOUNT_PERFORMANCE',
    sampleGate: distinctEntryDays < 30 ? 'INSUFFICIENT_ENTRY_DAYS' : 'REQUIRES_PROVENANCE_AND_DEPENDENCE_REVIEW',
    reconciliation,
    reconciliationQueue,
  };
}

export function readBaseline(databasePath, from, asOf) {
  const start = timestamp(from), end = timestamp(asOf);
  if (start == null || end == null || start > end) throw new Error('Invalid reporting interval');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    assert.equal(database.readonly, true);
    assert.equal(database.pragma('query_only', { simple: true }), 1);
    return database.transaction(() => {
      const positions = database.prepare(`SELECT p.id,p.userId,p.status,p.source,p.accountType,
        p.entryPrice,p.exitPrice,p.entryDate,p.exitDate,p.initialRisk,p.initial_R,p.shares,
        p.realisedPnlR,p.realisedPnlGbp,p.exitReason,s.ticker,s.currency
        FROM Position p JOIN Stock s ON s.id=p.stockId ORDER BY p.entryDate,p.id`).all();
      const trades = database.prepare(`SELECT id,positionId,tradeDate,tradeType,decision,t212OrderId,
        fillTimestamp,fillQuantity,fillPrice,fxRateAtFill,netValueGbp,realisedPnlT212,
        importedFromT212,plannedEntry,actualFill,slippagePct,fillTime,rankScore,ncsScore,regime
        FROM TradeLog ORDER BY tradeDate,id`).all();
      const grouping = new Map();
      for (const position of positions) {
        const key = JSON.stringify([position.userId, position.accountType, position.source]);
        const rows = grouping.get(key) ?? [];
        rows.push(position);
        grouping.set(key, rows);
      }
      const scopedTrades = trades.filter(trade => timestamp(trade.tradeDate) >= start && timestamp(trade.tradeDate) <= end);
      const coverage = Object.fromEntries(['t212OrderId','positionId','fillPrice','fillTimestamp','fxRateAtFill',
        'netValueGbp','realisedPnlT212','plannedEntry','actualFill','slippagePct','fillTime','rankScore','ncsScore','regime']
        .map(field => [field, scopedTrades.filter(trade => trade[field] != null).length]));
      const candidates = database.prepare(`SELECT COUNT(*) AS rows,MIN(scanDate) AS first,MAX(scanDate) AS last,
        COUNT(DISTINCT date(scanDate/1000,'unixepoch')) AS scanDays,
        SUM(enrichedAt IS NOT NULL) AS enriched,SUM(fwdReturn20d IS NOT NULL) AS forward20d,
        SUM(tradePlaced=1) AS placed,SUM(tradeLogId IS NOT NULL) AS linked
        FROM CandidateOutcome WHERE scanDate BETWEEN ? AND ?`).get(start,end);
      const equity = database.prepare(`SELECT COUNT(*) AS rows,MIN(capturedAt) AS first,MAX(capturedAt) AS last
        FROM EquitySnapshot WHERE capturedAt BETWEEN ? AND ?`).get(start,end);
      const fingerprint = createHash('sha256').update(JSON.stringify({ positions, trades, candidates, equity })).digest('hex');
      return {
        generatedAt: new Date().toISOString(), from, asOf, readOnly: true, fingerprint,
        datePolicy: 'Entry-date cohorts; current stored statuses, not historical portfolio reconstruction. Current session may be incomplete.',
        provenance: 'Environment and fees are not persisted per position. No confirmed-live or net-account claim.',
        allHistoryPositions: summarizePositions(positions,trades,'1970-01-01T00:00:00.000Z',asOf),
        periodPositions: summarizePositions(positions,trades,from,asOf),
        cohorts: [...grouping.values()].map(rows => ({accountType: rows[0].accountType, source: rows[0].source,
          ...summarizePositions(rows,trades,from,asOf)})),
        tradeLog: { allRows: trades.length, periodRows: scopedTrades.length, coverage,
          decisions: [...new Set(scopedTrades.map(trade=>trade.decision))],
          importedRows: scopedTrades.filter(trade=>trade.importedFromT212===1).length,
          duplicateOrderGroups: database.prepare(`SELECT COUNT(*) AS count FROM
            (SELECT t212OrderId FROM TradeLog WHERE t212OrderId IS NOT NULL GROUP BY t212OrderId HAVING COUNT(*)>1)`).get().count },
        candidates, equity,
      };
    })();
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [databasePath, from, asOf] = process.argv.slice(2);
  if (!databasePath || !from || !asOf) throw new Error('Usage: node scripts/trade-performance-baseline.mjs <sqlite-path> <from-ISO> <as-of-ISO>');
  console.log(JSON.stringify(readBaseline(databasePath, from, asOf), null, 2));
}