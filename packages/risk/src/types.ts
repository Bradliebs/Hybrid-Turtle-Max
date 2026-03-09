/**
 * DEPENDENCIES
 * Consumed by: packages/risk/src/account-state.ts, packages/risk/src/sizing.ts, packages/risk/src/validation.ts, packages/workflow/src/plan.ts
 * Consumes: nothing
 * Risk-sensitive: NO — type definitions only
 * Last modified: 2026-03-08
 */

/** Unified account risk state snapshot for evening review and trade gating. */
export interface AccountRiskState {
  accountEquity: number;
  cashBalance: number;
  totalMarketValue: number;
  openPositionCount: number;
  totalOpenRisk: number;
  openRiskPct: number;
  concentrations: PositionConcentration[];
  missingStopCount: number;
}

export interface PositionConcentration {
  symbol: string;
  marketValue: number;
  weightPct: number;
}

/** Result of sizing a single candidate trade against the account state. */
export interface TradeSizingResult {
  symbol: string;
  recommendedShares: number;
  riskPerTrade: number;
  riskPerShare: number;
  entryPrice: number;
  stopPrice: number;
  stopDistancePct: number;
  positionValue: number;
  openRiskAfterTrade: number;
  openRiskPctAfterTrade: number;
}

/** A single risk rule violation. */
export interface RiskViolation {
  rule: string;
  message: string;
  severity: 'HARD' | 'SOFT';
}

/** Full risk assessment for a candidate trade. */
export interface TradeRiskAssessment {
  symbol: string;
  sizing: TradeSizingResult;
  violations: RiskViolation[];
  approved: boolean;
  rationale: string;
}
