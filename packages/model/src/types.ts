/**
 * DEPENDENCIES
 * Consumed by: packages/model/src/service.ts, packages/model/src/index.ts, src/app/api/models/*, scripts/verify-phase12.ts
 * Consumes: src/types/index.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Shared Phase 12 model-layer types.
 */
import type { MarketRegime, ScanCandidate } from '../../../src/types';

export interface ModelLayerSettings {
  enabled: boolean;
  blendWeight?: number;
  suppressWeakSetups?: boolean;
}

export interface ModelVersionManifest {
  candidateModelVersion: string;
  breakoutModelVersion: string;
  regimeModelVersion: string;
  ensembleVersion: string;
}

export interface RegimePrediction {
  regime: MarketRegime;
  confidence: number;
  uncertainty: number;
}

export interface CandidateModelPrediction {
  baseSystemScore: number;
  modelScore: number;
  blendedScore: number;
  breakoutProbability: number;
  confidence: number;
  uncertainty: number;
  predictedRegime: MarketRegime;
  recommendation: 'PROMOTE' | 'NEUTRAL' | 'SUPPRESS';
  version: string;
  featureTimestamp: string;
}

export interface CandidateModelResult {
  candidates: ScanCandidate[];
  settings: Required<ModelLayerSettings>;
  versions: ModelVersionManifest;
}