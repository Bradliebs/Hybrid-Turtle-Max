import { describe, expect, it } from 'vitest';
import { computeEvidenceVerdict } from './profit-scoreboard';
import { meanConfidenceInterval, overlapAdjustedMeanConfidenceInterval } from './statistics';

describe('profit-scoreboard evidence verdict', () => {
  it('is inconclusive below 30 trades regardless of point expectancy', () => {
    const interval = meanConfidenceInterval(Array.from({ length: 18 }, () => 1));
    expect(computeEvidenceVerdict(18, 1, interval, 2).verdict).toBe('INCONCLUSIVE');
  });

  it('supports positive expectancy only when its interval is above zero', () => {
    expect(computeEvidenceVerdict(30, 0.4, { lower: 0.1, upper: 0.7, confidence: 0.95 }, 8).verdict).toBe('SUPPORTED');
    expect(computeEvidenceVerdict(30, 0.4, { lower: -0.1, upper: 0.9, confidence: 0.95 }, 8).verdict).toBe('PROMISING');
  });

  it('marks supported negative expectancy as degrading', () => {
    expect(computeEvidenceVerdict(30, -0.4, { lower: -0.7, upper: -0.1, confidence: 0.95 }, 8).verdict).toBe('DEGRADING');
  });

  it('computes a 95% interval for realised R values', () => {
    expect(meanConfidenceInterval([1, 2, 3])).toEqual({ lower: -0.48, upper: 4.48, confidence: 0.95 });
  });

  it('uses Student-t rather than normal confidence at 31 observations', () => {
    const values = Array.from({ length: 31 }, (_, index) => (index < 16 ? 1.335 : -0.665));

    expect(meanConfidenceInterval(values)).toEqual({ lower: -0.01, upper: 0.74, confidence: 0.95 });
  });

  it('keeps evidence inconclusive when many trades come from too few entry days', () => {
    expect(computeEvidenceVerdict(
      10,
      0.4,
      { lower: 0.1, upper: 0.7, confidence: 0.95 },
      8,
      'distinct entry days',
    ).verdict).toBe('INCONCLUSIVE');
  });

  it('does not narrow uncertainty when adjacent outcome days are correlated', () => {
    const values = [...Array(20).fill(1), ...Array(20).fill(-1)];
    const independent = meanConfidenceInterval(values)!;
    const overlapAdjusted = overlapAdjustedMeanConfidenceInterval(values, 20)!;

    expect(overlapAdjusted.lower).toBeLessThan(independent.lower);
    expect(overlapAdjusted.upper).toBeGreaterThan(independent.upper);
  });
});
