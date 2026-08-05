import type { T212HistoricalOrder } from './trading212';

interface BuyTimeoutClient {
  cancelOrder(orderId: number): Promise<void>;
  getOrderHistory(limit?: number, options?: { maxPages?: number }): Promise<T212HistoricalOrder[]>;
}

export type BuyTimeoutRecovery =
  | { status: 'CANCELLED' }
  | { status: 'FILLED'; filledQuantity: number; filledPrice: number }
  | { status: 'UNRESOLVED'; error: string };

export function getHistoricalFill(
  orders: T212HistoricalOrder[],
  orderId: number,
): Extract<BuyTimeoutRecovery, { status: 'FILLED' }> | null {
  const order = orders.find(candidate => candidate.id === orderId);
  if (!order || order.filledQuantity <= 1e-8) return null;
  const filledPrice = order.filledValue > 0
    ? order.filledValue / order.filledQuantity
    : (order.fills?.[0]?.price ?? 0);
  if (filledPrice <= 0) return null;
  return { status: 'FILLED', filledQuantity: order.filledQuantity, filledPrice };
}

export async function recoverTimedOutBuy(
  client: BuyTimeoutClient,
  orderId: number,
): Promise<BuyTimeoutRecovery> {
  let cancelError: string | null = null;

  try {
    await client.cancelOrder(orderId);
  } catch (error) {
    cancelError = (error as Error).message;
  }

  try {
    const orders = await client.getOrderHistory(50, { maxPages: 2 });
    const fill = getHistoricalFill(orders, orderId);
    if (fill) return fill;
    const order = orders.find(candidate => candidate.id === orderId);
    const terminalNoFill = order
      && ['CANCELLED', 'CANCELED', 'REJECTED'].includes(order.status.toUpperCase())
      && order.filledQuantity <= 1e-8;
    if (terminalNoFill) return { status: 'CANCELLED' };
  } catch (error) {
    const historyError = (error as Error).message;
    return {
      status: 'UNRESOLVED',
      error: cancelError
        ? `Cancel failed: ${cancelError}; order history check failed: ${historyError}`
        : `Order cancellation was not independently verified: ${historyError}`,
    };
  }

  if (cancelError) {
    return { status: 'UNRESOLVED', error: `Cancel failed: ${cancelError}` };
  }

  return { status: 'UNRESOLVED', error: `Order ${orderId} is not yet terminal in broker history` };
}