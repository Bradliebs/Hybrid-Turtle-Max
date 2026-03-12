/**
 * DEPENDENCIES
 * Consumed by: trainer.ts, ranker.ts
 * Consumes: (standalone — operates on snapshot/score data)
 * Risk-sensitive: NO — passive feature extraction for advisory prediction
 * Last modified: 2026-03-11
 * Notes: Extracts and normalizes feature vectors from SnapshotTicker / ScoreBreakdown
 *        data for the Phase 6 prediction engine. All features are read-only derivations.
 *        Never modifies source data or affects scan engine decisions.
 */

// ── Feature Names (ordered) ────────────────────────────────────────

export const FEATURE_NAMES = [
  'ncs',
  'bqs',
  'fws',
  'adx',
  'atrPct',
  'regimeBullish',
  'efficiency',
  'relativeStrength',
  'volRatio',
  'bisScore',
  'distancePct',
  'entropy63',
  'netIsolation',
  'smartMoney21',
  'fractalDim',
  'complexity',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

// ── Types ──────────────────────────────────────────────────────────

/** Raw input data for feature extraction — fields from SnapshotTicker + scores */
export interface RawFeatureInput {
  ncs?: number | null;
  bqs?: number | null;
  fws?: number | null;
  adx?: number | null;
  atrPct?: number | null;
  regime?: string | null;
  efficiency?: number | null;
  relativeStrength?: number | null;
  volRatio?: number | null;
  bisScore?: number | null;
  distancePct?: number | null;
  entropy63?: number | null;
  netIsolation?: number | null;
  smartMoney21?: number | null;
  fractalDim?: number | null;
  complexity?: number | null;
}

/** Min/max bounds for each feature, computed from training data */
export interface FeatureBounds {
  min: number[];
  max: number[];
  medians: number[];
}

// ── Default Bounds ─────────────────────────────────────────────────

/** Sensible defaults before training data is available */
export const DEFAULT_BOUNDS: FeatureBounds = {
  min: [
    -30,   // ncs
    0,     // bqs
    0,     // fws
    0,     // adx
    0,     // atrPct
    0,     // regimeBullish
    0,     // efficiency
    -50,   // relativeStrength
    0,     // volRatio
    0,     // bisScore
    -5,    // distancePct
    0,     // entropy63
    0,     // netIsolation
    -1e9,  // smartMoney21
    1.0,   // fractalDim
    0,     // complexity
  ],
  max: [
    100,   // ncs
    100,   // bqs
    100,   // fws
    60,    // adx
    8,     // atrPct
    1,     // regimeBullish
    100,   // efficiency
    50,    // relativeStrength
    5,     // volRatio
    100,   // bisScore
    30,    // distancePct
    4,     // entropy63
    1,     // netIsolation
    1e9,   // smartMoney21
    2.0,   // fractalDim
    2,     // complexity
  ],
  medians: [
    50,    // ncs
    50,    // bqs
    30,    // fws
    25,    // adx
    3,     // atrPct
    1,     // regimeBullish
    50,    // efficiency
    0,     // relativeStrength
    1.5,   // volRatio
    50,    // bisScore
    3,     // distancePct
    2.5,   // entropy63
    0.5,   // netIsolation
    0,     // smartMoney21
    1.5,   // fractalDim
    1,     // complexity
  ],
};

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Extract a raw (unnormalized) feature vector from input data.
 * Null/missing values are imputed with the corresponding median.
 */
export function extractRawFeatures(
  input: RawFeatureInput,
  medians: number[] = DEFAULT_BOUNDS.medians
): number[] {
  const raw: (number | null | undefined)[] = [
    input.ncs,
    input.bqs,
    input.fws,
    input.adx,
    input.atrPct,
    input.regime === 'BULLISH' ? 1 : 0,
    input.efficiency,
    input.relativeStrength,
    input.volRatio,
    input.bisScore,
    input.distancePct,
    input.entropy63,
    input.netIsolation,
    input.smartMoney21,
    input.fractalDim,
    input.complexity,
  ];

  // Impute nulls with median
  return raw.map((v, i) => (v != null && Number.isFinite(v) ? v : medians[i]));
}

/**
 * Normalize a raw feature vector to [0, 1] range using min-max scaling.
 */
export function normalizeFeatures(
  raw: number[],
  bounds: FeatureBounds = DEFAULT_BOUNDS
): number[] {
  return raw.map((v, i) => {
    const range = bounds.max[i] - bounds.min[i];
    if (range === 0) return 0.5;
    return Math.max(0, Math.min(1, (v - bounds.min[i]) / range));
  });
}

/**
 * Extract a normalized feature vector ready for model input.
 */
export function extractFeatures(
  input: RawFeatureInput,
  bounds: FeatureBounds = DEFAULT_BOUNDS
): number[] {
  const raw = extractRawFeatures(input, bounds.medians);
  return normalizeFeatures(raw, bounds);
}

/**
 * Compute feature bounds (min, max, median) from training data.
 */
export function computeFeatureBounds(rawVectors: number[][]): FeatureBounds {
  if (rawVectors.length === 0) return DEFAULT_BOUNDS;

  const nFeatures = FEATURE_NAMES.length;
  const mins: number[] = new Array(nFeatures).fill(Infinity);
  const maxs: number[] = new Array(nFeatures).fill(-Infinity);
  const columns: number[][] = Array.from({ length: nFeatures }, () => []);

  for (const vec of rawVectors) {
    for (let i = 0; i < nFeatures; i++) {
      const v = vec[i];
      if (v < mins[i]) mins[i] = v;
      if (v > maxs[i]) maxs[i] = v;
      columns[i].push(v);
    }
  }

  const medians = columns.map((col) => {
    const sorted = col.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  });

  return { min: mins, max: maxs, medians };
}
