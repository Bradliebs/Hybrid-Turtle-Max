/**
 * Tests for Phase 6 feature extraction and normalization.
 * Covers: extractRawFeatures, normalizeFeatures, extractFeatures, computeFeatureBounds
 */
import { describe, it, expect } from 'vitest';
import {
  FEATURE_NAMES,
  extractRawFeatures,
  normalizeFeatures,
  extractFeatures,
  computeFeatureBounds,
  DEFAULT_BOUNDS,
  type RawFeatureInput,
} from './feature-extract';

describe('extractRawFeatures', () => {
  it('extracts all features in correct order', () => {
    const input: RawFeatureInput = {
      ncs: 65,
      bqs: 70,
      fws: 20,
      adx: 30,
      atrPct: 2.5,
      regime: 'BULLISH',
      efficiency: 55,
      relativeStrength: 10,
      volRatio: 1.8,
      bisScore: 60,
      distancePct: 1.5,
      entropy63: 2.3,
      netIsolation: 0.6,
      smartMoney21: 500000,
      fractalDim: 1.35,
      complexity: 0.85,
    };

    const raw = extractRawFeatures(input);
    expect(raw).toHaveLength(FEATURE_NAMES.length);
    expect(raw[0]).toBe(65);   // ncs
    expect(raw[5]).toBe(1);    // regimeBullish = 1 for BULLISH
    expect(raw[13]).toBe(500000); // smartMoney21
  });

  it('encodes non-BULLISH regime as 0', () => {
    const input: RawFeatureInput = { regime: 'SIDEWAYS' };
    const raw = extractRawFeatures(input);
    expect(raw[5]).toBe(0); // regimeBullish
  });

  it('imputes nulls with medians', () => {
    const input: RawFeatureInput = {}; // All null
    const medians = DEFAULT_BOUNDS.medians;
    const raw = extractRawFeatures(input, medians);

    // Each value should equal the corresponding median
    for (let i = 0; i < FEATURE_NAMES.length; i++) {
      if (FEATURE_NAMES[i] === 'regimeBullish') {
        expect(raw[i]).toBe(0); // null regime → 0 (not bullish), but median overrides
        // Actually: regime is null → 0, then since 0 is finite, imputation doesn't apply
      } else {
        // Null values get imputed with median
        expect(raw[i]).toBe(medians[i]);
      }
    }
  });

  it('handles NaN and Infinity as null', () => {
    const input: RawFeatureInput = { ncs: NaN, bqs: Infinity };
    const raw = extractRawFeatures(input);
    // NaN and Infinity should be imputed with medians
    expect(Number.isFinite(raw[0])).toBe(true);
    expect(Number.isFinite(raw[1])).toBe(true);
  });
});

describe('normalizeFeatures', () => {
  it('normalizes to [0, 1] range', () => {
    const raw = [50, 50, 50, 30, 4, 1, 50, 0, 1.5, 50, 3, 2.5, 0.5, 0, 1.5, 1];
    const normalized = normalizeFeatures(raw);
    for (const v of normalized) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clamps values outside bounds', () => {
    const bounds = { min: [0], max: [100], medians: [50] };
    expect(normalizeFeatures([150], bounds)[0]).toBe(1);
    expect(normalizeFeatures([-50], bounds)[0]).toBe(0);
  });

  it('returns 0.5 for zero-range bounds', () => {
    const bounds = { min: [5], max: [5], medians: [5] };
    expect(normalizeFeatures([5], bounds)[0]).toBe(0.5);
  });
});

describe('extractFeatures', () => {
  it('returns normalized feature vector', () => {
    const input: RawFeatureInput = {
      ncs: 65,
      bqs: 70,
      fws: 20,
      adx: 30,
    };
    const features = extractFeatures(input);
    expect(features).toHaveLength(FEATURE_NAMES.length);
    for (const v of features) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('computeFeatureBounds', () => {
  it('computes min, max, median from data', () => {
    const vectors = [
      [10, 20],
      [30, 40],
      [50, 60],
    ];
    const bounds = computeFeatureBounds(vectors);
    expect(bounds.min[0]).toBe(10);
    expect(bounds.max[0]).toBe(50);
    expect(bounds.medians[0]).toBe(30);
    expect(bounds.min[1]).toBe(20);
    expect(bounds.max[1]).toBe(60);
    expect(bounds.medians[1]).toBe(40);
  });

  it('handles even number of samples for median', () => {
    const vectors = [
      [10],
      [20],
      [30],
      [40],
    ];
    const bounds = computeFeatureBounds(vectors);
    expect(bounds.medians[0]).toBe(25); // (20+30)/2
  });

  it('returns defaults for empty input', () => {
    const bounds = computeFeatureBounds([]);
    expect(bounds).toEqual(DEFAULT_BOUNDS);
  });
});
