import prisma from './prisma';
import type {
  T212HistoricalOrder,
  T212PendingOrder,
  T212Position,
} from './trading212';
import { updateExecutionIntent } from './execution-intent';

const RECONCILIATION_GRACE_MS = 2 * 60 * 1000;
const QUANTITY_EPSILON = 1e-8;

interface RetainedExecutionIntent {
  operationId: string;
  userId: string;
  stockId: string | null;
  ticker: string;
  accountType: string;
  status: string;
  orderId: string | null;
  stopOrderId: string | null;
  positionId: string | null;
  requestedQuantity: number | null;
  baselineQuantity: number | null;
  baselineAveragePrice: number | null;
  brokerSubmittedAt: Date | null;
}

interface ReconciliationClient {
  getPositions(): Promise<T212Position[]>;
  getPendingOrders(): Promise<T212PendingOrder[]>;
  getOrderHistory(limit?: number, options?: { maxPages?: number }): Promise<T212HistoricalOrder[]>;
  cancelOrder(orderId: number): Promise<void>;
}

export type ExecutionReconciliationResult =
  | { released: true; status: 'CANCELLED'; message: string }
  | {
      released: true;
      status: 'COMPLETED_RECONCILED';
      message: string;
      orderId: string;
      positionId: string;
    }
  | { released: false; status: 'RECONCILIATION_REQUIRED'; message: string };

function matchesPendingOrder(order: T212PendingOrder, intent: RetainedExecutionIntent): boolean {
  return String(order.id) === intent.orderId;
}

function matchesHistoricalOrder(order: T212HistoricalOrder, intent: RetainedExecutionIntent): boolean {
  return String(order.id) === intent.orderId;
}

async function retain(operationId: string, message: string): Promise<ExecutionReconciliationResult> {
  await updateExecutionIntent(operationId, {
    status: 'RECONCILIATION_REQUIRED',
    error: message,
  });
  return { released: false, status: 'RECONCILIATION_REQUIRED', message };
}

async function releaseCancelled(operationId: string, message: string): Promise<ExecutionReconciliationResult> {
  await updateExecutionIntent(operationId, {
    status: 'CANCELLED',
    error: message,
    release: true,
  });
  return { released: true, status: 'CANCELLED', message };
}

async function verifyManagedFill(
  intent: RetainedExecutionIntent,
  pendingOrders: T212PendingOrder[],
  orderId: string,
  filledQuantity: number,
): Promise<ExecutionReconciliationResult> {
  if (!intent.positionId || !intent.stopOrderId) {
    return retain(intent.operationId, `Broker fill ${orderId} exists, but its exact database position or protective stop ID is missing.`);
  }

  const position = await prisma.position.findFirst({
    where: {
      id: intent.positionId,
      userId: intent.userId,
      stockId: intent.stockId!,
      status: 'OPEN',
      accountType: intent.accountType,
      shares: { gte: filledQuantity * 0.99 },
      currentStop: { gt: 0 },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  const protectiveStop = pendingOrders.find(order =>
    String(order.id) === intent.stopOrderId
    && order.ticker === intent.ticker
    && order.side === 'SELL'
    && order.type === 'STOP'
    && Math.abs(order.quantity) >= filledQuantity * 0.99
  );

  if (!position || !protectiveStop) {
    const missing = [
      !position ? 'an open database position' : null,
      !protectiveStop ? 'a broker stop covering the fill' : null,
    ].filter(Boolean).join(' and ');
    return retain(intent.operationId, `Broker fill ${orderId} exists but ${missing} could not be verified.`);
  }

  const message = `Broker fill ${orderId}, database position ${position.id}, and protective stop ${protectiveStop.id} were verified.`;
  await updateExecutionIntent(intent.operationId, {
    status: 'COMPLETED_RECONCILED',
    orderId,
    positionId: position.id,
    error: message,
    release: true,
  });
  return {
    released: true,
    status: 'COMPLETED_RECONCILED',
    message,
    orderId,
    positionId: position.id,
  };
}

export async function reconcileExecutionIntent(
  operationId: string,
  client: ReconciliationClient,
  now = new Date(),
): Promise<ExecutionReconciliationResult> {
  const rows = await prisma.$queryRaw<RetainedExecutionIntent[]>`
    SELECT "operationId", "userId", "stockId", "ticker", "accountType", "status", "orderId", "stopOrderId", "positionId",
           "requestedQuantity", "baselineQuantity", "baselineAveragePrice", "brokerSubmittedAt"
    FROM "ExecutionIntent"
    WHERE "operationId" = ${operationId}
    LIMIT 1
  `;
  const intent = rows[0];
  if (!intent) return retain(operationId, 'Execution intent no longer exists.');

  if (!['BROKER_OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', 'BROKER_SUBMITTED', 'BROKER_SUBMITTING'].includes(intent.status)) {
    return retain(operationId, `Execution intent status ${intent.status} is not reconcilable.`);
  }

  if (!intent.stockId || intent.requestedQuantity == null || intent.baselineQuantity == null
    || intent.baselineAveragePrice == null || !intent.brokerSubmittedAt) {
    return retain(operationId, 'Execution intent is missing authoritative pre-submission evidence.');
  }

  if (!intent.orderId) {
    return retain(operationId, 'No exact broker order ID was captured; automatic reconciliation cannot safely attribute an order.');
  }

  let positions: T212Position[];
  let pendingOrders: T212PendingOrder[];
  let historicalOrders: T212HistoricalOrder[];
  try {
    [positions, pendingOrders, historicalOrders] = await Promise.all([
      client.getPositions(),
      client.getPendingOrders(),
      client.getOrderHistory(50, { maxPages: 2 }),
    ]);
  } catch (error) {
    return retain(operationId, `Broker reconciliation read failed: ${(error as Error).message}`);
  }

  const pendingMatches = pendingOrders.filter(order => matchesPendingOrder(order, intent));
  const historicalMatches = historicalOrders.filter(order => matchesHistoricalOrder(order, intent));
  const brokerPosition = positions.find(position => position.instrument.ticker === intent.ticker);
  const positionIncrease = (brokerPosition?.quantity ?? 0) - intent.baselineQuantity;
  const matchedPending = pendingMatches[0];
  const matchedHistorical = historicalMatches[0];
  const matchedOrderId = intent.orderId;
  const confirmedFillQuantity = Math.max(
    matchedPending?.filledQuantity ?? 0,
    matchedHistorical?.filledQuantity ?? 0,
  );

  if (confirmedFillQuantity > QUANTITY_EPSILON && matchedOrderId) {
    return verifyManagedFill(intent, pendingOrders, matchedOrderId, confirmedFillQuantity);
  }

  if (matchedPending) {
    try {
      await client.cancelOrder(matchedPending.id);
    } catch (error) {
      return retain(operationId, `Broker cancellation failed: ${(error as Error).message}`);
    }
    return retain(operationId, `Cancellation requested for broker order ${matchedPending.id}; awaiting terminal broker history before release.`);
  }

  if (positionIncrease > QUANTITY_EPSILON) {
    return retain(operationId, `Broker position increased by ${positionIncrease}, but no unique matching order was found.`);
  }

  if (matchedHistorical) {
    const terminalNoFill = ['CANCELLED', 'CANCELED', 'REJECTED'].includes(matchedHistorical.status.toUpperCase())
      && matchedHistorical.filledQuantity <= QUANTITY_EPSILON;
    if (terminalNoFill) {
      return releaseCancelled(operationId, `Broker order ${matchedHistorical.id} is terminal with no fill and no position increase.`);
    }
    return retain(operationId, `Broker order ${matchedHistorical.id} is not terminal and fill-free.`);
  }

  if (now.getTime() - intent.brokerSubmittedAt.getTime() < RECONCILIATION_GRACE_MS) {
    return retain(operationId, 'Broker outcome is still inside the reconciliation grace period.');
  }

  return retain(operationId, 'The exact broker order is not visible in pending or historical orders; automatic release is unsafe.');
}