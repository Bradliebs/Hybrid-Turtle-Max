/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/execution-drag/route.ts
 * Consumes: prisma.ts, @/types
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 * Notes: Computes model-vs-actual execution drag from TradeLog data.
 *        Uses existing TradeLog fields: entryPrice, actualFill, slippagePct,
 *        initialStop, initialR, finalRMultiple, plannedEntry, fillTime.
 */
import { z } from 'zod';
import type { ExecutionDragRecord, ExecutionDragSummary, ExecutionFillEvidenceStatus } from '@/types';
import prisma from './prisma';

const completionLinkSchema = z.object({ tradeLogId: z.string().min(1), positionId: z.unknown() });
const fillEvidenceSchema = z.object({ fillEvidence: z.object({
  version: z.literal(1), userId: z.string(), decisionId: z.string().nullable(),
  source: z.enum(['PLANNED_ENTRY_FALLBACK', 'ORDER_VALUE_OVER_QUANTITY', 'HISTORY_HELPER', 'TIMEOUT_RECOVERY']),
  observedAt: z.string().datetime(), brokerExecutionTime: z.null(),
  usedPrice: z.number().finite().positive(), usedQuantity: z.number().finite().positive(),
  priceBasis: z.literal('UNVERIFIED'),
}) });

function parseJson(value: string | null): unknown {
  try { return value === null ? null : JSON.parse(value); } catch { return null; }
}

const positiveFinite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

/**
 * Compute execution drag for a single trade log entry.
 */
function computeSingleDrag(trade: {
  id: string;
  ticker: string;
  tradeDate: Date;
  actualFill: number | null;
  initialStop: number | null;
  finalRMultiple: number | null;
  plannedEntry: number | null;
}, fillEvidenceStatus: ExecutionFillEvidenceStatus): ExecutionDragRecord | null {
  const modelEntry = trade.plannedEntry;
  if (!positiveFinite(modelEntry) || !Number.isFinite(trade.tradeDate.getTime())) return null;
  const excluded = fillEvidenceStatus === 'PLANNED_ENTRY_FALLBACK' || fillEvidenceStatus === 'INVALID_EVIDENCE';
  const actualEntry = !excluded && positiveFinite(trade.actualFill) ? trade.actualFill : null;
  const entrySlippage = actualEntry !== null ? ((actualEntry - modelEntry) / modelEntry) * 100 : null;
  const plannedRisk = positiveFinite(trade.initialStop) ? modelEntry - trade.initialStop : null;
  const entryGapR = actualEntry !== null && positiveFinite(plannedRisk)
    ? (actualEntry - modelEntry) / plannedRisk : null;

  return {
    tradeLogId: trade.id,
    ticker: trade.ticker,
    tradeDate: trade.tradeDate.toISOString(),
    modelEntry,
    actualEntry,
    fillEvidenceStatus,
    entrySlippagePct: entrySlippage !== null && Number.isFinite(entrySlippage) ? entrySlippage : null,
    entryGapR: entryGapR !== null && Number.isFinite(entryGapR) ? entryGapR : null,
    modelStop: positiveFinite(trade.initialStop) ? trade.initialStop : null,
    actualStop: null, // would need stop-at-close data to fill this
    modelR: null,
    actualR: trade.finalRMultiple !== null && Number.isFinite(trade.finalRMultiple) ? trade.finalRMultiple : null,
    rDrag: null,
    daysToFill: null,
  };
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute execution drag records and summary for all executed trades.
 */
export async function computeExecutionDrag(opts?: {
  userId?: string;
  from?: Date;
  to?: Date;
}): Promise<{ records: ExecutionDragRecord[]; summary: ExecutionDragSummary }> {
  const where: Record<string, unknown> = {
    decision: { in: ['TAKEN', 'EXECUTED', 'BUY'] },
    tradeType: 'ENTRY',
  };
  if (opts?.userId) where.userId = opts.userId;
  if (opts?.from || opts?.to) {
    where.tradeDate = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  const trades = await prisma.tradeLog.findMany({
    where,
    select: {
      id: true,
      userId: true,
      positionId: true,
      shares: true,
      ticker: true,
      tradeDate: true,
      actualFill: true,
      initialStop: true,
      finalRMultiple: true,
      plannedEntry: true,
    },
    orderBy: { tradeDate: 'desc' },
  });

  const completions = trades.length > 0 ? await prisma.executionLog.findMany({
    where: { phase: 'COMPLETE', ticker: { in: Array.from(new Set(trades.map(trade => trade.ticker))) } },
    select: { ticker: true, orderId: true, accountType: true, requestBody: true, responseBody: true },
  }) : [];
  const completionByTrade = new Map<string, Array<{ positionId: unknown; completion: typeof completions[number] }>>();
  for (const completion of completions) {
    const link = completionLinkSchema.safeParse(parseJson(completion.requestBody));
    if (!link.success) continue;
    const entries = completionByTrade.get(link.data.tradeLogId) ?? [];
    entries.push({ positionId: link.data.positionId, completion });
    completionByTrade.set(link.data.tradeLogId, entries);
  }

  const records: ExecutionDragRecord[] = [];
  for (const trade of trades) {
    const matches = completionByTrade.get(trade.id) ?? [];
    let status: ExecutionFillEvidenceStatus = 'LEGACY_UNVERIFIED';
    if (matches.length > 1) status = 'INVALID_EVIDENCE';
    if (matches.length === 1) {
      const { positionId, completion } = matches[0];
      if (typeof positionId !== 'string' || !positionId || positionId !== trade.positionId || completion.ticker !== trade.ticker) {
        status = 'INVALID_EVIDENCE';
      } else if (completion.responseBody !== null) {
        const parsed = fillEvidenceSchema.safeParse(parseJson(completion.responseBody));
        status = parsed.success && parsed.data.fillEvidence.userId === trade.userId
          && parsed.data.fillEvidence.usedPrice === trade.actualFill
          && parsed.data.fillEvidence.usedQuantity === trade.shares
          && !!completion.orderId && ['invest', 'isa'].includes(completion.accountType)
          ? parsed.data.fillEvidence.source : 'INVALID_EVIDENCE';
      }
    }
    const drag = computeSingleDrag(trade, status);
    if (drag) records.push(drag);
  }

  // Aggregate
  const slippages = records.map((r) => r.entrySlippagePct).filter((v): v is number => v != null);
  const entryGapsR = records.map(record => record.entryGapR).filter((value): value is number => value !== null);

  const summary: ExecutionDragSummary = {
    measurement: 'PLANNED_TRIGGER_TO_FILL',
    eligibleEntryLogs: trades.length,
    totalTrades: records.length,
    withFills: records.filter(record => record.actualEntry !== null).length,
    fillEvidenceCounts: {
      LEGACY_UNVERIFIED: records.filter(record => record.fillEvidenceStatus === 'LEGACY_UNVERIFIED').length,
      INVALID_EVIDENCE: records.filter(record => record.fillEvidenceStatus === 'INVALID_EVIDENCE').length,
      PLANNED_ENTRY_FALLBACK: records.filter(record => record.fillEvidenceStatus === 'PLANNED_ENTRY_FALLBACK').length,
      ORDER_VALUE_OVER_QUANTITY: records.filter(record => record.fillEvidenceStatus === 'ORDER_VALUE_OVER_QUANTITY').length,
      HISTORY_HELPER: records.filter(record => record.fillEvidenceStatus === 'HISTORY_HELPER').length,
      TIMEOUT_RECOVERY: records.filter(record => record.fillEvidenceStatus === 'TIMEOUT_RECOVERY').length,
    },
    withEntryGapPct: slippages.length,
    withEntryGapR: entryGapsR.length,
    distinctMeasuredEntryDays: new Set(records.filter(record => record.entrySlippagePct !== null)
      .map(record => record.tradeDate.slice(0, 10))).size,
    avgEntrySlippagePct: slippages.length > 0 ? slippages.reduce((a, b) => a + b, 0) / slippages.length : null,
    medianEntrySlippagePct: median(slippages),
    p90EntrySlippagePct: percentile(slippages, 90),
    avgEntryGapR: entryGapsR.length > 0 ? entryGapsR.reduce((total, value) => total + value, 0) / entryGapsR.length : null,
    avgRDrag: null,
    medianRDrag: null,
    avgDaysToFill: null,
    totalSlippageCostGbp: null,
    limitations: [
      'Trigger-to-fill movement is not isolated broker slippage or recoverable profit.',
      'Entry-gap R assumes planned entry, initial stop and fill share the same price units and basis.',
      'Model outcome R, verified decision timing and quantity/FX cost evidence are not established here.',
      'Legacy slippage field names are retained; missing measurements are null, not zero.',
      'Legacy and source-labelled fills remain unverified; known planned fallbacks and invalid linked evidence are excluded. Unreadable trade IDs cannot be attributed.',
    ],
  };

  return { records, summary };
}
