import { createHash } from 'crypto';
import prisma from './prisma';

interface ExecutionIntentRecord {
  operationId: string;
  payloadHash: string;
  status: string;
  orderId: string | null;
  positionId: string | null;
  brokerSubmittedAt: Date | null;
}

export type ExecutionIntentClaim =
  | { claimed: true }
  | {
      claimed: false;
      operationId: string;
      sameOperation: boolean;
      payloadMismatch: boolean;
      status: string;
      orderId: string | null;
      positionId: string | null;
      brokerSubmittedAt: Date | null;
    };

export function hashExecutionPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function hasActiveBrokerSubmissionLease(
  status: string,
  brokerSubmittedAt: Date | null,
  now = Date.now(),
  leaseMs = 2 * 60_000,
): boolean {
  return ['PYRAMID_BROKER_SUBMITTING', 'PYRAMID_BROKER_SUBMITTED'].includes(status)
    && brokerSubmittedAt !== null
    && now - brokerSubmittedAt.getTime() < leaseMs;
}

export async function claimExecutionIntent(input: {
  operationId: string;
  userId: string;
  payloadHash: string;
  activePayloadHash?: string;
  stockId: string;
  ticker: string;
  accountType: string;
  requestedQuantity: number;
  stopPrice: number;
}): Promise<ExecutionIntentClaim> {
  const activePayloadHash = input.activePayloadHash ?? input.payloadHash;
  const inserted = await prisma.$executeRaw`
    INSERT OR IGNORE INTO "ExecutionIntent"
      ("operationId", "userId", "payloadHash", "activePayloadHash", "stockId", "ticker", "accountType", "requestedQuantity", "stopPrice", "status", "createdAt", "updatedAt")
    VALUES
      (${input.operationId}, ${input.userId}, ${input.payloadHash}, ${activePayloadHash}, ${input.stockId}, ${input.ticker}, ${input.accountType}, ${input.requestedQuantity}, ${input.stopPrice}, 'IN_PROGRESS', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;

  if (inserted === 1) return { claimed: true };

  const existing = await prisma.$queryRaw<ExecutionIntentRecord[]>`
    SELECT "operationId", "payloadHash", "status", "orderId", "positionId", "brokerSubmittedAt"
    FROM "ExecutionIntent"
    WHERE "operationId" = ${input.operationId}
      OR "activePayloadHash" = ${activePayloadHash}
    LIMIT 1
  `;
  const intent = existing[0];
  if (!intent) throw new Error('Execution intent conflict could not be resolved');

  return {
    claimed: false,
    operationId: intent.operationId,
    sameOperation: intent.operationId === input.operationId,
    payloadMismatch: intent.payloadHash !== input.payloadHash,
    status: intent.status,
    orderId: intent.orderId,
    positionId: intent.positionId,
    brokerSubmittedAt: intent.brokerSubmittedAt,
  };
}

export async function updateExecutionIntent(
  operationId: string,
  update: {
    status: string;
    orderId?: string;
    stopOrderId?: string;
    positionId?: string;
    error?: string;
    release?: boolean;
    baselineQuantity?: number;
    baselineAveragePrice?: number;
    markBrokerSubmitted?: boolean;
  },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ExecutionIntent"
    SET "status" = ${update.status},
        "orderId" = COALESCE(${update.orderId ?? null}, "orderId"),
      "stopOrderId" = COALESCE(${update.stopOrderId ?? null}, "stopOrderId"),
        "positionId" = COALESCE(${update.positionId ?? null}, "positionId"),
        "error" = ${update.error ?? null},
        "baselineQuantity" = COALESCE(${update.baselineQuantity ?? null}, "baselineQuantity"),
        "baselineAveragePrice" = COALESCE(${update.baselineAveragePrice ?? null}, "baselineAveragePrice"),
        "brokerSubmittedAt" = CASE WHEN ${update.markBrokerSubmitted === true} THEN CURRENT_TIMESTAMP ELSE "brokerSubmittedAt" END,
        "activePayloadHash" = CASE WHEN ${update.release === true} THEN NULL ELSE "activePayloadHash" END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "operationId" = ${operationId}
  `;
}