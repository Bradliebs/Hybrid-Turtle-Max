// LEGACY DAEMON — quarantined 2026-06-16 (MEDIUM-9).
//
// `packages/data` is a parallel node-cron market-data ingestion loop that
// predates the current Windows Task Scheduler architecture. Production
// market-data refresh runs from `src/cron/nightly.ts` (pre-cache step)
// and on-demand from src/lib/market-data callers. Starting this script
// would create a second ingestion loop, doubling Yahoo/EODHD calls and
// risking rate-limit hits.
//
// To run intentionally:
//   LEGACY_PACKAGE_OPT_IN=1
if (process.env.LEGACY_PACKAGE_OPT_IN !== '1') {
  console.error(
    '[start-market-data-scheduler] Refusing to start. This is a legacy ' +
    'node-cron market-data scheduler that runs IN ADDITION TO the production ' +
    'Windows-scheduled nightly pipeline. Running both will double market-data ' +
    'fetches.\n\n' +
    'If you really intend to start it, set LEGACY_PACKAGE_OPT_IN=1 in the environment.',
  );
  process.exit(1);
}

import { registerNightlyIngestionJob } from '../packages/data/src';

const task = registerNightlyIngestionJob();

console.log('Nightly market-data scheduler started.');

process.on('SIGINT', () => {
  task.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  task.stop();
  process.exit(0);
});