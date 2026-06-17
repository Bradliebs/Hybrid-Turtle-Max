// Smoke test: confirm Prisma v6 auto-reconnects after an explicit $disconnect().
// This validates the assumption in src/cron/auto-trade.ts that
// releaseAutoTradeLock() can run after runAutoTrade() has disconnected.
import prisma from '@/lib/prisma';

(async () => {
  console.log('step 1: initial query (forces connect)');
  const before = await prisma.appSetting.count();
  console.log('  count =', before);

  console.log('step 2: explicit $disconnect');
  await prisma.$disconnect();

  console.log('step 3: post-disconnect query (must auto-reconnect)');
  try {
    const after = await prisma.appSetting.count();
    console.log('  count =', after);
    console.log('AUTO-RECONNECT: OK');
  } catch (err) {
    console.error('AUTO-RECONNECT: FAILED', err);
    process.exit(1);
  }

  await prisma.$disconnect();
})();
