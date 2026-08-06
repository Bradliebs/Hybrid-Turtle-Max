import { pathToFileURL } from 'node:url';
import { refreshUniverseDailyBars } from '../packages/data/src';
import {
  getActiveUniverseSymbolsBelowBarCount,
  syncActiveStockInstruments,
} from '../packages/data/src/repository';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_FAILURE_RATE = 0.2;
const MINIMUM_DAILY_BARS = 60;

export interface RefreshCliOptions {
  syncStockUniverse: boolean;
  runAll: boolean;
  batchSize: number;
  maxBatches: number;
  maxFailureRate: number;
}

function numericArgument(args: string[], name: string, fallback: number): number {
  const raw = args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (raw == null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

export function parseRefreshArgs(args: string[]): RefreshCliOptions {
  const runAll = args.includes('--all');
  const batchSize = numericArgument(args, '--batch-size', DEFAULT_BATCH_SIZE);
  const maxBatches = runAll
    ? Number.POSITIVE_INFINITY
    : numericArgument(args, '--max-batches', 1);
  const maxFailureRate = numericArgument(args, '--max-failure-rate', DEFAULT_MAX_FAILURE_RATE);
  if (!Number.isInteger(batchSize) || (!runAll && !Number.isInteger(maxBatches))) {
    throw new Error('--batch-size and --max-batches must be integers');
  }
  if (maxFailureRate > 1) {
    throw new Error('--max-failure-rate must be at most 1');
  }
  return {
    syncStockUniverse: args.includes('--sync-stock-universe'),
    runAll,
    batchSize,
    maxBatches,
    maxFailureRate,
  };
}

export function chunkSymbols(symbols: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < symbols.length; index += batchSize) {
    batches.push(symbols.slice(index, index + batchSize));
  }
  return batches;
}

async function main() {
  const options = parseRefreshArgs(process.argv.slice(2));
  const createdInstruments = options.syncStockUniverse
    ? await syncActiveStockInstruments()
    : 0;
  const backlog = await getActiveUniverseSymbolsBelowBarCount(MINIMUM_DAILY_BARS);
  const batches = chunkSymbols(backlog, options.batchSize).slice(0, options.maxBatches);

  console.log(JSON.stringify({
    createdInstruments,
    backlog: backlog.length,
    plannedBatches: batches.length,
    batchSize: options.batchSize,
    runAll: options.runAll,
  }));

  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const result = await refreshUniverseDailyBars({
      symbols: batches[index],
      range: '1y',
      interval: '1d',
      force: true,
      minimumBars: MINIMUM_DAILY_BARS,
    });
    succeeded += result.succeededSymbols;
    failed += result.failedSymbols;
    const failureRate = result.requestedSymbols > 0
      ? result.failedSymbols / result.requestedSymbols
      : 0;
    console.log(JSON.stringify({
      batch: index + 1,
      requested: result.requestedSymbols,
      succeeded: result.succeededSymbols,
      failed: result.failedSymbols,
      remaining: Math.max(0, backlog.length - (index + 1) * options.batchSize),
      runId: result.runId,
    }));
    if (failureRate > options.maxFailureRate) {
      throw new Error(`Backfill halted: batch failure rate ${(failureRate * 100).toFixed(1)}% exceeded ${(options.maxFailureRate * 100).toFixed(1)}%`);
    }
  }

  const remaining = await getActiveUniverseSymbolsBelowBarCount(MINIMUM_DAILY_BARS);
  console.log(JSON.stringify({ succeeded, failed, remaining: remaining.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Daily bars refresh failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}