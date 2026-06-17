import prisma from '@/lib/prisma';
(async () => {
  const r = await prisma.appSetting.findUnique({ where: { key: 'auto-trade.run-lock' } });
  console.log('lock row:', r ? JSON.stringify(r.valueJson) : 'NONE');
  if (r) {
    await prisma.appSetting.delete({ where: { key: 'auto-trade.run-lock' } });
    console.log('deleted leaked lock row');
  }
  await prisma.$disconnect();
})();
