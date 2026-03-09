import type { HistoricalBarsResult, HistoricalInterval, HistoricalRange } from './types';

export interface MarketDataProvider {
  fetchHistoricalBars(symbol: string, range: HistoricalRange, interval: HistoricalInterval): Promise<HistoricalBarsResult>;
}