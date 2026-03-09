/**
 * Cleanup script: Remove mock/demo broker data from the database.
 * Safe to run — only deletes records with accountType='DEMO'.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  console.log('=== Cleaning mock DEMO broker data ===\n');

  // 1. Find DEMO broker positions
  const demoPositions = await prisma.brokerPosition.findMany({
    where: { accountType: 'DEMO' },
    select: { id: true, brokerPositionId: true, symbol: true },
  });
  console.log(`Found ${demoPositions.length} DEMO broker positions: ${demoPositions.map((p) => p.symbol).join(', ')}`);

  // 2. Delete protective stops linked to DEMO positions
  const demoPositionIds = demoPositions.map((p) => p.id);
  if (demoPositionIds.length > 0) {
    const deletedStops = await prisma.protectiveStop.deleteMany({
      where: { linkedPositionId: { in: demoPositionIds } },
    });
    console.log(`Deleted ${deletedStops.count} protective stops linked to DEMO positions`);
  }

  // 3. Delete orphan protective stops for DEMO symbols (not linked to any position)
  const demoSymbols = demoPositions.map((p) => p.symbol);
  if (demoSymbols.length > 0) {
    const deletedOrphanStops = await prisma.protectiveStop.deleteMany({
      where: {
        symbol: { in: demoSymbols },
        linkedPositionId: null,
      },
    });
    console.log(`Deleted ${deletedOrphanStops.count} orphan protective stops for DEMO symbols`);
  }

  // 4. Delete DEMO broker orders
  const deletedOrders = await prisma.brokerOrder.deleteMany({
    where: { accountType: 'DEMO' },
  });
  console.log(`Deleted ${deletedOrders.count} DEMO broker orders`);

  // 5. Delete DEMO broker positions
  const deletedPositions = await prisma.brokerPosition.deleteMany({
    where: { accountType: 'DEMO' },
  });
  console.log(`Deleted ${deletedPositions.count} DEMO broker positions`);

  // 6. Delete DEMO portfolio snapshots
  const deletedSnapshots = await prisma.portfolioSnapshot.deleteMany({
    where: { accountType: 'DEMO' },
  });
  console.log(`Deleted ${deletedSnapshots.count} DEMO portfolio snapshots`);

  // 7. Delete audit events from mock broker syncs
  const deletedAuditEvents = await prisma.auditEvent.deleteMany({
    where: {
      entityType: 'BrokerSyncRun',
      eventType: { in: ['BROKER_SYNC_COMPLETED', 'BROKER_SYNC_DISCREPANCY'] },
    },
  });
  console.log(`Deleted ${deletedAuditEvents.count} broker sync audit events`);

  // 8. Delete mock broker sync runs (after audit events that reference them)
  const mockSyncRuns = await prisma.brokerSyncRun.findMany({
    where: { adapter: 'mock' },
    select: { id: true },
  });
  if (mockSyncRuns.length > 0) {
    // Delete associated job runs first
    const deletedJobs = await prisma.jobRun.deleteMany({
      where: { jobName: 'broker.sync' },
    });
    console.log(`Deleted ${deletedJobs.count} broker.sync job runs`);

    const deletedSyncRuns = await prisma.brokerSyncRun.deleteMany({
      where: { adapter: 'mock' },
    });
    console.log(`Deleted ${deletedSyncRuns.count} mock broker sync runs`);
  }

  console.log('\n=== Cleanup complete ===');

  // Verify
  const remaining = {
    demoPositions: await prisma.brokerPosition.count({ where: { accountType: 'DEMO' } }),
    demoOrders: await prisma.brokerOrder.count({ where: { accountType: 'DEMO' } }),
    demoSnapshots: await prisma.portfolioSnapshot.count({ where: { accountType: 'DEMO' } }),
    totalStops: await prisma.protectiveStop.count(),
    totalBrokerSyncRuns: await prisma.brokerSyncRun.count(),
  };
  console.log('\nRemaining DEMO records:', JSON.stringify(remaining, null, 2));

  await prisma.$disconnect();
}

cleanup().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
