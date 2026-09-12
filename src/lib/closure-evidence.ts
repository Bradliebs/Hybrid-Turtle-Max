import type { T212HistoricalOrder, T212HistoricalOrderFill } from './trading212';

export const PENDING_BROKER_RECONCILIATION = 'PENDING_BROKER_RECONCILIATION';

type ClosureEvidence = {
  ok: true;
  order: T212HistoricalOrder;
  exitPrice: number;
  exitDate: Date;
  pnlGbp: number;
  netValueGbp: number | null;
  fxRate: number | null;
} | { ok: false; reason: string };

export function reconcileClosureEvidence(
  position: { t212Ticker: string; shares: number; entryDate: Date },
  accountOrders: T212HistoricalOrder[],
  closedAt: Date
): ClosureEvidence {
  const unresolved = (reason: string): ClosureEvidence => ({ ok: false, reason });
  const entered = position.entryDate.getTime();
  const closed = closedAt.getTime();
  if (!Number.isFinite(entered) || !Number.isFinite(closed) || closed < entered
    || !Number.isFinite(position.shares) || position.shares <= 0) return unresolved('INVALID_POSITION');

  const sells = accountOrders.filter(order => order.ticker === position.t212Ticker
    && (order.side === 'SELL' || order.type === 'SELL')
    && !(order.status === 'CANCELLED' && order.filledQuantity === 0
      && order.filledValue === 0 && !order.fills?.length));
  if (sells.some(order => !Number.isFinite(Date.parse(order.dateExecuted ?? '')))) return unresolved('MISSING_FILL_DATE');
  const orders = sells.filter(order => Date.parse(order.dateExecuted!) >= entered
    && Date.parse(order.dateExecuted!) <= closed);
  if (!orders.length) return unresolved('NO_SELL_EVIDENCE');
  if (new Set(orders.map(order => order.id)).size !== 1) return unresolved('MULTIPLE_SELL_ORDERS');

  const fills = new Map<number, T212HistoricalOrderFill>();
  const signature = (fill: T212HistoricalOrderFill) => JSON.stringify([
    fill.price, fill.quantity, fill.filledAt, fill.walletImpact?.currency,
    fill.walletImpact?.realisedProfitLoss, fill.walletImpact?.netValue, fill.walletImpact?.fxRate,
  ]);
  for (const order of orders) {
    if (!Number.isSafeInteger(order.id) || order.status !== 'FILLED' || !order.fills?.length
      || !Number.isFinite(order.quantity) || Math.abs(Math.abs(order.quantity) - position.shares) > 1e-8) {
      return unresolved('INCOMPLETE_ORDER');
    }
    for (const fill of order.fills) {
      if (fill.id == null || !Number.isSafeInteger(fill.id)) return unresolved('MISSING_FILL_ID');
      const previous = fills.get(fill.id);
      if (previous && signature(previous) !== signature(fill)) return unresolved('CONFLICTING_FILL');
      const filled = Date.parse(fill.filledAt);
      if (!Number.isFinite(filled) || filled < entered || filled > closed) return unresolved('FILL_OUTSIDE_HOLDING_WINDOW');
      if (!Number.isFinite(fill.quantity) || fill.quantity <= 0
        || !Number.isFinite(fill.price) || fill.price <= 0) return unresolved('INVALID_FILL');
      if (fill.walletImpact?.currency !== 'GBP'
        || !Number.isFinite(fill.walletImpact.realisedProfitLoss)) return unresolved('MISSING_GBP_PNL');
      fills.set(fill.id, fill);
    }
  }
  const distinctFills = [...fills.values()];
  const quantity = distinctFills.reduce((total, fill) => total + fill.quantity, 0);
  if (Math.abs(quantity - position.shares) > 1e-8) return unresolved('INCOMPLETE_QUANTITY');
  const value = distinctFills.reduce((total, fill) => total + fill.price * fill.quantity, 0);
  const pnlGbp = distinctFills.reduce((total, fill) => total + fill.walletImpact!.realisedProfitLoss!, 0);
  if (!Number.isFinite(value) || !Number.isFinite(pnlGbp)) return unresolved('INVALID_TOTAL');
  const exitDate = new Date(Math.max(...distinctFills.map(fill => Date.parse(fill.filledAt))));
  const netValueGbp = distinctFills.every(fill => Number.isFinite(fill.walletImpact?.netValue))
    ? distinctFills.reduce((total, fill) => total + fill.walletImpact!.netValue!, 0) : null;
  const rates = distinctFills.map(fill => fill.walletImpact?.fxRate);
  const fxRate = rates.every(rate => rate === rates[0] && rate != null && Number.isFinite(rate) && rate > 0)
    ? rates[0]! : null;
  return { ok: true, exitPrice: value / quantity, exitDate, pnlGbp, netValueGbp, fxRate,
    order: { ...orders[0], fills: distinctFills, filledQuantity: quantity,
      filledValue: value, dateExecuted: exitDate.toISOString() } };
}