export interface ConfidenceInterval {
  lower: number;
  upper: number;
  confidence: 0.95;
}

const T_CRITICAL_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093,
  2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045,
];

function tCritical95(degreesOfFreedom: number): number {
  if (degreesOfFreedom <= T_CRITICAL_95.length) {
    return T_CRITICAL_95[degreesOfFreedom - 1];
  }
  const z = 1.959963984540054;
  const inverseDf = 1 / degreesOfFreedom;
  return z
    + ((z ** 3 + z) / 4) * inverseDf
    + ((5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96) * inverseDf ** 2
    + ((3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384) * inverseDf ** 3;
}

export function meanConfidenceInterval(values: number[]): ConfidenceInterval | null {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  const degreesOfFreedom = values.length - 1;
  const criticalValue = tCritical95(degreesOfFreedom);
  const margin = criticalValue * Math.sqrt(variance / values.length);
  return {
    lower: Math.round((average - margin) * 100) / 100,
    upper: Math.round((average + margin) * 100) / 100,
    confidence: 0.95,
  };
}

export function overlapAdjustedMeanConfidenceInterval(
  values: number[],
  maxLag: number,
): ConfidenceInterval | null {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - average);
  const sampleVariance = centered.reduce((sum, value) => sum + value ** 2, 0) / (values.length - 1);
  const iidVarianceOfMean = sampleVariance / values.length;
  const lagLimit = Math.min(Math.max(0, Math.floor(maxLag)), values.length - 1);
  let longRunVariance = centered.reduce((sum, value) => sum + value ** 2, 0) / values.length;

  for (let lag = 1; lag <= lagLimit; lag += 1) {
    const weight = 1 - lag / (lagLimit + 1);
    let covariance = 0;
    for (let index = lag; index < centered.length; index += 1) {
      covariance += centered[index] * centered[index - lag];
    }
    longRunVariance += 2 * weight * covariance / values.length;
  }

  const varianceOfMean = Math.max(iidVarianceOfMean, longRunVariance / values.length, 0);
  const criticalValue = tCritical95(values.length - 1);
  const margin = criticalValue * Math.sqrt(varianceOfMean);
  return {
    lower: Math.round((average - margin) * 100) / 100,
    upper: Math.round((average + margin) * 100) / 100,
    confidence: 0.95,
  };
}