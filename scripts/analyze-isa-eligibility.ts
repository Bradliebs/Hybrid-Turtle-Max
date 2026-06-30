/**
 * Read-only analysis: report the ISA-eligibility tagging blast radius.
 *
 * Writes NOTHING. Answers: of the tradable universe, how many stocks would
 * be tagged isaEligible=true under a conservative rule (individual shares +
 * GBP UCITS ETFs eligible; USD ETFs excluded pending manual review), and
 * how many candidates currently route nowhere because nothing is tagged.
 *
 * USAGE: npx tsx scripts/analyze-isa-eligibility.ts
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const stocks = await prisma.stock.findMany({
      where: { active: true },
      select: { sleeve: true, currency: true, t212Ticker: true, isaEligible: true },
    });

    const total = stocks.length;
    const mapped = stocks.filter((s) => !!s.t212Ticker);

    const count = (pred: (s: (typeof stocks)[number]) => boolean) => stocks.filter(pred).length;

    const bySleeve = new Map<string, number>();
    for (const s of stocks) bySleeve.set(s.sleeve, (bySleeve.get(s.sleeve) ?? 0) + 1);

    const isEtf = (s: (typeof stocks)[number]) => s.sleeve === 'ETF';
    const isGbpEtf = (s: (typeof stocks)[number]) => isEtf(s) && s.currency === 'GBP';
    const isUsdEtf = (s: (typeof stocks)[number]) => isEtf(s) && s.currency !== 'GBP';
    const isShare = (s: (typeof stocks)[number]) => !isEtf(s);

    // Conservative eligible rule: individual shares + GBP UCITS ETFs, must be T212-mapped.
    const conservativeEligible = stocks.filter(
      (s) => !!s.t212Ticker && (isShare(s) || isGbpEtf(s)),
    );

    console.log('=== ISA ELIGIBILITY ANALYSIS (read-only, no writes) ===\n');
    console.log(`Active stocks:            ${total}`);
    console.log(`  T212-mapped (t212Ticker): ${mapped.length}`);
    console.log(`  isaEligible=true:         ${count((s) => s.isaEligible === true)}`);
    console.log(`  isaEligible=false:        ${count((s) => s.isaEligible === false)}`);
    console.log(`  isaEligible=null:         ${count((s) => s.isaEligible === null)}`);

    console.log('\n--- By sleeve ---');
    for (const [sleeve, n] of [...bySleeve.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${sleeve.padEnd(12)} ${n}`);
    }

    console.log('\n--- Eligibility split (active + T212-mapped) ---');
    console.log(`  Individual shares (eligible):  ${count((s) => !!s.t212Ticker && isShare(s))}`);
    console.log(`  GBP UCITS ETFs   (eligible):   ${count((s) => !!s.t212Ticker && isGbpEtf(s))}`);
    console.log(`  USD ETFs (EXCLUDE, review):    ${count((s) => !!s.t212Ticker && isUsdEtf(s))}`);
    console.log(`  Unmapped (no t212Ticker):      ${total - mapped.length}`);

    console.log('\n--- Proposed conservative tag ---');
    console.log(`  WOULD tag isaEligible=true:    ${conservativeEligible.length}`);
    console.log(
      `  WOULD leave untagged (USD ETFs + unmapped): ${total - conservativeEligible.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
