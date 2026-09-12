import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let finish: () => void = () => undefined;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  return {
    finished,
    stockUpsert: vi.fn().mockResolvedValue({ createdAt: new Date(0), updatedAt: new Date(0) }),
    disconnect: vi.fn().mockImplementation(async () => { finish(); }),
  };
});

vi.mock('@prisma/client', () => ({
  AssetType: { STOCK: 'STOCK', ETF: 'ETF' },
  PrismaClient: class {
    stock = {
      upsert: mocks.stockUpsert,
      count: vi.fn().mockResolvedValue(4),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    user = { upsert: vi.fn().mockResolvedValue({}) };
    instrument = { upsert: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(3) };
    $disconnect = mocks.disconnect;
  },
}));

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('test-hash') } }));

vi.mock('fs', () => ({
  existsSync: () => true,
  readFileSync: (filePath: string) => {
    const fixtures: Record<string, string> = {
      'stock_core_200.txt': '# ===== HEALTHCARE =====\nCORE1',
      'stock_high_risk.txt': 'PRTS',
      'etf_core.txt': 'ETF1',
      'hedge.txt': 'HEDGE1',
      'cluster_map.csv': 'PRTS,Consumer_Discretionary',
      'super_cluster_map_enhanced.csv': 'PRTS,CONSUMER_DISC',
      'region_map.csv': 'PRTS,US,USD',
      'ticker_map.csv': 'PRTS_US_EQ,PRTS',
    };
    const filename = filePath.split(/[\\/]/).at(-1) ?? '';
    if (!(filename in fixtures)) throw new Error(`Unexpected seed input: ${filename}`);
    return fixtures[filename];
  },
}));

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`Seed attempted exit: ${code}`); });
  await import('../../prisma/seed');
  await mocks.finished;
});

afterAll(() => { vi.restoreAllMocks(); });

describe('production seed sector writes', () => {
  it.each(['PRTS', 'ETF1', 'HEDGE1'])('omits unknown sector updates for %s but retains null on creation', ticker => {
    const write = mocks.stockUpsert.mock.calls.find(([args]) => args.where.ticker === ticker)?.[0];
    expect(write).toBeDefined();
    expect(write.update).not.toHaveProperty('sector');
    expect(write.create.sector).toBeNull();
    expect({ sector: 'CONSUMER DISCRETIONARY', ...write.update }.sector).toBe('CONSUMER DISCRETIONARY');
  });

  it('still applies an explicit source classification to both updates and creates', () => {
    const write = mocks.stockUpsert.mock.calls.find(([args]) => args.where.ticker === 'CORE1')?.[0];
    expect(write.update.sector).toBe('HEALTHCARE');
    expect(write.create.sector).toBe('HEALTHCARE');
  });

  it('preserves PRTS identity, cluster and sleeve without inferring a sector from them', () => {
    const write = mocks.stockUpsert.mock.calls.find(([args]) => args.where.ticker === 'PRTS')?.[0];
    expect(write.update).toMatchObject({ sleeve: 'HIGH_RISK', cluster: 'Consumer_Discretionary',
      superCluster: 'CONSUMER_DISC', region: 'US', currency: 'USD', t212Ticker: 'PRTS_US_EQ' });
    expect(mocks.stockUpsert).toHaveBeenCalledTimes(4);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});