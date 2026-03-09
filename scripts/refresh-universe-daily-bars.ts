import { refreshUniverseDailyBars } from '../packages/data/src';

async function main() {
  const result = await refreshUniverseDailyBars({ force: true });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});