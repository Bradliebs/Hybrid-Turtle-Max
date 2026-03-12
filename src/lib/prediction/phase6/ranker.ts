/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/phase6 route, scan output enrichment
 * Consumes: feature-extract.ts, ridge-model.ts, prisma.ts
 * Risk-sensitive: NO — advisory ranking only, never gates or blocks trades
 * Last modified: 2026-03-11
 * Notes: Ranks READY candidates by predicted rMultiple using the trained
 *        Phase 6 Ridge model. Falls back to NCS ranking if model weights
 *        are missing or stale. Output is display-only.
 */

import { extractFeatures, type RawFeatureInput } from './feature-extract';
import { predict, computeFeatureImportance, type ModelWeights } from './ridge-model';
import { FEATURE_NAMES } from './feature-extract';
import * as fs from 'fs';
import * as path from 'path';

// ── Constants ──────────────────────────────────────────────────────

const MODEL_WEIGHTS_PATH = path.join(process.cwd(), 'prisma', 'cache', 'phase6-model-weights.json');
const MAX_MODEL_AGE_DAYS = 30; // Warn if model is older than this

// ── Types ──────────────────────────────────────────────────────────

export interface RankedCandidate {
  ticker: string;
  ncs: number | null;
  predictedR: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MODEL';
  features: RawFeatureInput;
}

export interface RankingResult {
  candidates: RankedCandidate[];
  modelUsed: boolean;
  modelAge: number | null;
  fallbackReason: string | null;
}

// ── Model Loading ──────────────────────────────────────────────────

let cachedWeights: ModelWeights | null = null;
let cachedWeightsModTime = 0;

/**
 * Load model weights with file-level caching.
 * Re-reads from disk if the file has been modified.
 */
function loadWeights(): ModelWeights | null {
  if (!fs.existsSync(MODEL_WEIGHTS_PATH)) return null;

  try {
    const stat = fs.statSync(MODEL_WEIGHTS_PATH);
    if (cachedWeights && stat.mtimeMs === cachedWeightsModTime) {
      return cachedWeights;
    }

    const raw = fs.readFileSync(MODEL_WEIGHTS_PATH, 'utf-8');
    cachedWeights = JSON.parse(raw) as ModelWeights;
    cachedWeightsModTime = stat.mtimeMs;
    return cachedWeights;
  } catch {
    return null;
  }
}

// ── Ranking ────────────────────────────────────────────────────────

/**
 * Rank READY candidates by predicted R-multiple.
 * Falls back to NCS ranking if model weights are missing or stale.
 *
 * @param candidates Array of candidates with their signal snapshots
 * @returns Ranked candidates with predicted R-multiple and confidence
 */
export function rankReadyCandidates(
  candidates: { ticker: string; features: RawFeatureInput }[]
): RankingResult {
  const weights = loadWeights();

  // Graceful degradation: no model → fall back to NCS ranking
  if (!weights) {
    return {
      candidates: candidates.map((c) => ({
        ticker: c.ticker,
        ncs: c.features.ncs ?? null,
        predictedR: null,
        confidence: 'NO_MODEL' as const,
        features: c.features,
      })).sort((a, b) => (b.ncs ?? 0) - (a.ncs ?? 0)),
      modelUsed: false,
      modelAge: null,
      fallbackReason: 'No model weights found — train the model first',
    };
  }

  // Check model age
  const trainedDate = new Date(weights.trainedAt);
  const modelAgeDays = Math.floor((Date.now() - trainedDate.getTime()) / (1000 * 60 * 60 * 24));
  const isStale = modelAgeDays > MAX_MODEL_AGE_DAYS;

  if (isStale) {
    return {
      candidates: candidates.map((c) => ({
        ticker: c.ticker,
        ncs: c.features.ncs ?? null,
        predictedR: null,
        confidence: 'NO_MODEL' as const,
        features: c.features,
      })).sort((a, b) => (b.ncs ?? 0) - (a.ncs ?? 0)),
      modelUsed: false,
      modelAge: modelAgeDays,
      fallbackReason: `Model is ${modelAgeDays} days old (max ${MAX_MODEL_AGE_DAYS}). Retrain to use predictions.`,
    };
  }

  // Predict for each candidate
  const ranked: RankedCandidate[] = candidates.map((c) => {
    const featureVec = extractFeatures(c.features, weights.featureBounds);
    const predictedR = predict(featureVec, weights.coefficients, weights.intercept);

    // Confidence based on model quality + how many features are available
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    const testR2 = weights.metrics.r2;
    const nullCount = Object.values(c.features).filter((v) => v == null).length;

    if (testR2 > 0.15 && nullCount <= 3) confidence = 'HIGH';
    else if (testR2 > 0.05 && nullCount <= 6) confidence = 'MEDIUM';

    return {
      ticker: c.ticker,
      ncs: c.features.ncs ?? null,
      predictedR: Math.round(predictedR * 100) / 100,
      confidence,
      features: c.features,
    };
  });

  // Sort by predicted R (descending)
  ranked.sort((a, b) => (b.predictedR ?? 0) - (a.predictedR ?? 0));

  const topPick = ranked[0];
  if (topPick) {
    console.log(
      `[prediction] Ranked ${ranked.length} READY candidates, ` +
      `top pick: ${topPick.ticker} (predicted R: ${topPick.predictedR})`
    );
  }

  return {
    candidates: ranked,
    modelUsed: true,
    modelAge: modelAgeDays,
    fallbackReason: null,
  };
}
