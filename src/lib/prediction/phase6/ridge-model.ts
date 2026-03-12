/**
 * DEPENDENCIES
 * Consumed by: trainer.ts, ranker.ts
 * Consumes: (standalone — pure math, no external dependencies)
 * Risk-sensitive: NO — advisory prediction model, never affects trade execution
 * Last modified: 2026-03-11
 * Notes: Ridge regression implemented in pure TypeScript.
 *        No npm dependencies. Suitable for small feature sets (≤20 features)
 *        with small datasets (≤100 samples). L2 regularization prevents
 *        overfitting on the small training set.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface ModelWeights {
  /** Learned coefficients, one per feature */
  coefficients: number[];
  /** Intercept (bias) term */
  intercept: number;
  /** Regularization strength used during training */
  lambda: number;
  /** Feature bounds used for normalization */
  featureBounds: {
    min: number[];
    max: number[];
    medians: number[];
  };
  /** Training metrics */
  metrics: TrainingMetrics;
  /** ISO timestamp of when the model was trained */
  trainedAt: string;
  /** Number of training samples */
  trainingSamples: number;
  /** Number of test samples */
  testSamples: number;
}

export interface TrainingMetrics {
  /** R² on the test set (coefficient of determination) */
  r2: number;
  /** Mean Absolute Error on the test set */
  mae: number;
  /** Root Mean Squared Error on the test set */
  rmse: number;
  /** R² on the training set (for overfitting detection) */
  trainR2: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  coefficient: number;
}

// ── Ridge Regression ───────────────────────────────────────────────

/**
 * Train a Ridge regression model.
 *
 * Minimizes: ||Xw - y||² + λ||w||²
 * Solution: w = (X'X + λI)⁻¹ X'y
 *
 * @param X Feature matrix [nSamples × nFeatures], already normalized
 * @param y Target vector [nSamples]
 * @param lambda Regularization strength (default 1.0)
 * @returns Learned coefficients and intercept
 */
export function trainRidge(
  X: number[][],
  y: number[],
  lambda = 1.0
): { coefficients: number[]; intercept: number } {
  const n = X.length;
  const p = X[0].length;

  // Center y (compute mean for intercept)
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const yc = y.map((v) => v - yMean);

  // Center X (compute column means)
  const xMeans = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) xMeans[j] += X[i][j];
    xMeans[j] /= n;
  }
  const Xc = X.map((row) => row.map((v, j) => v - xMeans[j]));

  // Compute X'X + λI (p × p)
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += Xc[k][i] * Xc[k][j];
      XtX[i][j] = sum;
    }
    XtX[i][i] += lambda; // Add regularization to diagonal
  }

  // Compute X'y (p × 1)
  const Xty: number[] = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) Xty[j] += Xc[i][j] * yc[i];
  }

  // Solve (X'X + λI)w = X'y via Cholesky or Gaussian elimination
  const w = solveLinearSystem(XtX, Xty);

  // Intercept: yMean - Σ(wj * xMeanj)
  let intercept = yMean;
  for (let j = 0; j < p; j++) intercept -= w[j] * xMeans[j];

  return { coefficients: w, intercept };
}

/**
 * Predict target values from features using trained weights.
 */
export function predict(
  features: number[],
  coefficients: number[],
  intercept: number
): number {
  let pred = intercept;
  for (let i = 0; i < features.length; i++) {
    pred += features[i] * coefficients[i];
  }
  return pred;
}

/**
 * Compute training metrics on a dataset.
 */
export function computeMetrics(
  X: number[][],
  y: number[],
  coefficients: number[],
  intercept: number
): { r2: number; mae: number; rmse: number } {
  const n = y.length;
  if (n === 0) return { r2: 0, mae: 0, rmse: 0 };

  const predictions = X.map((row) => predict(row, coefficients, intercept));

  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  let absErrorSum = 0;
  let sqErrorSum = 0;

  for (let i = 0; i < n; i++) {
    const err = y[i] - predictions[i];
    ssRes += err * err;
    ssTot += (y[i] - yMean) * (y[i] - yMean);
    absErrorSum += Math.abs(err);
    sqErrorSum += err * err;
  }

  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const mae = absErrorSum / n;
  const rmse = Math.sqrt(sqErrorSum / n);

  return {
    r2: Math.round(r2 * 1000) / 1000,
    mae: Math.round(mae * 1000) / 1000,
    rmse: Math.round(rmse * 1000) / 1000,
  };
}

/**
 * Compute feature importance from Ridge coefficients.
 * Uses |coefficient| as the importance measure (features are already normalized).
 */
export function computeFeatureImportance(
  coefficients: number[],
  featureNames: readonly string[]
): FeatureImportance[] {
  const maxAbsCoeff = Math.max(...coefficients.map(Math.abs), 1e-10);

  return featureNames
    .map((name, i) => ({
      feature: name,
      importance: Math.round((Math.abs(coefficients[i]) / maxAbsCoeff) * 100) / 100,
      coefficient: Math.round(coefficients[i] * 10000) / 10000,
    }))
    .sort((a, b) => b.importance - a.importance);
}

// ── Linear Algebra Helpers ─────────────────────────────────────────

/**
 * Solve Ax = b via Gaussian elimination with partial pivoting.
 * Modifies A and b in place.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augment matrix
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // Check for singular matrix
    if (Math.abs(aug[col][col]) < 1e-12) {
      aug[col][col] = 1e-12; // Regularization fallback
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }

  return x;
}
