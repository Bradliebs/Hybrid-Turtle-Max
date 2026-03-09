import { runBrokerSync } from '../packages/broker/src';

async function main() {
  const result = await runBrokerSync();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});