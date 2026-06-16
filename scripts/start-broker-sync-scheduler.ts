// LEGACY DAEMON — quarantined 2026-06-16 (MEDIUM-9).
//
// `packages/broker` is a parallel node-cron broker-sync loop that predates
// the current Windows Task Scheduler architecture. Production broker-sync
// runs from `src/cron/midday-sync.ts` and `src/cron/auto-trade.ts` via
// scheduled tasks. Starting this script accidentally would create a second
// broker-sync loop, doubling order/position diffs.
//
// The legacy code is preserved for reference and tests. To run it
// intentionally (e.g. for a local experiment), set:
//   LEGACY_PACKAGE_OPT_IN=1
//
// See repo memory: "OFF on Pi (else doubles)".
if (process.env.LEGACY_PACKAGE_OPT_IN !== '1') {
  console.error(
    '[start-broker-sync-scheduler] Refusing to start. This is a legacy ' +
    'node-cron broker-sync daemon that runs IN ADDITION TO the production ' +
    'Windows-scheduled midday-sync/auto-trade pipeline. Running both will ' +
    'double broker-sync writes.\n\n' +
    'If you really intend to start it (e.g. for an isolated experiment), ' +
    'set LEGACY_PACKAGE_OPT_IN=1 in the environment.',
  );
  process.exit(1);
}

import { registerBrokerSyncJob } from '../packages/broker/src';

const task = registerBrokerSyncJob();

console.log('Broker sync scheduler started.');

process.on('SIGINT', () => {
  task.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  task.stop();
  process.exit(0);
});