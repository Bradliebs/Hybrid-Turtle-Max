/**
 * DEPENDENCIES
 * Consumed by: src/app/api/models/*, src/app/api/scan/route.ts, scripts/verify-phase12.ts
 * Consumes: packages/model/src/service.ts, packages/model/src/types.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Public Phase 12 model-layer surface.
 */
export {
  applyModelLayerToCandidates,
  getModelVersions,
  predictBreakoutProbability,
  predictCandidateScore,
  predictRegime,
} from './service';
export type {
  CandidateModelPrediction,
  CandidateModelResult,
  ModelLayerSettings,
  ModelVersionManifest,
  RegimePrediction,
} from './types';