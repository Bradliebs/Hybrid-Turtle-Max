export const supportedHistoricalRanges = ['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'] as const;
export const supportedHistoricalIntervals = ['1d', '1wk', '1mo'] as const;

export type HistoricalRange = (typeof supportedHistoricalRanges)[number];
export type HistoricalInterval = (typeof supportedHistoricalIntervals)[number];

export interface HistoricalBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose: number | null;
  source: string;
  fetchedAt: Date;
}

export interface HistoricalBarsResult {
  symbol: string;
  bars: HistoricalBar[];
  fetchedAt: Date;
  meta: Record<string, unknown>;
  events: Record<string, unknown> | null;
}

export interface RefreshUniverseOptions {
  symbols?: string[];
  range?: HistoricalRange;
  interval?: HistoricalInterval;
  force?: boolean;
}

export interface SymbolRefreshResult {
  symbol: string;
  status: 'SUCCEEDED' | 'FAILED';
  barsFetched: number;
  lastBarDate: Date | null;
  staleAfterRun: boolean;
  retriesUsed: number;
  errorMessage?: string;
}

export interface RefreshUniverseResult {
  runId: string;
  requestedSymbols: number;
  succeededSymbols: number;
  failedSymbols: number;
  staleSymbols: number;
  results: SymbolRefreshResult[];
}