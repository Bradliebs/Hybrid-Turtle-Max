import { env } from '../../config/src/env';
import { getAccountRiskState, assessTradeRisk } from '../../risk/src';
import { getLatestSignalRunWithCandidates, getLatestPortfolioState, findExistingPlannedTrade, createPlannedTradeFromCandidate, getNextExecutionSessionDate } from './repository';
import type { NextSessionPlanResult } from './types';

export async function buildNextSessionPlan(): Promise<NextSessionPlanResult> {
  const latestSignalRun = await getLatestSignalRunWithCandidates();
  const { snapshot, positions } = await getLatestPortfolioState();
  const executionSessionDate = getNextExecutionSessionDate();
  const createdTrades: string[] = [];
  const skippedSymbols: string[] = [];

  if (!latestSignalRun) {
    return {
      executionSessionDate: executionSessionDate.toISOString(),
      createdTrades,
      skippedSymbols,
    };
  }

  const openSymbols = new Set(positions.map((position) => position.symbol));
  const accountState = await getAccountRiskState();

  const actionable = latestSignalRun.candidates
    .filter((candidate) => ['READY_NEXT_SESSION', 'READY_ON_TRIGGER'].includes(candidate.setupStatus))
    .slice(0, env.EVENING_PLAN_MAX_TRADES);

  for (const candidate of actionable) {
    if (openSymbols.has(candidate.symbol)) {
      skippedSymbols.push(candidate.symbol);
      continue;
    }

    const existing = await findExistingPlannedTrade(candidate.symbol, executionSessionDate);
    if (existing) {
      skippedSymbols.push(candidate.symbol);
      continue;
    }

    const currentPrice = typeof candidate.currentPrice === 'number' ? candidate.currentPrice : 0;
    const triggerPrice = typeof candidate.triggerPrice === 'number' ? candidate.triggerPrice : currentPrice;
    const initialStop = typeof candidate.initialStop === 'number' ? candidate.initialStop : currentPrice;
    const riskPerShare = typeof candidate.riskPerShare === 'number' ? candidate.riskPerShare : 0;

    if (currentPrice <= 0 || riskPerShare <= 0 || accountState.cashBalance <= 0) {
      skippedSymbols.push(candidate.symbol);
      continue;
    }

    // Risk assessment gates the trade
    const assessment = assessTradeRisk(candidate.symbol, triggerPrice, initialStop, accountState);

    if (!assessment.approved) {
      skippedSymbols.push(candidate.symbol);
      continue;
    }

    const quantity = assessment.sizing.recommendedShares;
    if (quantity < 1) {
      skippedSymbols.push(candidate.symbol);
      continue;
    }

    const trade = await createPlannedTradeFromCandidate(
      {
        symbol: candidate.symbol,
        currentPrice,
        triggerPrice,
        initialStop,
        stopDistancePercent: typeof candidate.stopDistancePercent === 'number' ? candidate.stopDistancePercent : 0,
        riskPerShare,
        setupStatus: candidate.setupStatus,
        rankScore: typeof candidate.rankScore === 'number' ? candidate.rankScore : 0,
        reasons: Array.isArray(candidate.reasonsJson) ? (candidate.reasonsJson as string[]) : [],
        warnings: Array.isArray(candidate.warningsJson) ? (candidate.warningsJson as string[]) : [],
      },
      executionSessionDate,
      quantity,
      {
        riskPerTrade: assessment.sizing.riskPerTrade,
        riskApproved: assessment.approved,
        riskRationale: assessment.rationale,
        riskViolationsJson: assessment.violations,
      },
    );

    createdTrades.push(trade.symbol);
  }

  return {
    executionSessionDate: executionSessionDate.toISOString(),
    createdTrades,
    skippedSymbols,
  };
}