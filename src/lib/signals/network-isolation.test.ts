/**
 * Tests for network isolation signal computation.
 * Covers: Pearson correlation, isolation score, edge cases
 */
import { describe, it, expect } from 'vitest';
import { computeNetworkIsolation, type DailyBar } from './network-isolation';

function makeBars(count: number, closeOverride?: (i: number) => number): DailyBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String(count - i).padStart(2, '0')}`,
    close: closeOverride ? closeOverride(i) : 100 + Math.sin(i * 0.5) * 5,
  }));
}

describe('computeNetworkIsolation', () => {
  it('returns null for insufficient target data', () => {
    const shortBars = makeBars(30);
    const peers = new Map([
      ['PEER1', makeBars(100)],
      ['PEER2', makeBars(100)],
      ['PEER3', makeBars(100)],
    ]);
    expect(computeNetworkIsolation(shortBars, peers)).toBeNull();
  });

  it('returns null for insufficient peers', () => {
    const target = makeBars(100);
    const peers = new Map([
      ['PEER1', makeBars(100)],
      ['PEER2', makeBars(100)],
    ]);
    // Need at least 3 peers
    expect(computeNetworkIsolation(target, peers)).toBeNull();
  });

  it('returns low isolation for perfectly correlated peers', () => {
    // Target and all peers move identically → high correlation → low isolation
    const samePattern = (i: number) => 100 + i * 0.5;
    const target = makeBars(100, samePattern);
    const peers = new Map([
      ['PEER1', makeBars(100, samePattern)],
      ['PEER2', makeBars(100, samePattern)],
      ['PEER3', makeBars(100, samePattern)],
    ]);
    const result = computeNetworkIsolation(target, peers);
    expect(result).not.toBeNull();
    // Perfectly correlated → isolation should be near 0
    expect(result!.netIsolation).toBeLessThan(0.1);
    expect(result!.peerCount).toBe(3);
    expect(result!.obsCount).toBe(63);
  });

  it('returns higher isolation for uncorrelated peers', () => {
    // Target moves one way, peers move differently
    const target = makeBars(100, (i) => 100 + i * 0.5);
    const peers = new Map([
      ['PEER1', makeBars(100, (i) => 100 + Math.sin(i * 1.7) * 10)],
      ['PEER2', makeBars(100, (i) => 100 + Math.cos(i * 2.3) * 8)],
      ['PEER3', makeBars(100, (i) => 100 + ((i * 37) % 20) - 10)],
    ]);
    const result = computeNetworkIsolation(target, peers);
    expect(result).not.toBeNull();
    // Uncorrelated → isolation should be higher
    expect(result!.netIsolation).toBeGreaterThan(0.3);
  });

  it('isolation is bounded [0, 1]', () => {
    const target = makeBars(100, (i) => 100 + ((i * 7 + 3) % 15));
    const peers = new Map([
      ['PEER1', makeBars(100, (i) => 100 + ((i * 13 + 5) % 20))],
      ['PEER2', makeBars(100, (i) => 100 + ((i * 11 + 7) % 18))],
      ['PEER3', makeBars(100, (i) => 100 + ((i * 17 + 1) % 22))],
    ]);
    const result = computeNetworkIsolation(target, peers);
    expect(result).not.toBeNull();
    expect(result!.netIsolation).toBeGreaterThanOrEqual(0);
    expect(result!.netIsolation).toBeLessThanOrEqual(1);
  });

  it('skips peers with insufficient data', () => {
    const target = makeBars(100);
    const peers = new Map([
      ['PEER1', makeBars(100)],
      ['PEER2', makeBars(100)],
      ['PEER3', makeBars(100)],
      ['SHORT', makeBars(20)], // too short — should be skipped
    ]);
    const result = computeNetworkIsolation(target, peers);
    expect(result).not.toBeNull();
    expect(result!.peerCount).toBe(3); // SHORT peer skipped
  });

  it('handles empty peer map', () => {
    const target = makeBars(100);
    const emptyPeers = new Map<string, DailyBar[]>();
    expect(computeNetworkIsolation(target, emptyPeers)).toBeNull();
  });
});
