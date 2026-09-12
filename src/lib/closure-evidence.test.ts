import { describe, expect, it } from 'vitest';
import type { T212HistoricalOrder } from './trading212';
import { reconcileClosureEvidence } from './closure-evidence';

const position = { t212Ticker: 'TEST_US_EQ', shares: 10, entryDate: new Date('2026-06-01') };
const closedAt = new Date('2026-06-03');
const order = (id: number, quantity: number, price: number, pnl: number): T212HistoricalOrder => ({
  id: 101, ticker: 'TEST_US_EQ', side: 'SELL', type: 'STOP', status: 'FILLED',
  quantity: 10, filledQuantity: quantity, filledValue: quantity * price,
  dateCreated: '2026-06-01', dateExecuted: '2026-06-02', stopPrice: 100,
  fills: [{ id, quantity, price, filledAt: '2026-06-02',
    walletImpact: { currency: 'GBP', realisedProfitLoss: pnl, netValue: quantity * price, fxRate: 1 } }],
});

describe('reconcileClosureEvidence', () => {
  it('ignores a confirmed unfilled cancellation beside a complete sell', () => {
    const cancelled: T212HistoricalOrder = {
      id: 99, ticker: position.t212Ticker, side: 'SELL', type: 'STOP', status: 'CANCELLED',
      quantity: 10, filledQuantity: 0, filledValue: 0, dateCreated: '2026-06-01',
    };
    expect(reconcileClosureEvidence(position, [cancelled, order(1, 10, 110, 5)], closedAt))
      .toMatchObject({ ok: true, exitPrice: 110, pnlGbp: 5 });
    expect(reconcileClosureEvidence(position, [cancelled], closedAt))
      .toEqual({ ok: false, reason: 'NO_SELL_EVIDENCE' });
  });

  it.each(['positive-quantity', 'positive-value', 'fill-present', 'unknown-quantity', 'active'] as const)(
    'does not discard ambiguous or executed cancellation: %s', variant => {
      const cancelled: T212HistoricalOrder = {
        id: 99, ticker: position.t212Ticker, side: 'SELL', type: 'STOP', status: 'CANCELLED',
        quantity: 10, filledQuantity: 0, filledValue: 0, dateCreated: '2026-06-01',
      };
      if (variant === 'positive-quantity') cancelled.filledQuantity = 1;
      if (variant === 'positive-value') cancelled.filledValue = 100;
      if (variant === 'fill-present') cancelled.fills = order(2, 1, 100, 0).fills;
      if (variant === 'unknown-quantity') cancelled.filledQuantity = NaN;
      if (variant === 'active') cancelled.status = 'NEW';
      expect(reconcileClosureEvidence(position, [cancelled, order(1, 10, 110, 5)], closedAt))
        .toEqual({ ok: false, reason: 'MISSING_FILL_DATE' });
    },
  );

  it('aggregates distinct same-order fills and ignores identical duplicates', () => {
    const first = order(1, 8, 110, 4);
    const last = order(2, 2, 120, 1);
    const result = reconcileClosureEvidence(position, [last, first, first], closedAt);
    expect(result).toMatchObject({ ok: true, exitPrice: 112, pnlGbp: 5,
      netValueGbp: 1120, fxRate: 1, order: { filledQuantity: 10, filledValue: 1120 } });
    if (result.ok) expect(result.order.fills).toHaveLength(2);
  });

  it('does not mix a later same-ticker lifecycle into an already closed position', () => {
    const later = { ...order(2, 10, 120, 6), id: 102, dateExecuted: '2026-08-02' };
    later.fills![0].filledAt = '2026-08-02';
    expect(reconcileClosureEvidence(position, [order(1, 10, 110, 5), later], closedAt))
      .toMatchObject({ ok: true, exitPrice: 110, pnlGbp: 5 });
    expect(reconcileClosureEvidence(position, [later], closedAt))
      .toEqual({ ok: false, reason: 'NO_SELL_EVIDENCE' });
  });

  it.each([
    { name: 'truncated history', orders: [order(2, 2, 120, 1)], reason: 'INCOMPLETE_QUANTITY' },
    { name: 'absent history', orders: [], reason: 'NO_SELL_EVIDENCE' },
    { name: 'another ticker', orders: [{ ...order(1, 10, 110, 5), ticker: 'OTHER_US_EQ' }], reason: 'NO_SELL_EVIDENCE' },
    { name: 'older lifecycle', orders: [{ ...order(1, 10, 110, 5), dateExecuted: '2026-05-01' }], reason: 'NO_SELL_EVIDENCE' },
    { name: 'multiple orders', orders: [order(1, 8, 110, 4), { ...order(2, 2, 120, 1), id: 102 }], reason: 'MULTIPLE_SELL_ORDERS' },
    { name: 'conflicting duplicate fill', orders: [order(1, 10, 110, 5), order(1, 10, 120, 6)], reason: 'CONFLICTING_FILL' },
    { name: 'mismatched order quantity', orders: [{ ...order(1, 10, 110, 5), quantity: 20 }], reason: 'INCOMPLETE_ORDER' },
  ])('withholds $name', ({ orders, reason }) => {
    expect(reconcileClosureEvidence(position, orders, closedAt)).toEqual({ ok: false, reason });
  });

  it.each(['id', 'currency', 'pnl', 'future', 'before-entry', 'zero-quantity'] as const)(
    'withholds invalid fill evidence: %s', (invalid) => {
      const sell = order(1, 10, 110, 5);
      const fill = sell.fills![0];
      if (invalid === 'id') delete fill.id;
      if (invalid === 'currency') fill.walletImpact!.currency = 'USD';
      if (invalid === 'pnl') delete fill.walletImpact!.realisedProfitLoss;
      if (invalid === 'future') fill.filledAt = '2026-06-04';
      if (invalid === 'before-entry') fill.filledAt = '2026-05-31';
      if (invalid === 'zero-quantity') fill.quantity = 0;
      expect(reconcileClosureEvidence(position, [sell], closedAt).ok).toBe(false);
    }
  );
});