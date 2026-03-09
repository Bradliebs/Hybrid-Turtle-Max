import { createRiskSnapshot, getLatestPortfolioState } from './repository';
import type { RiskReviewResult } from './types';

function round(value: number) {
  return Number(value.toFixed(4));
}

export async function reviewEveningRisk(): Promise<RiskReviewResult> {
  const { snapshot, positions } = await getLatestPortfolioState();
  const warnings: string[] = [];
  let totalOpenRisk = 0;
  let totalMarketValue = 0;
  let missingStopsCount = 0;

  for (const position of positions) {
    const marketValue = position.marketValue.toNumber();
    totalMarketValue += marketValue;
    const activeStop = position.protectiveStops.find((stop) => ['ACTIVE', 'SUBMITTED', 'PLANNED', 'MISMATCH'].includes(stop.status));

    if (!activeStop) {
      missingStopsCount += 1;
      warnings.push(`${position.symbol} has no verified protective stop.`);
      continue;
    }

    const stopPrice = activeStop.stopPrice.toNumber();
    const positionRisk = Math.max(position.marketPrice.toNumber() - stopPrice, 0) * position.quantity.toNumber();
    totalOpenRisk += positionRisk;
  }

  const accountEquity = snapshot?.equity.toNumber() ?? null;
  const openRiskPctOfEquity = accountEquity && accountEquity > 0 ? (totalOpenRisk / accountEquity) * 100 : null;

  if ((openRiskPctOfEquity ?? 0) > 8) {
    warnings.push('Open risk exceeds 8% of account equity.');
  }

  const riskLevel = missingStopsCount > 0 || (openRiskPctOfEquity ?? 0) > 8
    ? 'HIGH'
    : (openRiskPctOfEquity ?? 0) > 5
      ? 'MEDIUM'
      : 'LOW';

  const snapshotRecord = await createRiskSnapshot({
    openRisk: totalOpenRisk,
    accountEquity,
    cashBalance: snapshot?.cashBalance.toNumber() ?? null,
    concentrationJson: positions.map((position) => ({
      symbol: position.symbol,
      marketValue: position.marketValue.toNumber(),
      weightPct: totalMarketValue > 0 ? (position.marketValue.toNumber() / totalMarketValue) * 100 : 0,
    })),
    ruleViolationsJson: warnings,
    riskLevel,
  });

  return {
    riskSnapshotId: snapshotRecord.id,
    positionsCount: positions.length,
    missingStopsCount,
    totalOpenRisk: round(totalOpenRisk),
    totalMarketValue: round(totalMarketValue),
    openRiskPctOfEquity: openRiskPctOfEquity == null ? null : round(openRiskPctOfEquity),
    warnings,
  };
}