import { describe, it, expect } from 'vitest';
import { summarizeAutoTradeBlocker } from './auto-trade-heartbeat-summary';

const FIXED_NOW = new Date('2026-06-17T18:00:00Z');
function hoursAgo(h: number): Date {
  return new Date(FIXED_NOW.getTime() - h * 3600000);
}

describe('summarizeAutoTradeBlocker', () => {
  it('returns null for null / undefined heartbeat', () => {
    expect(summarizeAutoTradeBlocker(null, FIXED_NOW)).toBeNull();
    expect(summarizeAutoTradeBlocker(undefined, FIXED_NOW)).toBeNull();
  });

  it('returns null for a clean OK run with no reason and no skips', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(2),
      status: 'OK',
      details: JSON.stringify({ session: 'uk', executed: 2, failed: 0 }),
    }, FIXED_NOW);
    expect(out).toBeNull();
  });

  it('surfaces SKIPPED status with kill-switch reason', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(1),
      status: 'SKIPPED',
      details: JSON.stringify({ session: 'us', reason: 'kill-switch', message: 'maintenance' }),
    }, FIXED_NOW);
    expect(out).toMatch(/Last auto-trade 1h ago \(us\)/);
    expect(out).toMatch(/SKIPPED/);
    expect(out).toMatch(/kill switch active/);
  });

  it('surfaces regime-blocked run (status=OK, reason=regime-BEARISH)', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(3),
      status: 'OK',
      details: JSON.stringify({ session: 'uk', reason: 'regime-BEARISH', scanned: 200 }),
    }, FIXED_NOW);
    expect(out).toMatch(/regime BEARISH/);
    expect(out).not.toMatch(/^.*OK —/);
  });

  it('summarises skipped candidates by category', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(2),
      status: 'OK',
      details: JSON.stringify({
        session: 'us',
        executed: 0,
        skipped: [
          { ticker: 'AAPL', reason: 'Risk gates: Total Open Risk' },
          { ticker: 'MSFT', reason: 'Risk gates: Max Positions' },
          { ticker: 'NVDA', reason: 'Risk gates: Max Positions' },
          { ticker: 'AMZN', reason: 'Risk gates: Sector Concentration' },
          { ticker: 'GOOG', reason: 'Price fell back below trigger since scan (live 100 < 102)' },
          { ticker: 'META', reason: 'Sizing failed: Stop below entry' },
        ],
      }),
    }, FIXED_NOW);
    expect(out).toMatch(/6 candidate\(s\) skipped/);
    expect(out).toMatch(/Risk gates \(4\)/);
    expect(out).toMatch(/Live-price revalidation \(1\)/);
  });

  it('combines run-level reason and per-candidate skips', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(1),
      status: 'OK',
      details: JSON.stringify({
        session: 'uk',
        reason: 'regime-SIDEWAYS',
        skipped: [
          { ticker: 'AAPL', reason: 'Risk gates: Total Open Risk' },
        ],
      }),
    }, FIXED_NOW);
    expect(out).toMatch(/regime SIDEWAYS/);
    expect(out).toMatch(/1 candidate\(s\) skipped/);
    expect(out).toMatch(/Risk gates \(1\)/);
  });

  it('drops heartbeats older than 25h as too stale', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(30),
      status: 'SKIPPED',
      details: JSON.stringify({ session: 'uk', reason: 'kill-switch' }),
    }, FIXED_NOW);
    expect(out).toBeNull();
  });

  it('tolerates malformed details JSON', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(1),
      status: 'FAILED',
      details: '{not valid json',
    }, FIXED_NOW);
    expect(out).toMatch(/FAILED/);
    expect(out).toMatch(/Last auto-trade 1h ago/);
  });

  it('passes through unknown reason verbatim', () => {
    const out = summarizeAutoTradeBlocker({
      timestamp: hoursAgo(1),
      status: 'SKIPPED',
      details: JSON.stringify({ session: 'us', reason: 'novel-edge-case-token' }),
    }, FIXED_NOW);
    expect(out).toMatch(/novel-edge-case-token/);
  });
});
