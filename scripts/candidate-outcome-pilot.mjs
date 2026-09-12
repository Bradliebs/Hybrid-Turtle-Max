import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { toYahooTicker } from '../src/lib/ticker-maps.ts';

export const PILOT = {
  version: '2026-09-10-v2-constant-factor',
  asOf: '2026-09-10T00:00:00Z',
  months: ['2026-05', '2026-06'],
  holdoutStart: '2026-08-03',
  symbols: [
    { ticker: 'AA', symbol: 'AA', market: 'US' },
    { ticker: 'AAPL', symbol: 'AAPL', market: 'US' },
    { ticker: 'ABBV', symbol: 'ABBV', market: 'US' },
    { ticker: 'AAL.L', symbol: 'AAL.L', market: 'UK' },
    { ticker: 'AIAI', symbol: 'AIAI.L', market: 'UK' },
    { ticker: 'AD.AS', symbol: 'AD.AS', market: 'AMS' },
    { ticker: 'ASML', symbol: 'ASML.AS', market: 'AMS' },
  ],
  calendars: {
    US: { holidays: ['2026-05-25', '2026-06-19', '2026-07-03'], safeAfterUTC: '20:15', exchanges: ['NYQ', 'NMS'] },
    UK: { holidays: ['2026-05-04', '2026-05-25'], safeAfterUTC: '16:00', exchanges: ['LSE'] },
    AMS: { holidays: ['2026-05-01'], safeAfterUTC: '16:00', exchanges: ['AMS'] },
  },
  calendarSources: [
    'https://www.nyse.com/markets/hours-calendars',
    'https://www.londonstockexchange.com/equities-trading/business-days',
    'https://www.gov.uk/bank-holidays',
    'https://www.euronext.com/en/trade/trading-hours-holidays',
  ],
};

const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(value) && value > 0;
const dateKey = value => finite(value) ? new Date(value).toISOString().slice(0, 10) : null;
const samePrice = (left, right) => Math.abs(left - right) <= Math.max(left, right) * 1e-6;

export function reconstructWindow(candidate, bars, sessions, cutoff) {
  if (!finite(cutoff)) throw new Error('A finite evidence cutoff is required');
  const anchor = sessions.filter(session => session.day <= dateKey(candidate.scanDate)).at(-1);
  const forward = sessions.filter(session => session.day > dateKey(candidate.scanDate));
  const common = [];
  if (!finite(candidate.scanDate) || candidate.scanDate > cutoff) common.push('INVALID_SCAN_DATE');
  if (!positive(candidate.price)) common.push('INVALID_SCAN_PRICE');
  if (!anchor) common.push('MISSING_ANCHOR_SESSION');
  else if (candidate.scanDate < anchor.closeAt) common.push('SCAN_BEFORE_POST_CLOSE_CUTOFF');
  const inspect = session => {
    const matches = bars.filter(bar => dateKey(bar.date) === session.day);
    if (matches.length !== 1) return { reason: matches.length ? 'DUPLICATE_SESSION' : 'MISSING_SESSION' };
    const bar = matches[0];
    if (bar.source !== 'YAHOO') return { reason: 'UNSUPPORTED_SOURCE' };
    if (!finite(bar.fetchedAt) || bar.fetchedAt > cutoff) return { reason: 'UNOBSERVED_AT_CUTOFF' };
    if (bar.fetchedAt < Date.parse(`${session.day}T00:00:00Z`) + 86400000) {
      return { reason: 'POSSIBLY_UNFINISHED_BAR' };
    }
    if (![bar.open, bar.high, bar.low, bar.close].every(positive)
      || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)
      || bar.low > bar.high) return { reason: 'INVALID_OHLC' };
    if (!positive(bar.adjustedClose)) {
      return { reason: 'ADJUSTMENT_BASIS_UNRESOLVED' };
    }
    return { bar };
  };
  const anchorEvidence = anchor ? inspect(anchor) : null;
  if (anchorEvidence?.reason) common.push(`ANCHOR_${anchorEvidence.reason}`);
  if (anchorEvidence?.bar && positive(candidate.price) && !samePrice(candidate.price, anchorEvidence.bar.close)) {
    common.push('SCAN_BASELINE_MISMATCH');
  }
  const horizons = [5, 10, 20].map(horizon => {
    const expected = forward.slice(0, horizon);
    const reasons = [...common];
    if (expected.length < horizon) reasons.push('CALENDAR_WINDOW_INCOMPLETE');
    const evidence = expected.map(session => ({ session: session.day, ...inspect(session) }));
    for (const item of evidence) if (item.reason) reasons.push(`${item.reason}:${item.session}`);
    const anchorFactor = anchorEvidence?.bar
      ? anchorEvidence.bar.adjustedClose / anchorEvidence.bar.close : null;
    if (positive(anchorFactor) && evidence.some(item => item.bar
      && !samePrice(item.bar.adjustedClose / item.bar.close, anchorFactor))) {
      reasons.push('ADJUSTMENT_FACTOR_CHANGED');
    }
    const endpoint = expected.at(-1)?.day;
    const unexpected = bars.filter(bar => {
      const day = dateKey(bar.date);
      return day > anchor?.day && day <= endpoint && !expected.some(session => session.day === day);
    });
    if (unexpected.length) reasons.push('NON_SESSION_BAR');
    const accepted = reasons.length === 0;
    const close = accepted ? evidence.at(-1).bar.close : null;
    const reconstructed = accepted ? (close / candidate.price - 1) * 100 : null;
    const stored = candidate[`fwdReturn${horizon}d`];
    const storedObserved = finite(candidate.enrichedAt) && candidate.enrichedAt <= cutoff && finite(stored);
    return {
      horizon, status: accepted ? 'ACCEPTED_CONDITIONAL' : 'REJECTED', reasons,
      anchorAdjustmentFactor: anchorFactor,
      endpoint: endpoint ?? null, close, reconstructed,
      stored: storedObserved ? stored : null,
      differencePercentagePoints: accepted && storedObserved ? reconstructed - stored : null,
      evidence,
    };
  });
  return {
    candidate, anchor: anchor ? { ...anchor, ...anchorEvidence } : null, horizons,
    sourceFingerprint: createHash('sha256').update(JSON.stringify({ candidate, bars, sessions, cutoff })).digest('hex'),
  };
}

export function pilotSessions(market) {
  const calendar = PILOT.calendars[market];
  if (!calendar) throw new Error('Unsupported pilot market');
  const sessions = [];
  for (let timestamp = Date.parse('2026-05-01'); timestamp < Date.parse('2026-08-01'); timestamp += 86400000) {
    const day = dateKey(timestamp);
    const weekday = new Date(timestamp).getUTCDay();
    if (weekday === 0 || weekday === 6 || calendar.holidays.includes(day)) continue;
    sessions.push({ day, closeAt: Date.parse(`${day}T${calendar.safeAfterUTC}:00Z`) });
  }
  return sessions;
}

export function validateIdentity(sample, stocks, instruments) {
  if (stocks.length !== 1) return ['MISSING_OR_AMBIGUOUS_STOCK'];
  if (toYahooTicker(stocks[0].ticker, stocks[0].yahooTicker) !== sample.symbol) return ['SYMBOL_MAPPING_CONFLICT'];
  if (instruments.length !== 1) return ['MISSING_OR_AMBIGUOUS_INSTRUMENT'];
  const instrument = instruments[0];
  const reasons = [];
  if (instrument.symbol !== sample.symbol) reasons.push('INSTRUMENT_SYMBOL_CONFLICT');
  if (!PILOT.calendars[sample.market].exchanges.includes(instrument.exchange)) reasons.push('EXCHANGE_CONFLICT');
  const unit = value => value === 'GBp' ? 'GBX' : value;
  const stockUnit = unit(stocks[0].currency);
  if (!['USD', 'EUR', 'GBP', 'GBX'].includes(stockUnit) || stockUnit !== unit(instrument.currency)) {
    reasons.push('CURRENCY_UNIT_CONFLICT');
  }
  if (instrument.dataSource !== 'YAHOO') reasons.push('INSTRUMENT_SOURCE_CONFLICT');
  return reasons;
}

export function readPilot(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    return database.transaction(() => {
      const cutoff = Date.parse(PILOT.asOf);
      const rows = [];
      const emptySlots = [];
      for (const sample of PILOT.symbols) {
        const stocks = database.prepare('SELECT id,ticker,yahooTicker,currency,region FROM Stock WHERE ticker = ?').all(sample.ticker);
        const instruments = database.prepare('SELECT id,symbol,exchange,currency,dataSource FROM Instrument WHERE symbol = ?').all(sample.symbol);
        const identityReasons = validateIdentity(sample, stocks, instruments);
        const candidates = database.prepare(`SELECT id,scanId,ticker,scanDate,price,enrichedAt,
          fwdReturn5d,fwdReturn10d,fwdReturn20d FROM CandidateOutcome
          WHERE ticker = ? AND scanDate >= ? AND scanDate < ? ORDER BY scanDate,id`)
          .all(sample.ticker, Date.parse('2026-05-01'), Date.parse('2026-07-01'));
        const state = candidate => !finite(candidate.enrichedAt) || candidate.enrichedAt > cutoff
          ? 'UNENRICHED' : finite(candidate.fwdReturn20d) ? 'COMPLETE20' : 'PARTIAL';
        for (const month of PILOT.months) {
          for (const group of ['UNENRICHED', 'PARTIAL', 'COMPLETE20']) {
            const candidate = candidates.find(item => dateKey(item.scanDate).startsWith(month) && state(item) === group);
            const slot = { ...sample, month, group };
            if (!candidate) { emptySlots.push(slot); continue; }
            const sessions = pilotSessions(sample.market);
            const anchorDay = sessions.filter(session => session.day <= dateKey(candidate.scanDate)).at(-1)?.day;
            const endpoint = sessions.filter(session => session.day > dateKey(candidate.scanDate))[19]?.day;
            const sourceBars = instruments.length === 1 && anchorDay && endpoint
              ? database.prepare(`SELECT id,date,open,high,low,close,adjustedClose,source,fetchedAt
                FROM DailyBar WHERE instrumentId = ? AND date >= ? AND date < ? ORDER BY date,source,id`)
                .all(instruments[0].id, Date.parse(anchorDay), Date.parse(endpoint) + 86400000) : [];
            const result = reconstructWindow(candidate, sourceBars, sessions, cutoff);
            for (const horizon of result.horizons) {
              if (!identityReasons.length) continue;
              horizon.reasons.unshift(...identityReasons);
              horizon.status = 'REJECTED';
              horizon.close = null;
              horizon.reconstructed = null;
              horizon.differencePercentagePoints = null;
            }
            rows.push({ slot, stocks, instruments, identityReasons, sourceBars, ...result });
          }
        }
      }
      const accepted = horizon => horizon.status === 'ACCEPTED_CONDITIONAL';
      const summary = {
        selectedRows: rows.length, emptySlots: emptySlots.length,
        acceptedAllHorizons: rows.filter(row => row.horizons.every(accepted)).length,
        acceptedSomeHorizons: rows.filter(row => row.horizons.some(accepted)).length,
        rejectedAllHorizons: rows.filter(row => !row.horizons.some(accepted)).length,
        horizons: [5, 10, 20].map(horizon => {
          const items = rows.map(row => row.horizons.find(item => item.horizon === horizon));
          const differences = items.map(item => item.differencePercentagePoints).filter(finite);
          return { horizon, accepted: items.filter(accepted).length, compared: differences.length,
            different: differences.filter(value => Math.abs(value) > 1e-6).length,
            maxAbsoluteDifferencePercentagePoints: differences.length ? Math.max(...differences.map(Math.abs)) : null };
        }),
      };
      const evidence = { manifest: PILOT, rows, emptySlots };
      return { ...evidence, summary,
        sourceFingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
        implementationFingerprint: createHash('sha256').update(readFileSync(new URL(import.meta.url)))
          .update(readFileSync(new URL('../src/lib/ticker-maps.ts', import.meta.url))).digest('hex'),
      };
    })();
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [databasePath, outputPath] = process.argv.slice(2);
  if (!databasePath) throw new Error('Usage: node scripts/candidate-outcome-pilot.mjs <database> [new-report.json]');
  const report = readPilot(databasePath);
  if (outputPath) {
    if (path.extname(outputPath) !== '.json') throw new Error('Evidence output must be a new JSON file');
    writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ summary: report.summary, sourceFingerprint: report.sourceFingerprint,
    implementationFingerprint: report.implementationFingerprint }, null, 2));
}