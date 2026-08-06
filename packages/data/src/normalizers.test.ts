/**
 * DEPENDENCIES
 * Consumed by: Vitest Phase 13 CI suite
 * Consumes: normalizers.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Covers market-data normalization behaviour required by the build-order Phase 13 contract.
 */
import { describe, expect, it } from 'vitest';
import { normalizeYahooBar } from './normalizers';

describe('normalizeYahooBar', () => {
  it('returns a normalized historical bar when Yahoo payload fields are complete', () => {
    const fetchedAt = new Date('2026-03-09T22:00:00.000Z');
    const result = normalizeYahooBar(
      {
        date: new Date('2026-03-08T00:00:00.000Z'),
        open: 101.25,
        high: 104.5,
        low: 99.8,
        close: 103.75,
        volume: 1_250_000,
        adjclose: 103.1,
      },
      fetchedAt,
    );

    expect(result).toEqual({
      date: new Date('2026-03-08T00:00:00.000Z'),
      open: 101.25,
      high: 104.5,
      low: 99.8,
      close: 103.75,
      volume: 1_250_000,
      adjustedClose: 103.1,
      source: 'YAHOO',
      fetchedAt,
    });
  });

  it('rejects malformed Yahoo rows with null price fields', () => {
    const fetchedAt = new Date('2026-03-09T22:00:00.000Z');

    expect(
      normalizeYahooBar(
        {
          date: new Date('2026-03-08T00:00:00.000Z'),
          open: 101.25,
          high: null,
          low: 99.8,
          close: 103.75,
          volume: 1_250_000,
        },
        fetchedAt,
      ),
    ).toBeNull();
  });

  it('expands inconsistent Yahoo high-low values to contain open and close', () => {
    const result = normalizeYahooBar(
      {
        date: new Date('2026-03-08T00:00:00.000Z'),
        open: 30.48,
        high: 30.54,
        low: 30.39,
        close: 30.575,
        volume: 10_000,
      },
      new Date('2026-03-09T22:00:00.000Z'),
    );

    expect(result?.high).toBe(30.575);
    expect(result?.low).toBe(30.39);
  });
});