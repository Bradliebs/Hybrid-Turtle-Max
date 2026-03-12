/**
 * Tests for Phase 6 Ridge regression model.
 * Covers: trainRidge, predict, computeMetrics, computeFeatureImportance
 */
import { describe, it, expect } from 'vitest';
import {
  trainRidge,
  predict,
  computeMetrics,
  computeFeatureImportance,
} from './ridge-model';

describe('trainRidge', () => {
  it('learns a simple linear relationship', () => {
    // y ≈ 2*x1 + 3*x2
    const X = [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
      [3, 1],
      [1, 3],
    ];
    const y = X.map((row) => 2 * row[0] + 3 * row[1] + 0.5);

    const { coefficients, intercept } = trainRidge(X, y, 0.01);

    // With low regularization, coefficients should be close to [2, 3]
    expect(coefficients[0]).toBeCloseTo(2, 0);
    expect(coefficients[1]).toBeCloseTo(3, 0);
    expect(intercept).toBeCloseTo(0.5, 0);
  });

  it('regularization shrinks coefficients', () => {
    const X = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
    const y = X.map((row) => 2 * row[0] + 3 * row[1]);

    const lowReg = trainRidge(X, y, 0.01);
    const highReg = trainRidge(X, y, 100);

    // Higher lambda → smaller coefficients
    const lowNorm = Math.sqrt(lowReg.coefficients.reduce((s, c) => s + c * c, 0));
    const highNorm = Math.sqrt(highReg.coefficients.reduce((s, c) => s + c * c, 0));
    expect(highNorm).toBeLessThan(lowNorm);
  });

  it('handles single feature', () => {
    const X = [[1], [2], [3], [4], [5]];
    const y = [2, 4, 6, 8, 10];

    const { coefficients, intercept } = trainRidge(X, y, 0.01);
    expect(coefficients).toHaveLength(1);
    expect(coefficients[0]).toBeCloseTo(2, 0);
  });
});

describe('predict', () => {
  it('computes dot product + intercept', () => {
    const features = [1, 2, 3];
    const coefficients = [0.5, 1.0, 1.5];
    const intercept = 0.25;

    const result = predict(features, coefficients, intercept);
    // 0.5*1 + 1.0*2 + 1.5*3 + 0.25 = 0.5 + 2.0 + 4.5 + 0.25 = 7.25
    expect(result).toBeCloseTo(7.25, 6);
  });

  it('returns intercept for zero features', () => {
    const result = predict([0, 0], [1, 2], 5);
    expect(result).toBe(5);
  });
});

describe('computeMetrics', () => {
  it('computes perfect R² for exact predictions', () => {
    const X = [[1], [2], [3]];
    const y = [2, 4, 6];
    const metrics = computeMetrics(X, y, [2], 0);
    expect(metrics.r2).toBe(1);
    expect(metrics.mae).toBe(0);
    expect(metrics.rmse).toBe(0);
  });

  it('computes zero R² for constant prediction at mean', () => {
    const X = [[1], [2], [3]];
    const y = [1, 2, 3];
    // Predict mean (2) for all: y_pred = 0*x + 2
    const metrics = computeMetrics(X, y, [0], 2);
    expect(metrics.r2).toBe(0);
    expect(metrics.mae).toBeCloseTo(0.667, 1);
  });

  it('returns zero metrics for empty data', () => {
    const metrics = computeMetrics([], [], [1], 0);
    expect(metrics.r2).toBe(0);
  });
});

describe('computeFeatureImportance', () => {
  it('ranks features by absolute coefficient', () => {
    const coefficients = [0.5, -2.0, 1.0];
    const names = ['a', 'b', 'c'] as const;

    const importance = computeFeatureImportance(coefficients, names);
    expect(importance[0].feature).toBe('b'); // |−2.0| is largest
    expect(importance[0].importance).toBe(1.0);
    expect(importance[1].feature).toBe('c');
    expect(importance[2].feature).toBe('a');
  });

  it('normalizes to [0, 1] range', () => {
    const coefficients = [1, 2, 3];
    const names = ['x', 'y', 'z'] as const;
    const importance = computeFeatureImportance(coefficients, names);
    expect(importance[0].importance).toBe(1.0);
    expect(importance.every((fi) => fi.importance >= 0 && fi.importance <= 1)).toBe(true);
  });
});
