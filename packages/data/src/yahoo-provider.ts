import YahooFinance from 'yahoo-finance2';
import { normalizeYahooBar } from './normalizers';
import type { MarketDataProvider } from './provider';
import type { HistoricalBarsResult, HistoricalInterval, HistoricalRange } from './types';

const yahooFinance = new YahooFinance();

function resolvePeriod1(range: HistoricalRange): Date {
  const now = new Date();
  const period1 = new Date(now);

  switch (range) {
    case '1mo':
      period1.setMonth(period1.getMonth() - 1);
      return period1;
    case '3mo':
      period1.setMonth(period1.getMonth() - 3);
      return period1;
    case '6mo':
      period1.setMonth(period1.getMonth() - 6);
      return period1;
    case '1y':
      period1.setFullYear(period1.getFullYear() - 1);
      return period1;
    case '2y':
      period1.setFullYear(period1.getFullYear() - 2);
      return period1;
    case '5y':
      period1.setFullYear(period1.getFullYear() - 5);
      return period1;
    case '10y':
      period1.setFullYear(period1.getFullYear() - 10);
      return period1;
    case 'ytd':
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case 'max':
      return new Date('1970-01-01T00:00:00.000Z');
  }
}

export class YahooMarketDataProvider implements MarketDataProvider {
  async fetchHistoricalBars(symbol: string, range: HistoricalRange, interval: HistoricalInterval): Promise<HistoricalBarsResult> {
    const fetchedAt = new Date();
    const response = await yahooFinance.chart(symbol, {
      period1: resolvePeriod1(range),
      interval,
      events: 'div|split',
      includePrePost: false,
      return: 'array',
    });

    const bars = response.quotes
      .map((quote) => normalizeYahooBar(quote, fetchedAt))
      .filter((bar): bar is NonNullable<typeof bar> => bar !== null);

    return {
      symbol,
      bars,
      fetchedAt,
      meta: response.meta as Record<string, unknown>,
      events: (response.events as Record<string, unknown> | undefined) ?? null,
    };
  }
}