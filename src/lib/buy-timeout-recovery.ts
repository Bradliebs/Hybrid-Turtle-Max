import type { T212Position } from './trading212';

interface BuyTimeoutClient {
  cancelOrder(orderId: number): Promise<void>;
  getPositions(): Promise<T212Position[]>;
}

export type BuyTimeoutRecovery =
  | { status: 'CANCELLED' }
  | { status: 'FILLED'; filledQuantity: number; filledPrice: number }
  | { status: 'UNRESOLVED'; error: string };

export async function recoverTimedOutBuy(
  client: BuyTimeoutClient,
  orderId: number,
  t212Ticker: string,
): Promise<BuyTimeoutRecovery> {
  let cancelError: string | null = null;

  try {
    await client.cancelOrder(orderId);
  } catch (error) {
    cancelError = (error as Error).message;
  }

  try {
    const positions = await client.getPositions();
    const position = positions.find((candidate) => candidate.instrument.ticker === t212Ticker);
    if (position && position.quantity > 0) {
      return {
        status: 'FILLED',
        filledQuantity: position.quantity,
        filledPrice: position.averagePricePaid,
      };
    }
  } catch (error) {
    const positionError = (error as Error).message;
    return {
      status: 'UNRESOLVED',
      error: cancelError
        ? `Cancel failed: ${cancelError}; position check failed: ${positionError}`
        : `Order cancellation was not independently verified: ${positionError}`,
    };
  }

  if (cancelError) {
    return { status: 'UNRESOLVED', error: `Cancel failed: ${cancelError}` };
  }

  return { status: 'CANCELLED' };
}