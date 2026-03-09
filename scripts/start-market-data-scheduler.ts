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