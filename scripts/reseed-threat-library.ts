/**
 * Reseed Threat Library
 *
 * The realised-vol dimension of the environment vector was encoded on the wrong
 * scale (FEATURE_RANGES max was 5 while buildCurrentEnvironment produces
 * annualised % ~10-25). Every stored vector therefore has that dimension pinned
 * at or near 1.0. seedThreatLibrary() early-returns when any row exists, so the
 * constant fix alone does NOT refresh stored vectors.
 *
 * This script deletes the bootstrap_* rows and re-seeds them from the corrected
 * constants.
 *
 * `live_loss` rows CANNOT be repaired: addThreatFromLoss stores only the encoded
 * vector, never the raw MarketEnvironment, so the pre-clamp value is gone. They
 * are reported and left alone unless --purge-live-loss is passed explicitly.
 *
 * Usage:
 *   npx tsx scripts/reseed-threat-library.ts                      # dry run
 *   npx tsx scripts/reseed-threat-library.ts --apply              # reseed bootstrap rows
 *   npx tsx scripts/reseed-threat-library.ts --apply --purge-live-loss
 */
process.env.HYBRIDTURTLE_SKIP_STARTUP_PRECACHE = 'true';

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedThreatLibrary } from '../src/lib/prediction/threat-library';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');
const PURGE_LIVE_LOSS = process.argv.includes('--purge-live-loss');

async function main() {
  const entries = await prisma.threatLibraryEntry.findMany({
    select: { id: true, label: true, source: true },
  });

  const bySource = new Map<string, number>();
  for (const e of entries) {
    bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
  }

  console.log(`\nThreatLibraryEntry rows: ${entries.length}`);
  for (const [source, count] of [...bySource].sort()) {
    console.log(`  ${source}: ${count}`);
  }

  const bootstrapIds = entries.filter(e => e.source.startsWith('bootstrap')).map(e => e.id);
  const liveLoss = entries.filter(e => e.source === 'live_loss');

  console.log(`\nBootstrap rows to delete and re-seed: ${bootstrapIds.length}`);

  if (liveLoss.length > 0) {
    console.log(`\n⚠  ${liveLoss.length} 'live_loss' row(s) carry the corrupt realised-vol`);
    console.log(`   dimension and cannot be re-encoded (raw environment was never stored):`);
    for (const e of liveLoss) console.log(`     - ${e.label}`);
    console.log(
      PURGE_LIVE_LOSS
        ? `   --purge-live-loss given: these WILL be deleted.`
        : `   Left in place. Pass --purge-live-loss to delete them (irreversible).`
    );
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply.\n');
    return;
  }

  if (bootstrapIds.length > 0) {
    await prisma.threatLibraryEntry.deleteMany({ where: { id: { in: bootstrapIds } } });
    console.log(`\nDeleted ${bootstrapIds.length} bootstrap row(s).`);
  }

  if (PURGE_LIVE_LOSS && liveLoss.length > 0) {
    await prisma.threatLibraryEntry.deleteMany({
      where: { id: { in: liveLoss.map(e => e.id) } },
    });
    console.log(`Deleted ${liveLoss.length} live_loss row(s).`);
  }

  const seeded = await seedThreatLibrary();
  console.log(`Seeded ${seeded} bootstrap row(s) from corrected constants.`);

  if (seeded === 0) {
    console.log(
      `\n⚠  seedThreatLibrary() returned 0 — it early-returns when ANY row exists.\n` +
      `   Remaining live_loss rows blocked the re-seed. Either purge them\n` +
      `   (--purge-live-loss) or seed manually.\n`
    );
  }

  const after = await prisma.threatLibraryEntry.count();
  console.log(`\nFinal row count: ${after}\n`);
}

main()
  .catch(err => {
    console.error('[reseed-threat-library]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
