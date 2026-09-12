import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trade: vi.fn(), scan: vi.fn(), existing: vi.fn(), update: vi.fn(),
  completions: vi.fn(),
}));
vi.mock('./prisma', () => ({ default: {
  executionLog: { findMany: mocks.completions },
  $transaction: async (callback: (tx: unknown) => Promise<boolean>) => callback({
    tradeLog: { findUnique: mocks.trade }, scan: { findUnique: mocks.scan },
    candidateOutcome: { findFirst: mocks.existing, updateMany: mocks.update },
  }),
} }));
import { backfillTradeLinks, linkTradeToOutcome } from './candidate-outcome';

const trade = {
  id: 'entry-1', ticker: 'AAPL', tradeType: 'ENTRY', decision: 'TAKEN',
  positionId: 'position-1', userId: 'user-1', actualFill: 100,
  tradeDate: new Date('2026-09-10T10:00:00Z'),
};

describe('exact candidate entry linkage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completions.mockResolvedValue([]);
    mocks.trade.mockResolvedValue(trade);
    mocks.scan.mockResolvedValue({ userId: 'user-1', runDate: new Date('2026-09-10T09:00:00Z') });
    mocks.existing.mockResolvedValue(null);
    mocks.update.mockResolvedValue({ count: 1 });
  });

  it('links only the explicit scan/ticker and permits an identical retry', async () => {
    expect(await linkTradeToOutcome('scan-1', 'AAPL', 'entry-1', 100)).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { scanId: 'scan-1', ticker: 'AAPL', scanDate: { lte: trade.tradeDate },
        OR: [{ tradeLogId: null, tradePlaced: false }, { tradeLogId: 'entry-1' }] },
      data: { tradePlaced: true, tradeLogId: 'entry-1', actualFill: 100 },
    });
  });

  it.each([
    { tradeType: 'EXIT' }, { decision: 'SKIPPED' }, { ticker: 'MSFT' },
    { positionId: null }, { userId: 'other-user' }, { actualFill: null },
    { actualFill: NaN }, { actualFill: 0 },
    { tradeDate: new Date('2026-09-10T08:00:00Z') },
  ])('rejects incompatible entry evidence: %j', async (override) => {
    mocks.trade.mockResolvedValue({ ...trade, ...override });
    expect(await linkTradeToOutcome('scan-1', 'AAPL', 'entry-1')).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a fill mismatch', async () => {
    expect(await linkTradeToOutcome('scan-1', 'AAPL', 'entry-1', 99)).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not approximate missing completion evidence using nearby trades', async () => {
    expect(await backfillTradeLinks()).toBe(0);
    expect(mocks.trade).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('recovers only the explicitly named scan, trade and position', async () => {
    mocks.completions.mockResolvedValue([{
      ticker: 'AAPL', orderId: 'order-1', accountType: 'isa',
      requestBody: JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1' }),
    }]);
    expect(await backfillTradeLinks()).toBe(1);
    expect(mocks.trade).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'entry-1' } }));
    expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'scan-1' } }));
    expect(mocks.update.mock.calls[0][0].where.scanId).toBe('scan-1');
    expect(mocks.update.mock.calls[0][0].where).toMatchObject({ tradeLogId: null, tradePlaced: false });
  });

  it('rejects a completion that names a different position', async () => {
    mocks.completions.mockResolvedValue([{
      ticker: 'AAPL', orderId: 'order-1', accountType: 'isa',
      requestBody: JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'other-position' }),
    }]);
    expect(await backfillTradeLinks()).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not assign an entry already linked to another candidate', async () => {
    mocks.existing.mockResolvedValue({ id: 'other-candidate' });
    expect(await linkTradeToOutcome('scan-1', 'AAPL', 'entry-1')).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    { scanId: null }, { scanId: '' }, { positionId: null }, { tradeLogId: null },
  ])('rejects incomplete completion identity: %j', async (override) => {
    mocks.completions.mockResolvedValue([{
      ticker: 'AAPL', orderId: 'order-1', accountType: 'isa',
      requestBody: JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1', ...override }),
    }]);
    expect(await backfillTradeLinks()).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([{}, { scanId: 'other-scan' }, { positionId: null }])(
    'rejects duplicate completion identities, including malformed duplicates: %j', async (override) => {
      const completion = { ticker: 'AAPL', orderId: 'order-1', accountType: 'isa' };
      const identity = { scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1' };
      mocks.completions.mockResolvedValue([
        { ...completion, requestBody: JSON.stringify(identity) },
        { ...completion, requestBody: JSON.stringify({ ...identity, ...override }) },
      ]);
      expect(await backfillTradeLinks()).toBe(0);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it.each([{ orderId: null }, { accountType: 'N/A' }, { ticker: 'MSFT' }])(
    'rejects incompatible completion metadata: %j', async (override) => {
      mocks.completions.mockResolvedValue([{
        ticker: 'AAPL', orderId: 'order-1', accountType: 'isa', ...override,
        requestBody: JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1' }),
      }]);
      expect(await backfillTradeLinks()).toBe(0);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('warns about unreadable JSON without inventing identity', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.completions.mockResolvedValue([{ requestBody: '{broken' }]);
    expect(await backfillTradeLinks()).toBe(0);
    expect(warning).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it('propagates completion-query failure rather than reporting no work', async () => {
    mocks.completions.mockRejectedValueOnce(new Error('unavailable'));
    await expect(backfillTradeLinks()).rejects.toThrow('unavailable');
  });

  it('propagates recovery write failures without changing the direct execution error contract', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.completions.mockResolvedValue([{
      ticker: 'AAPL', orderId: 'order-1', accountType: 'isa',
      requestBody: JSON.stringify({ scanId: 'scan-1', tradeLogId: 'entry-1', positionId: 'position-1' }),
    }]);
    mocks.update.mockRejectedValueOnce(new Error('write failed'));
    await expect(backfillTradeLinks()).rejects.toThrow('write failed');
    warning.mockRestore();
  });

  it('reports missing or conflicting candidates without overwriting them', async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect(await linkTradeToOutcome('scan-1', 'AAPL', 'entry-1')).toBe(false);
  });

  it('reports persistence errors without throwing into execution', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.update.mockRejectedValueOnce(new Error('unavailable'));
    expect(await linkTradeToOutcome('scan-1', 'AAPL', 'entry-1')).toBe(false);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});