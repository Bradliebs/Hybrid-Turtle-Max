import prisma from './prisma';
import { getBatchPrices, getFXRate, normalizeBatchPricesToGBP } from './market-data';
import { validateRiskGates, type RiskGateResult } from './risk-gates';
import type { RiskProfileType, Sleeve } from '@/types';

export interface PreOrderRiskGateInput {
  userId: string;
  stockId: string;
  entryPrice: number;
  stopPrice: number;
  shares: number;
}

export interface PreOrderRiskGateResult {
  passed: boolean;
  failedGates: RiskGateResult[];
}

export async function validatePreOrderRiskGates(
  input: PreOrderRiskGateInput,
): Promise<PreOrderRiskGateResult> {
  const [user, newStock, existingPositions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { riskProfile: true, equity: true },
    }),
    prisma.stock.findUnique({ where: { id: input.stockId } }),
    prisma.position.findMany({
      where: { userId: input.userId, status: 'OPEN' },
      include: { stock: true },
    }),
  ]);

  if (!user || user.equity <= 0) {
    throw new Error('Account equity is unavailable for portfolio risk gates');
  }
  if (!newStock) {
    throw new Error('Stock is unavailable for portfolio risk gates');
  }

  const existingTickers = existingPositions.map((position) => position.stock.ticker);
  const existingPrices = existingTickers.length > 0 ? await getBatchPrices(existingTickers) : {};
  const existingCurrencies = Object.fromEntries(
    existingPositions.map((position) => [position.stock.ticker, position.stock.currency]),
  );
  const existingGbpPrices = existingTickers.length > 0
    ? await normalizeBatchPricesToGBP(existingPrices, existingCurrencies)
    : {};

  const positionsForGates = existingPositions.map((position) => {
    const rawPrice = existingPrices[position.stock.ticker] || position.entryPrice;
    const gbpPrice = existingGbpPrices[position.stock.ticker] ?? rawPrice;
    const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
    const entryPriceGbp = position.entryPrice * fxRatio;
    const currentStopGbp = position.currentStop * fxRatio;

    return {
      id: position.id,
      ticker: position.stock.ticker,
      sleeve: (position.stock.sleeve || 'CORE') as Sleeve,
      sector: position.stock.sector || 'Unknown',
      cluster: position.stock.cluster || 'General',
      value: entryPriceGbp * position.shares,
      riskDollars: Math.max(0, (gbpPrice - currentStopGbp) * position.shares),
      shares: position.shares,
      entryPrice: entryPriceGbp,
      currentStop: currentStopGbp,
      currentPrice: gbpPrice,
    };
  });

  const currency = (newStock.currency || 'USD').toUpperCase();
  const isUkInstrument = newStock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(newStock.ticker);
  const fxToGbp = isUkInstrument || currency === 'GBX'
    ? 0.01
    : currency === 'GBP'
      ? 1
      : await getFXRate(currency, 'GBP');

  const entryPriceGbp = input.entryPrice * fxToGbp;
  const stopPriceGbp = input.stopPrice * fxToGbp;
  const results = validateRiskGates(
    {
      sleeve: (newStock.sleeve || 'CORE') as Sleeve,
      sector: newStock.sector || 'Unknown',
      cluster: newStock.cluster || 'General',
      value: entryPriceGbp * input.shares,
      riskDollars: Math.max(0, (entryPriceGbp - stopPriceGbp) * input.shares),
    },
    positionsForGates,
    user.equity,
    (user.riskProfile || 'BALANCED') as RiskProfileType,
  );
  const failedGates = results.filter((result) => !result.passed);

  return { passed: failedGates.length === 0, failedGates };
}