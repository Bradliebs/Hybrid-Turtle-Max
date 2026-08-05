import { describe, it, expect } from 'vitest';
import { encodeEnvironment, decodeVector, type MarketEnvironment } from './environment-encoder';

/** Realistic calm-market baseline. */
function calmEnvironment(overrides: Partial<MarketEnvironment> = {}): MarketEnvironment {
  return {
    vix: 14,
    vixChange5d: 0,
    spyMomentum20d: 3,
    spyVolatilityRealised10d: 12, // annualised %, typical SPY
    drsScore: 50,
    averagePortfolioCorrelation: 0.3,
    daysInCurrentRegime: 20,
    ...overrides,
  };
}

const REALISED_VOL_INDEX = 3;

describe('encodeEnvironment — realised volatility scale', () => {
  it('does not clamp a typical SPY annualised vol to the range edge', () => {
    const vec = encodeEnvironment(calmEnvironment({ spyVolatilityRealised10d: 12 }));
    expect(vec[REALISED_VOL_INDEX]).toBeGreaterThan(0);
    expect(vec[REALISED_VOL_INDEX]).toBeLessThan(1);
  });

  it('separates calm, stressed, and crisis realised vol', () => {
    const calm = encodeEnvironment(calmEnvironment({ spyVolatilityRealised10d: 8 }));
    const stressed = encodeEnvironment(calmEnvironment({ spyVolatilityRealised10d: 30 }));
    const crisis = encodeEnvironment(calmEnvironment({ spyVolatilityRealised10d: 80 }));

    expect(calm[REALISED_VOL_INDEX]).toBeLessThan(stressed[REALISED_VOL_INDEX]);
    expect(stressed[REALISED_VOL_INDEX]).toBeLessThan(crisis[REALISED_VOL_INDEX]);
  });

  it('still clamps values outside the historical range', () => {
    const belowFloor = encodeEnvironment(calmEnvironment({ spyVolatilityRealised10d: 0 }));
    const aboveCeiling = encodeEnvironment(calmEnvironment({ spyVolatilityRealised10d: 200 }));

    expect(belowFloor[REALISED_VOL_INDEX]).toBe(0);
    expect(aboveCeiling[REALISED_VOL_INDEX]).toBe(1);
  });
});

describe('encodeEnvironment — general', () => {
  it('maps every feature into [0, 1]', () => {
    const vec = encodeEnvironment(calmEnvironment());
    expect(vec).toHaveLength(7);
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('decodeVector labels every encoded position', () => {
    const decoded = decodeVector(encodeEnvironment(calmEnvironment()));
    expect(Object.keys(decoded)).toHaveLength(7);
    expect(decoded.spyVolatilityRealised10d).toBeGreaterThan(0);
    expect(decoded.spyVolatilityRealised10d).toBeLessThan(1);
  });
});
