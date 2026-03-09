/**
 * DEPENDENCIES
 * Consumed by: packages/portfolio/src/review.ts, src/app/api/review/summary/route.ts, src/app/planned-trades/page.tsx, src/app/stops/page.tsx, src/app/orders/page.tsx, src/app/jobs/page.tsx, src/components/dashboard/EveningReviewSummary.tsx
 * Consumes: packages/stops/src/types.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 review/dashboard projection contracts.
 */
import type { StopDashboardData } from '../../stops/src/types';

export type DataFreshnessStatus = 'FRESH' | 'PARTIAL' | 'STALE' | 'UNKNOWN';

export interface EveningReviewSummary {
  currency: string;
  accountEquity: number | null;
  cash: number | null;
  openPositions: number;
  openRisk: number;
  protectedPositions: number;
  unprotectedPositions: number;
  tonightCandidateCount: number;
  tonightApprovedPlanCount: number;
  latestBrokerSyncStatus: string | null;
  latestBrokerSyncAt: string | null;
  latestDataFreshnessStatus: DataFreshnessStatus;
  latestDataRefreshAt: string | null;
  staleSymbolCount: number;
}

export interface PlannedTradeReviewRow {
  id: string;
  symbol: string;
  side: string;
  status: string;
  plannedQuantity: number;
  plannedEntryType: string;
  plannedEntryPrice: number;
  plannedStopPrice: number;
  rationale: string;
  riskApproved: boolean | null;
  riskRationale: string | null;
  notes: string | null;
  executionSessionDate: string;
  createdAt: string;
  brokerOrderStatus: string | null;
}

export interface OrderReviewRow {
  id: string;
  brokerOrderId: string;
  symbol: string;
  side: string;
  status: string;
  orderType: string;
  quantity: number;
  filledQuantity: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  averageFillPrice: number | null;
  accountType: string | null;
  submittedAt: string | null;
  updatedAt: string;
  plannedTradeId: string | null;
}

export interface JobReviewRow {
  id: string;
  jobName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  summary: string | null;
}

export interface AuditEventReviewRow {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface EveningReviewData {
  summary: EveningReviewSummary;
  plannedTrades: PlannedTradeReviewRow[];
  stops: StopDashboardData;
  orders: OrderReviewRow[];
  jobs: JobReviewRow[];
  auditEvents: AuditEventReviewRow[];
}