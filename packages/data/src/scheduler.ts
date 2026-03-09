import cron from 'node-cron';
import { env } from '../../config/src/env';
import { refreshUniverseDailyBars } from './service';

export function registerNightlyIngestionJob() {
  return cron.schedule(env.MARKET_DATA_NIGHTLY_CRON, async () => {
    try {
      await refreshUniverseDailyBars({ force: true });
    } catch (error) {
      console.error('Nightly market-data refresh failed.', error);
    }
  });
}