import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function check() {
  const counts: Record<string, number> = {
    users: await p.user.count(),
    instruments: await p.instrument.count(),
    dailyBars: await p.dailyBar.count(),
    positions: await p.position.count(),
    brokerPositions: await p.brokerPosition.count({ where: { isOpen: true } }),
    portfolioSnapshots: await p.portfolioSnapshot.count(),
    plannedTrades: await p.plannedTrade.count(),
    protectiveStops: await p.protectiveStop.count(),
    signalRuns: await p.signalRun.count(),
    signalCandidates: await p.signalCandidate.count(),
    brokerOrders: await p.brokerOrder.count(),
    jobRuns: await p.jobRun.count(),
    auditEvents: await p.auditEvent.count(),
    notifications: await p.notification.count(),
    equitySnapshots: await p.equitySnapshot.count(),
    brokerSyncRuns: await p.brokerSyncRun.count(),
    tradeLogs: await p.tradeLog.count(),
  };
  console.log('=== DB TABLE COUNTS ===');
  for (const [k, v] of Object.entries(counts)) {
    console.log(k.padEnd(25) + String(v));
  }

  const snap = await p.portfolioSnapshot.findFirst({
    orderBy: { snapshotAt: 'desc' },
    select: { accountType: true, currency: true, equity: true, cashBalance: true, source: true },
  });
  console.log('\n=== LATEST PORTFOLIO SNAPSHOT ===');
  console.log(JSON.stringify(snap, (_k, v) => v?.constructor?.name === 'Decimal' ? Number(v) : v, 2));

  const bpos = await p.brokerPosition.findMany({
    where: { isOpen: true },
    select: { symbol: true, quantity: true, marketValue: true, accountType: true },
  });
  console.log('\n=== OPEN BROKER POSITIONS ===');
  for (const b of bpos) {
    console.log(`${b.symbol.padEnd(10)} qty=${Number(b.quantity)} value=${Number(b.marketValue)} account=${b.accountType}`);
  }

  const user = await p.user.findFirst({
    select: {
      equity: true, riskProfile: true, t212Currency: true,
      t212Connected: true, t212IsaConnected: true,
      t212TotalValue: true, t212IsaTotalValue: true,
    },
  });
  console.log('\n=== USER SETTINGS ===');
  console.log(JSON.stringify(user, null, 2));

  const realPositions = await p.position.findMany({
    where: { status: 'OPEN' },
    include: { stock: { select: { ticker: true, name: true } } },
  });
  console.log('\n=== OPEN POSITIONS (Position table) ===');
  for (const rp of realPositions) {
    console.log(`${rp.stock.ticker.padEnd(12)} entry=${rp.entryPrice} stop=${rp.currentStop} shares=${rp.shares}`);
  }

  const orders = await p.brokerOrder.findMany({
    take: 5, orderBy: { updatedAt: 'desc' },
    select: { symbol: true, side: true, status: true, accountType: true, brokerOrderId: true },
  });
  console.log('\n=== RECENT BROKER ORDERS ===');
  for (const o of orders) {
    console.log(`${o.symbol.padEnd(10)} ${o.side} ${o.status} account=${o.accountType} id=${o.brokerOrderId}`);
  }

  await p.$disconnect();
}
check();
