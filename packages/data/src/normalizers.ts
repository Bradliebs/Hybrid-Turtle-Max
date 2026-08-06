import type { HistoricalBar } from './types';

type YahooChartQuote = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
};

export function normalizeYahooBar(rawBar: YahooChartQuote, fetchedAt: Date): HistoricalBar | null {
  if (
    rawBar.open == null ||
    rawBar.high == null ||
    rawBar.low == null ||
    rawBar.close == null ||
    rawBar.volume == null
  ) {
    return null;
  }

  return {
    date: rawBar.date,
    open: rawBar.open,
    high: Math.max(rawBar.high, rawBar.open, rawBar.close),
    low: Math.min(rawBar.low, rawBar.open, rawBar.close),
    close: rawBar.close,
    volume: rawBar.volume,
    adjustedClose: rawBar.adjclose ?? null,
    source: 'YAHOO',
    fetchedAt,
  };
}