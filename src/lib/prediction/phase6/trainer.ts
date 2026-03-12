/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/phase6 route
 * Consumes: feature-extract.ts, ridge-model.ts, prisma.ts
 * Risk-sensitive: NO — reads closed trade data, trains advisory model
 * Last modified: 2026-03-11
 * Notes: Pulls closed trades with score breakdowns from the DB,
 *        trains a Ridge regression to predict rMultiple from signal features.
 *        Time-series split (first 70% train, last 30% test) — never random.
 *        This runs manually via API, NOT in the nightly pipeline.
 */

import prisma from '@/lib/prisma';
import {
  FEATURE_NAMES,
  extractRawFeatures,
  normalizeFeatures,
  computeFeatureBounds,
  type RawFeatureInput,
  type FeatureBounds,
} from './feature-extract';
import {
  trainRidge,
  computeMetrics,
  computeFeatureImportance,
  type ModelWeights,
} from './ridge-model';
import * as fs from 'fs';
import * as path from 'path';

// ── Constants ──────────────────────────────────────────────────────

const MODEL_WEIGHTS_PATH = path.join(process.cwd(), 'prisma', 'cache', 'phase6-model-weights.json');
const TRAIN_SPLIT = 0.7;
const MIN_TRAINING_SAMPLES = 8; // Need at least 8 samples for meaningful Ridge
const RIDGE_LAMBDA = 1.0; // Regularization strength

// ── Types ──────────────────────────────────────────────────────────

export interface TrainingResult {
  success: boolean;
  message: string;
  totalTrades: number;
  trainSize: number;
  testSize: number;
  metrics?: {
    r2: number;
    mae: number;
    rmse: number;
    trainR2: number;
  };
  featureImportance?: {
    feature: string;
    importance: number;
    coefficient: number;
  }[];
  weightsPath?: string;
}

// ── Training Data Extraction ───────────────────────────────────────

interface TrainingRow {
  outcomeR: number;
  features: RawFeatureInput;
  tradeDate: Date;
}

/**
 * Pull closed trades with complete signal data from the database.
 * Uses ScoreBreakdown (has outcomeR) + linked SnapshotTicker data.
 */
async function getTrainingData(): Promise<TrainingRow[]> {
  // Get score breakdowns with actual trade outcomes
  const breakdowns = await prisma.scoreBreakdown.findMany({
    where: {
      outcomeR: { not: null },
      tradeLogId: { not: null },
    },
    orderBy: { scoredAt: 'asc' }, // Time-series order (oldest first)
  });

  // Get linked trade logs for date/ticker info
  const tradeLogIds = breakdowns.map((b) => b.tradeLogId).filter((id): id is string => id != null);
  const tradeLogs = tradeLogIds.length > 0
    ? await prisma.tradeLog.findMany({
        where: { id: { in: tradeLogIds } },
        select: { id: true, tradeDate: true, ticker: true, regime: true, adxAtEntry: true, atrAtEntry: true },
      })
    : [];
  const tradeLogMap = new Map(tradeLogs.map((tl) => [tl.id, tl]));

  const rows: TrainingRow[] = [];

  for (const bd of breakdowns) {
    if (bd.outcomeR == null || !bd.tradeLogId) continue;
    const tl = tradeLogMap.get(bd.tradeLogId);
    if (!tl) continue;

    // Find the closest SnapshotTicker for this ticker near the trade date
    const tradeDate = tl.tradeDate;
    const ticker = bd.ticker || tl.ticker;

    const snapshot = await prisma.snapshotTicker.findFirst({
      where: {
        ticker,
        createdAt: {
          gte: new Date(tradeDate.getTime() - 7 * 24 * 60 * 60 * 1000), // up to 7 days before
          lte: new Date(tradeDate.getTime() + 2 * 24 * 60 * 60 * 1000), // up to 2 days after
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    rows.push({
      outcomeR: bd.outcomeR,
      tradeDate,
      features: {
        ncs: bd.ncsTotal,
        bqs: bd.bqsTotal,
        fws: bd.fwsTotal,
        adx: snapshot?.adx14 ?? tl.adxAtEntry,
        atrPct: snapshot?.atrPct ?? null,
        regime: snapshot?.marketRegime ?? tl.regime,
        efficiency: null, // not in ScoreBreakdown, use snapshot if available
        relativeStrength: snapshot?.rsVsBenchmarkPct ?? null,
        volRatio: snapshot?.volRatio ?? null,
        bisScore: snapshot?.bisScore ?? null,
        distancePct: snapshot?.distanceTo20dHighPct ?? null,
        entropy63: snapshot?.entropy63 ?? null,
        netIsolation: snapshot?.netIsolation ?? null,
        smartMoney21: snapshot?.smartMoney21 ?? null,
        fractalDim: snapshot?.fractalDim ?? null,
        complexity: snapshot?.complexity ?? null,
      },
    });
  }

  return rows;
}

// ── Training ───────────────────────────────────────────────────────

/**
 * Train the Phase 6 prediction model.
 * Uses time-series split (first 70% train, last 30% test).
 * Saves weights to JSON for runtime use.
 */
export async function trainModel(): Promise<TrainingResult> {
  // 1. Pull training data
  const allData = await getTrainingData();

  if (allData.length < MIN_TRAINING_SAMPLES) {
    return {
      success: false,
      message: `Not enough training data: ${allData.length} trades (need ${MIN_TRAINING_SAMPLES}). Close more trades to accumulate data.`,
      totalTrades: allData.length,
      trainSize: 0,
      testSize: 0,
    };
  }

  // 2. Time-series split (data is already sorted by tradeDate ASC)
  const splitIdx = Math.floor(allData.length * TRAIN_SPLIT);
  const trainData = allData.slice(0, splitIdx);
  const testData = allData.slice(splitIdx);

  if (trainData.length < 5 || testData.length < 2) {
    return {
      success: false,
      message: `Insufficient data for train/test split: ${trainData.length} train, ${testData.length} test.`,
      totalTrades: allData.length,
      trainSize: trainData.length,
      testSize: testData.length,
    };
  }

  // 3. Extract raw feature vectors
  const trainRaw = trainData.map((d) => extractRawFeatures(d.features));
  const testRaw = testData.map((d) => extractRawFeatures(d.features));
  const trainY = trainData.map((d) => d.outcomeR);
  const testY = testData.map((d) => d.outcomeR);

  // 4. Compute feature bounds from training data only (prevents data leakage)
  const bounds = computeFeatureBounds(trainRaw);

  // 5. Normalize features
  const trainX = trainRaw.map((r) => normalizeFeatures(r, bounds));
  const testX = testRaw.map((r) => normalizeFeatures(r, bounds));

  // 6. Train Ridge regression
  const { coefficients, intercept } = trainRidge(trainX, trainY, RIDGE_LAMBDA);

  // 7. Evaluate
  const trainMetrics = computeMetrics(trainX, trainY, coefficients, intercept);
  const testMetrics = computeMetrics(testX, testY, coefficients, intercept);

  // 8. Feature importance
  const importance = computeFeatureImportance(coefficients, FEATURE_NAMES);

  // 9. Save weights
  const weights: ModelWeights = {
    coefficients,
    intercept,
    lambda: RIDGE_LAMBDA,
    featureBounds: bounds,
    metrics: {
      r2: testMetrics.r2,
      mae: testMetrics.mae,
      rmse: testMetrics.rmse,
      trainR2: trainMetrics.r2,
    },
    trainedAt: new Date().toISOString(),
    trainingSamples: trainData.length,
    testSamples: testData.length,
  };

  // Ensure cache directory exists
  const cacheDir = path.dirname(MODEL_WEIGHTS_PATH);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(MODEL_WEIGHTS_PATH, JSON.stringify(weights, null, 2));

  console.log(`[phase6] Model trained: R²=${testMetrics.r2}, MAE=${testMetrics.mae}, ${allData.length} trades`);

  return {
    success: true,
    message: `Model trained on ${trainData.length} trades, tested on ${testData.length}. Test R²=${testMetrics.r2}, MAE=${testMetrics.mae}R`,
    totalTrades: allData.length,
    trainSize: trainData.length,
    testSize: testData.length,
    metrics: {
      r2: testMetrics.r2,
      mae: testMetrics.mae,
      rmse: testMetrics.rmse,
      trainR2: trainMetrics.r2,
    },
    featureImportance: importance,
    weightsPath: MODEL_WEIGHTS_PATH,
  };
}

// ── Model Status ───────────────────────────────────────────────────

export interface ModelStatus {
  hasModel: boolean;
  trainedAt: string | null;
  daysSinceTraining: number | null;
  trainingSamples: number | null;
  testSamples: number | null;
  metrics: ModelWeights['metrics'] | null;
  featureImportance: {
    feature: string;
    importance: number;
    coefficient: number;
  }[] | null;
  availableTrades: number;
}

/**
 * Get current model status without training.
 */
export async function getModelStatus(): Promise<ModelStatus> {
  // Count available trades
  const tradeCount = await prisma.scoreBreakdown.count({
    where: {
      outcomeR: { not: null },
      tradeLogId: { not: null },
    },
  });

  // Check for saved weights
  if (!fs.existsSync(MODEL_WEIGHTS_PATH)) {
    return {
      hasModel: false,
      trainedAt: null,
      daysSinceTraining: null,
      trainingSamples: null,
      testSamples: null,
      metrics: null,
      featureImportance: null,
      availableTrades: tradeCount,
    };
  }

  try {
    const raw = fs.readFileSync(MODEL_WEIGHTS_PATH, 'utf-8');
    const weights: ModelWeights = JSON.parse(raw);

    const trainedDate = new Date(weights.trainedAt);
    const daysSince = Math.floor((Date.now() - trainedDate.getTime()) / (1000 * 60 * 60 * 24));

    const importance = computeFeatureImportance(weights.coefficients, FEATURE_NAMES);

    return {
      hasModel: true,
      trainedAt: weights.trainedAt,
      daysSinceTraining: daysSince,
      trainingSamples: weights.trainingSamples,
      testSamples: weights.testSamples,
      metrics: weights.metrics,
      featureImportance: importance,
      availableTrades: tradeCount,
    };
  } catch {
    return {
      hasModel: false,
      trainedAt: null,
      daysSinceTraining: null,
      trainingSamples: null,
      testSamples: null,
      metrics: null,
      featureImportance: null,
      availableTrades: tradeCount,
    };
  }
}
