/**
 * DEPENDENCIES
 * Consumed by: nightly shadow logging, DangerLevelIndicator (display only)
 * Consumes: nothing — pure function
 * Risk-sensitive: NO — advisory-only, display and shadow log
 * Last modified: 2026-07-29
 * Notes: Variance risk premium = implied volatility (VIX) minus realised
 *        volatility, both annualised %. Shiller's Yale ECON 252 lecture puts the
 *        long-run gap at ~4 points; measured over SPY/^VIX 2015-2026 in this
 *        system it is 4.61, so the claim reproduces.
 *
 *        ⛔ Does NOT modify risk-gates.ts, position-sizer.ts or the danger score.
 *        ⛔ Not wired into MarketEnvironment. The Phase 2 calibration
 *           (scripts/calibrate-danger-score.ts) showed the 7-dimension danger
 *           cosine loses to its own best single input, so nothing new should be
 *           attached to it until that is fixed. This stays standalone.
 */

/** Measured from ^VIX + SPY daily bars, 2015-02-02 → 2026-07-27 (n = 2886). */
export const VRP_HISTORICAL = {
  mean: 4.61,
  p10: -0.65,
  p25: 2.47,
  median: 5.02,
  p75: 7.58,
  /** 90th percentile — the RICH boundary. */
  p90: 10.2,
  /** Share of days with a negative premium. */
  invertedShare: 0.12,
} as const;

/**
 * Boundary between NORMAL and RICH, taken from the measured 90th percentile
 * rather than chosen. Roughly the top decile of days.
 */
export const VRP_RICH_THRESHOLD = VRP_HISTORICAL.p90;

export type VrpState =
  /** Realised volatility exceeds implied — the market is moving more than it is priced to. */
  | 'INVERTED'
  /** Implied exceeds realised by a typical margin. The long-run resting state. */
  | 'NORMAL'
  /** Implied exceeds realised by an unusually wide margin — top decile. */
  | 'RICH';

export interface VrpResult {
  /** VIX minus realised vol, in annualised volatility points. */
  vrp: number;
  state: VrpState;
  /** Percentile of `vrp` against the measured historical distribution, 0–100. */
  approximatePercentile: number;
}

/**
 * @param vixLevel                   VIX index level (already an annualised %).
 * @param realisedVolAnnualisedPct   Realised volatility as an annualised %,
 *                                   e.g. 12 for a typical SPY tape. Must be on
 *                                   the same scale as VIX — passing a daily
 *                                   figure (1.5) produces a meaningless premium.
 */
export function computeVrp(vixLevel: number, realisedVolAnnualisedPct: number): VrpResult {
  const vrp = vixLevel - realisedVolAnnualisedPct;

  const state: VrpState =
    vrp < 0 ? 'INVERTED'
      : vrp >= VRP_RICH_THRESHOLD ? 'RICH'
        : 'NORMAL';

  return { vrp, state, approximatePercentile: vrpPercentile(vrp) };
}

/** Linear interpolation across the measured percentile anchors. */
function vrpPercentile(vrp: number): number {
  const anchors: Array<[number, number]> = [
    [-15.57, 1], [-3.35, 5], [-0.65, 10], [2.47, 25],
    [5.02, 50], [7.58, 75], [10.2, 90], [12.35, 95], [15.93, 99],
  ];

  if (vrp <= anchors[0][0]) return 0;
  if (vrp >= anchors[anchors.length - 1][0]) return 100;

  for (let i = 1; i < anchors.length; i++) {
    const [lowV, lowP] = anchors[i - 1];
    const [highV, highP] = anchors[i];
    if (vrp <= highV) {
      const frac = (vrp - lowV) / (highV - lowV);
      return Math.round(lowP + frac * (highP - lowP));
    }
  }
  return 100;
}

/** One-line plain-English summary for display. No action implied. */
export function describeVrp(result: VrpResult): string {
  const points = result.vrp.toFixed(1);
  switch (result.state) {
    case 'INVERTED':
      return `Realised volatility is ${Math.abs(result.vrp).toFixed(1)} points above VIX — the market is moving more than it is priced for.`;
    case 'RICH':
      return `VIX is ${points} points above realised volatility — top decile, fear is priced well ahead of movement.`;
    case 'NORMAL':
      return `VIX is ${points} points above realised volatility — near the long-run average of ${VRP_HISTORICAL.mean}.`;
  }
}
