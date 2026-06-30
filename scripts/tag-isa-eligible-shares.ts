/**
 * Tag the ISA-eligible tradable universe: individual shares (US + UK, any
 * sleeve) and GBP-listed UCITS ETFs are ISA-eligible in a T212 Stocks &
 * Shares ISA. USD-priced ETFs are LEFT UNTOUCHED (non-UCITS, T212 rejects
 * them with i-s-a-ineligible-instrument — see SACRED_FILE_CHANGES 2026-04-30).
 *
 * Only touches rows where isaEligible IS NULL and t212Ticker IS set. Rows
 * already tagged true/false explicitly are never overwritten. Idempotent.
 *
 * DRY-RUN by default (writes nothing, prints the plan). Pass --apply to commit.
 *
 * USAGE:
 *   npx tsx scripts/tag-isa-eligible-shares.ts          # dry-run
 *   npx tsx scripts/tag-isa-eligible-shares.ts --apply  # commit
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.stock.findMany({
      where: { active: true, isaEligible: null, t212Ticker: { not: null } },
      select: { id: true, ticker: true, sleeve: true, currency: true },
    });

    // ISA-ineligible = US-listed (non-UCITS) ETFs. An ETF is UK-listed/UCITS
    // (ISA-eligible) if EITHER its ticker ends in .L OR its currency is GBP/GBX
    // (pence) — the DB is inconsistent about the .L suffix, so both signals are
    // needed. Only ETFs that are neither (USD or unknown currency, no .L) are
    // treated as genuinely ineligible. Individual shares are eligible regardless.
    const isUkListed = (r: (typeof rows)[number]) =>
      r.ticker.endsWith('.L') || r.currency === 'GBP' || r.currency === 'GBX';
    const isUsEtf = (r: (typeof rows)[number]) => r.sleeve === 'ETF' && !isUkListed(r);
    const eligible = rows.filter((r) => !isUsEtf(r));
    const excluded = rows.filter(isUsEtf);

    console.log(`[tag-isa-eligible-shares] ${apply ? 'APPLY' : 'DRY-RUN'} mode\n`);
    console.log(`Candidates (active, isaEligible=null, T212-mapped): ${rows.length}`);
    console.log(`  → WILL tag isaEligible=true: ${eligible.length}`);
    console.log(`  → EXCLUDED (US-listed ETFs, manual review): ${excluded.length}`);

    if (excluded.length > 0) {
      console.log('\nExcluded US-listed ETFs:');
      for (const e of excluded) console.log(`  - ${e.ticker} (${e.sleeve}, ${e.currency ?? 'unknown'})`);
    }

    if (!apply) {
      console.log('\n[dry-run] No changes written. Re-run with --apply to commit.');
      return;
    }

    const result = await prisma.stock.updateMany({
      where: { id: { in: eligible.map((e) => e.id) } },
      data: { isaEligible: true },
    });
    console.log(`\n[tag-isa-eligible-shares] Updated ${result.count} rows → isaEligible=true.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
