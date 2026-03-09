export type TonightWorkflowActionKey =
  | 'refresh-data'
  | 'run-scan'
  | 'review-candidates'
  | 'review-risk'
  | 'generate-plan'
  | 'sync-broker'
  | 'verify-stops';

export interface EveningRefreshResult {
  runId: string;
  requestedSymbols: number;
  succeededSymbols: number;
  failedSymbols: number;
  staleSymbols: number;
}

export interface EveningScanCandidate {
  symbol: string;
  currentPrice: number;
  triggerPrice: number;
  initialStop: number;
  stopDistancePercent: number;
  riskPerShare: number;
  setupStatus: string;
  rankScore: number;
  reasons: string[];
  warnings: string[];
}

export interface EveningScanResult {
  signalRunId: string;
  scannedSymbols: number;
  staleSymbols: number;
  candidates: EveningScanCandidate[];
}

export interface CandidateReviewResult {
  signalRunId: string;
  countsByStatus: Record<string, number>;
  topCandidates: EveningScanCandidate[];
}

export interface RiskReviewResult {
  riskSnapshotId: string;
  positionsCount: number;
  missingStopsCount: number;
  totalOpenRisk: number;
  totalMarketValue: number;
  openRiskPctOfEquity: number | null;
  warnings: string[];
}

export interface NextSessionPlanResult {
  executionSessionDate: string;
  createdTrades: string[];
  skippedSymbols: string[];
}

export interface StopVerificationResult {
  positionsChecked: number;
  missingStopsCreated: number;
  verifiedStops: number;
  activeStops: number;
  missingStops: number;
  mismatchedStops: number;
  failedStops: number;
  closedStops: number;
}

export interface ReconciliationResult {
  brokerSyncRunId: string;
  discrepancyCount: number;
  positionsCount: number;
  ordersCount: number;
  stopVerification: StopVerificationResult;
}

export interface TonightWorkflowRunResult {
  workflowRunId: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  steps: Array<{
    key: TonightWorkflowActionKey;
    label: string;
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
    startedAt: string;
    finishedAt: string;
    details: Record<string, unknown>;
  }>;
}

export interface TonightWorkflowCardData {
  title: string;
  summary: {
    lastRunAt: string | null;
    lastRunStatus: string | null;
    currentSessionDate: string;
  };
  actions: Array<{
    key: TonightWorkflowActionKey;
    label: string;
    description: string;
    lastStatus: string | null;
    lastFinishedAt: string | null;
  }>;
  latestPlan: {
    executionSessionDate: string | null;
    draftTrades: number;
  };
}