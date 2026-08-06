import { describe, expect, it } from 'vitest';
import { chunkSymbols, parseRefreshArgs } from './refresh-universe-daily-bars';

describe('refresh-universe-daily-bars CLI', () => {
  it('defaults to one bounded batch', () => {
    expect(parseRefreshArgs([])).toEqual({
      syncStockUniverse: false,
      runAll: false,
      batchSize: 25,
      maxBatches: 1,
      maxFailureRate: 0.2,
    });
  });

  it('requires --all to remove the batch limit', () => {
    const options = parseRefreshArgs([
      '--sync-stock-universe',
      '--all',
      '--batch-size=40',
      '--max-failure-rate=0.1',
    ]);

    expect(options.syncStockUniverse).toBe(true);
    expect(options.runAll).toBe(true);
    expect(options.batchSize).toBe(40);
    expect(options.maxBatches).toBe(Number.POSITIVE_INFINITY);
    expect(options.maxFailureRate).toBe(0.1);
  });

  it('chunks symbols without loss or duplication', () => {
    expect(chunkSymbols(['A', 'B', 'C', 'D', 'E'], 2)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E'],
    ]);
  });

  it('rejects unsafe numeric arguments', () => {
    expect(() => parseRefreshArgs(['--batch-size=0'])).toThrow('--batch-size must be a positive number');
    expect(() => parseRefreshArgs(['--batch-size=2.5'])).toThrow('--batch-size and --max-batches must be integers');
    expect(() => parseRefreshArgs(['--max-failure-rate=1.1'])).toThrow('--max-failure-rate must be at most 1');
  });
});