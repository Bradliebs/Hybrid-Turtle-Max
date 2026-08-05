/**
 * DEPENDENCIES
 * Consumed by: threat-library.ts, /api/prediction/danger-level/route.ts
 * Consumes: environment-encoder.ts (types only)
 * Risk-sensitive: NO — pure math, no DB or position changes
 * Last modified: 2026-07-29
 * Notes: Per-feature closeness between environment vectors.
 *        Danger score = max similarity across top-K closest threats,
 *        weighted by threat severity.
 */

import type { EnvironmentVector } from './environment-encoder';

// ── Environment Similarity ───────────────────────────────────

/**
 * How closely does one market environment resemble another?
 *
 * Both vectors are already normalised to [0, 1] per feature by
 * environment-encoder.ts, so for each reading `1 - |a - b|` is the fraction
 * of the way from "opposite extremes" to "identical". Averaging across the
 * seven readings gives a plain-English number: 1.0 means today matches that
 * environment exactly, 0.0 means it is the opposite on every single reading.
 *
 * This replaced cosine similarity (removed 29 July 2026). Cosine compares the
 * DIRECTION of two vectors and ignores how far apart they actually are, which
 * inflated the middle of the range: measured against the March-2020 fingerprint,
 * a mildly choppy market (VIX 18, flat trend) scored 53 and a moderately
 * stressed one scored 79 — over the 75 immune-alert line. The badge cried wolf.
 * The same environments score 47 and 62 under absolute per-feature distance,
 * which is also far easier to explain to a human.
 */
export function environmentSimilarity(a: EnvironmentVector, b: EnvironmentVector): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let closenessSum = 0;
  for (let i = 0; i < a.length; i++) {
    closenessSum += 1 - Math.abs(a[i] - b[i]);
  }

  return closenessSum / a.length;
}

// ── Danger Score Computation ─────────────────────────────────

export interface ThreatMatch {
  threatId: number;
  label: string;
  similarity: number;
  severity: number;
  /** Weighted score = similarity × severity_weight */
  weightedScore: number;
}

export interface DangerResult {
  dangerScore: number;        // 0–100: overall danger level
  immuneAlert: boolean;       // true if dangerScore > 75
  /**
   * 0–0.2: SUGGESTED fraction to reduce max open risk by.
   * Advisory only — no caller applies this. risk-gates.ts and position-sizer.ts
   * never read it. Displayed in the danger drawer as a manual prompt.
   */
  riskTightening: number;
  topMatches: ThreatMatch[];  // top-5 closest threats
}

/** Threshold above which immune alert fires */
export const IMMUNE_ALERT_THRESHOLD = 0.75;

/** Top-K threats to consider for danger scoring */
const TOP_K = 5;

/**
 * Compute danger score from current environment vs threat library entries.
 *
 * @param currentVec - Normalised environment vector for current conditions
 * @param threats - Array of { id, label, vector, severity } from threat library
 * @returns DangerResult with score, alert status, and matches
 */
export function computeDangerScore(
  currentVec: EnvironmentVector,
  threats: Array<{ id: number; label: string; vector: EnvironmentVector; severity: number }>
): DangerResult {
  if (threats.length === 0) {
    return { dangerScore: 0, immuneAlert: false, riskTightening: 0, topMatches: [] };
  }

  // Compute similarity with each threat
  const matches: ThreatMatch[] = threats.map(t => {
    const similarity = environmentSimilarity(currentVec, t.vector);
    // Severity weights the match: a high-severity threat matching at 0.6 is worse
    // than a low-severity threat matching at 0.8
    const severityWeight = 0.5 + (t.severity / 100) * 0.5; // range 0.5–1.0
    const weightedScore = Math.max(0, similarity) * severityWeight;

    return {
      threatId: t.id,
      label: t.label,
      similarity: Math.round(similarity * 1000) / 1000,
      severity: t.severity,
      weightedScore: Math.round(weightedScore * 1000) / 1000,
    };
  });

  // Sort by weighted score descending, take top-K
  matches.sort((a, b) => b.weightedScore - a.weightedScore);
  const topMatches = matches.slice(0, TOP_K);

  // Danger score = max weighted score across top threats, scaled to 0–100
  const dangerScore = Math.round(Math.min(topMatches[0].weightedScore, 1) * 100);

  // Immune alert at threshold
  const immuneAlert = dangerScore > IMMUNE_ALERT_THRESHOLD * 100;

  // Risk tightening: linear from 0% at score=50 to 20% at score=100
  const riskTightening = dangerScore > 50
    ? Math.min(((dangerScore - 50) / 50) * 0.2, 0.2)
    : 0;

  return {
    dangerScore,
    immuneAlert,
    riskTightening: Math.round(riskTightening * 1000) / 1000,
    topMatches,
  };
}
