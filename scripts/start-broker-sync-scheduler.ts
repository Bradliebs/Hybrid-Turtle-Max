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