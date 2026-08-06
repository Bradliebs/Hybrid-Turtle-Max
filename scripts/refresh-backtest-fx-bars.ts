import { pathToFileURL } from 'node:url';
import { fetchHistoricalBars, upsertDailyBarsForSymbol } from '../packages/data/src/service';

export const BACKTEST_FX_SYMBOLS = [
  'USDGBP=X',
  'EURGBP=X',
  'DKKGBP=X',
  'CHFGBP=X',
  'AUDGBP=X',
  'SEKGBP=X',
] as const;

async function main() {
  const results = [];
  for (const symbol of BACKTEST_FX_SYMBOLS) {
    const metadata = await fetchHistoricalBars(symbol, '1y', '1d');
    if (metadata.bars.length < 60) {
      throw new Error(`Yahoo returned ${metadata.bars.length} daily bars for ${symbol}; at least 60 required`);
    }
    const persisted = await upsertDailyBarsForSymbol(symbol, metadata.bars, metadata);
    results.push({ symbol, bars: persisted.barsFetched, lastBarDate: persisted.lastBarDate });
  }
  console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('FX bars refresh failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}