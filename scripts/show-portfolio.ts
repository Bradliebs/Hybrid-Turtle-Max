import { getPortfolioPageData } from '../packages/portfolio/src';

async function main() {
  const result = await getPortfolioPageData();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});