import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transactionMock, positionFindMock, positionUpdateManyMock, historyCreateMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  positionFindMock: vi.fn(),
  positionUpdateManyMock: vi.fn(),
  historyCreateMock: vi.fn(),
}));

vi.mock('./prisma', () => ({
  default: {
    $transaction: transactionMock,
  },
}));

import { StopLossError, updateStopLoss } from './stop-manager';

describe('updateStopLoss atomic monotonic update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback({
      position: {
        findUnique: positionFindMock,
        updateMany: positionUpdateManyMock,
      },
      stopHistory: { create: historyCreateMock },
    }));
    positionFindMock.mockResolvedValue({
      id: 'position-1',
      status: 'OPEN',
      currentStop: 100,
      entryPrice: 110,
      initialRisk: 10,
    });
    positionUpdateManyMock.mockResolvedValue({ count: 1 });
    historyCreateMock.mockResolvedValue({ id: 'history-1' });
  });

  it('compares and writes through the same transaction client', async () => {
    await updateStopLoss('position-1', 105, 'raise');

    expect(positionUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'position-1', status: 'OPEN', currentStop: 100 },
    }));
    expect(historyCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ oldStop: 100, newStop: 105 }),
    }));
  });

  it('does not write a lower stop observed inside the transaction', async () => {
    positionFindMock.mockResolvedValueOnce({
      id: 'position-1',
      status: 'OPEN',
      currentStop: 110,
      entryPrice: 100,
      initialRisk: 10,
    });

    await expect(updateStopLoss('position-1', 105, 'stale raise')).rejects.toBeInstanceOf(StopLossError);
    expect(positionUpdateManyMock).not.toHaveBeenCalled();
    expect(historyCreateMock).not.toHaveBeenCalled();
  });

  it('aborts without history when compare-and-swap loses a race', async () => {
    positionUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    await expect(updateStopLoss('position-1', 105, 'racing raise'))
      .rejects.toThrow('Stop changed concurrently');
    expect(historyCreateMock).not.toHaveBeenCalled();
  });
});