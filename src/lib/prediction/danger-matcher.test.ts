import { describe, it, expect } from 'vitest';
import { environmentSimilarity, computeDangerScore } from './danger-matcher';
import { encodeEnvironment, type MarketEnvironment } from './environment-encoder';

/**
 * The point of these tests is discrimination. Before 29 July 2026 the matcher
 * used cosine similarity, which inflated the middle of the range — a moderately
 * stressed market scored 79 against the March-2020 fingerprint and tripped the
 * 75 immune-alert line. These tests fail if that regresses.
 */

const CALM: MarketEnvironment = {
  vix: 13,
  vixChange5d: 0,
  spyMomentum20d: 3,
  spyVolatilityRealised10d: 9,
  drsScore: 78,
  averagePortfolioCorrelation: 0.35,
  daysInCurrentRegime: 30,
};

const CRASH: MarketEnvironment = {
  vix: 65,
  vixChange5d: 80,
  spyMomentum20d: -15,
  spyVolatilityRealised10d: 80,
  drsScore: 15,
  averagePortfolioCorrelation: 0.85,
  daysInCurrentRegime: 1,
};

const CRASH_THREAT = {
  id: 1,
  label: 'March 2020 — COVID crash',
  vector: encodeEnvironment(CRASH),
  severity: 95,
};

describe('environmentSimilarity', () => {
  it('returns 1 for an identical environment', () => {
    const vec = encodeEnvironment(CRASH);
    expect(environmentSimilarity(vec, vec)).toBe(1);
  });

  it('returns 0 for opposite extremes on every reading', () => {
    expect(environmentSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
  });

  it('returns 0 for mismatched or empty vectors', () => {
    expect(environmentSimilarity([0.5, 0.5], [0.5])).toBe(0);
    expect(environmentSimilarity([], [])).toBe(0);
  });

  it('scores a calm day far below a crash against the same crash fingerprint', () => {
    const crashVec = encodeEnvironment(CRASH);
    const calmSimilarity = environmentSimilarity(encodeEnvironment(CALM), crashVec);
    const crashSimilarity = environmentSimilarity(crashVec, crashVec);

    // The whole reason cosine was replaced: this gap needs to be large.
    expect(crashSimilarity - calmSimilarity).toBeGreaterThan(0.5);
  });
});

describe('computeDangerScore', () => {
  it('returns a zeroed result when the threat library is empty', () => {
    const result = computeDangerScore(encodeEnvironment(CRASH), []);
    expect(result).toEqual({
      dangerScore: 0,
      immuneAlert: false,
      riskTightening: 0,
      topMatches: [],
    });
  });

  it('scores a calm market low and does not raise an immune alert', () => {
    const result = computeDangerScore(encodeEnvironment(CALM), [CRASH_THREAT]);
    expect(result.dangerScore).toBeLessThan(50);
    expect(result.immuneAlert).toBe(false);
    expect(result.riskTightening).toBe(0);
  });

  it('scores a matching crash high and raises an immune alert', () => {
    const result = computeDangerScore(encodeEnvironment(CRASH), [CRASH_THREAT]);
    expect(result.dangerScore).toBeGreaterThan(75);
    expect(result.immuneAlert).toBe(true);
    expect(result.riskTightening).toBeGreaterThan(0);
  });

  it('scores a moderately stressed market as elevated but below the alert line', () => {
    const STRESSED: MarketEnvironment = {
      vix: 26,
      vixChange5d: 25,
      spyMomentum20d: -6,
      spyVolatilityRealised10d: 22,
      drsScore: 45,
      averagePortfolioCorrelation: 0.6,
      daysInCurrentRegime: 6,
    };
    const result = computeDangerScore(encodeEnvironment(STRESSED), [CRASH_THREAT]);
    expect(result.dangerScore).toBeGreaterThan(50);
    expect(result.immuneAlert).toBe(false);
  });

  it('separates calm from crash by a wide margin', () => {
    const calm = computeDangerScore(encodeEnvironment(CALM), [CRASH_THREAT]).dangerScore;
    const crash = computeDangerScore(encodeEnvironment(CRASH), [CRASH_THREAT]).dangerScore;
    expect(crash - calm).toBeGreaterThan(40);
  });

  it('ranks a severe threat above a mild one at equal similarity', () => {
    const vec = encodeEnvironment(CRASH);
    const result = computeDangerScore(vec, [
      { id: 1, label: 'mild', vector: vec, severity: 20 },
      { id: 2, label: 'severe', vector: vec, severity: 95 },
    ]);
    expect(result.topMatches[0].label).toBe('severe');
  });

  it('caps riskTightening at 20 percent', () => {
    const vec = encodeEnvironment(CRASH);
    const result = computeDangerScore(vec, [{ id: 1, label: 'max', vector: vec, severity: 100 }]);
    expect(result.riskTightening).toBeLessThanOrEqual(0.2);
  });
});
