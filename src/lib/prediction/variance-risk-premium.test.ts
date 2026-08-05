import { describe, it, expect } from 'vitest';
import {
  computeVrp,
  describeVrp,
  VRP_HISTORICAL,
  VRP_RICH_THRESHOLD,
} from './variance-risk-premium';

describe('computeVrp — states', () => {
  it('classifies the long-run average as NORMAL', () => {
    const r = computeVrp(20, 20 - VRP_HISTORICAL.mean);
    expect(r.state).toBe('NORMAL');
    expect(r.vrp).toBeCloseTo(VRP_HISTORICAL.mean, 5);
  });

  it('classifies a negative premium as INVERTED', () => {
    const r = computeVrp(18, 25);
    expect(r.state).toBe('INVERTED');
    expect(r.vrp).toBe(-7);
  });

  it('classifies a top-decile premium as RICH', () => {
    const r = computeVrp(30, 30 - VRP_RICH_THRESHOLD - 1);
    expect(r.state).toBe('RICH');
  });

  it('treats exactly zero premium as NORMAL, not INVERTED', () => {
    expect(computeVrp(15, 15).state).toBe('NORMAL');
  });

  it('treats the RICH threshold itself as RICH', () => {
    expect(computeVrp(VRP_RICH_THRESHOLD + 10, 10).state).toBe('RICH');
  });
});

describe('computeVrp — reconstructed historical days', () => {
  // Values measured by scripts/calibrate-danger-score.ts from ^VIX + SPY bars.

  it('5 Feb 2018 (Volmageddon) was RICH, not inverted', () => {
    const r = computeVrp(37.3, 23.2);
    expect(r.state).toBe('RICH');
    expect(r.vrp).toBeCloseTo(14.1, 1);
    // The premium was WIDE that day — VIX repriced far ahead of trailing
    // realised. A wide premium is not a calm signal.
    expect(r.approximatePercentile).toBeGreaterThan(90);
  });

  it('16 Mar 2020 (COVID crash) was deeply INVERTED', () => {
    const r = computeVrp(82.7, 99.7);
    expect(r.state).toBe('INVERTED');
    expect(r.vrp).toBeCloseTo(-17.0, 1);
    expect(r.approximatePercentile).toBeLessThan(5);
  });

  it('13 Oct 2022 sat below the long-run average but stayed NORMAL', () => {
    const r = computeVrp(31.9, 29.9);
    expect(r.state).toBe('NORMAL');
    expect(r.vrp).toBeCloseTo(2.0, 1);
  });
});

describe('computeVrp — percentile', () => {
  it('places the measured median near the 50th percentile', () => {
    expect(computeVrp(20, 20 - VRP_HISTORICAL.median).approximatePercentile).toBe(50);
  });

  it('is monotonically increasing in the premium', () => {
    const points = [-40, -10, -1, 0, 3, 5, 8, 11, 14, 20, 40];
    const pcts = points.map(v => computeVrp(v + 10, 10).approximatePercentile);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
    }
  });

  it('clamps to 0–100', () => {
    expect(computeVrp(0, 500).approximatePercentile).toBe(0);
    expect(computeVrp(500, 0).approximatePercentile).toBe(100);
  });
});

describe('describeVrp', () => {
  it('returns a non-empty sentence for every state', () => {
    for (const r of [computeVrp(18, 25), computeVrp(20, 15), computeVrp(30, 15)]) {
      expect(describeVrp(r).length).toBeGreaterThan(20);
    }
  });
});
