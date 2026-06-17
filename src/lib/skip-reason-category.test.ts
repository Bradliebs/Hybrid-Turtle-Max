import { describe, it, expect } from 'vitest';
import { categorizeSkipReason, groupSkipsByCategory } from './skip-reason-category';

describe('categorizeSkipReason', () => {
  it('classifies market gates (regime, health, kill switch, holiday)', () => {
    expect(categorizeSkipReason('Regime: BEARISH')).toBe('MARKET_GATE');
    expect(categorizeSkipReason('Health gate: stale (32h old)')).toBe('MARKET_GATE');
    expect(categorizeSkipReason('Kill switch active: maintenance')).toBe('MARKET_GATE');
    expect(categorizeSkipReason('Market holiday: Thanksgiving')).toBe('MARKET_GATE');
    expect(categorizeSkipReason('Auto-trading is not enabled')).toBe('MARKET_GATE');
  });

  it('classifies live-price revalidation skips', () => {
    expect(categorizeSkipReason('Price fell back below trigger since scan (live 100 < trigger 102)')).toBe('LIVE_PRICE');
    expect(categorizeSkipReason('Price ran above no-chase ceiling since scan (live 110 > ceiling 108)')).toBe('LIVE_PRICE');
    expect(categorizeSkipReason('Live price unavailable (scan price 100, trigger 102)')).toBe('LIVE_PRICE');
  });

  it('classifies risk gate failures', () => {
    expect(categorizeSkipReason('Risk gates: Total Open Risk, Max Positions')).toBe('RISK_GATES');
    expect(categorizeSkipReason('Risk gates: Sector Concentration')).toBe('RISK_GATES');
  });

  it('classifies sizing failures and zero-share results', () => {
    expect(categorizeSkipReason('Sizing failed: Stop price must be below entry price')).toBe('SIZING');
    expect(categorizeSkipReason('Zero shares after sizing')).toBe('SIZING');
  });

  it('classifies FX and currency issues', () => {
    expect(categorizeSkipReason('FX rate unavailable for USD: timeout')).toBe('FX_CURRENCY');
    expect(categorizeSkipReason('FX rate invalid for EUR (got NaN)')).toBe('FX_CURRENCY');
    expect(categorizeSkipReason('Currency not set in Stock row — refusing to assume USD')).toBe('FX_CURRENCY');
  });

  it('classifies broker mapping failures', () => {
    expect(categorizeSkipReason('No T212 ticker mapped')).toBe('BROKER_MAPPING');
    expect(categorizeSkipReason('No suitable T212 account for ISA-eligible stock')).toBe('BROKER_MAPPING');
  });

  it('classifies earnings deferrals', () => {
    expect(categorizeSkipReason('earnings in 3d, deferral window 5d')).toBe('EARNINGS');
  });

  it('classifies session cap and session abort', () => {
    expect(categorizeSkipReason('Session attempt cap reached (2)')).toBe('SESSION_CAP');
    expect(categorizeSkipReason('insufficient-free-for-stocks-buy')).toBe('SESSION_ABORT');
    expect(categorizeSkipReason('Account suspended by T212')).toBe('SESSION_ABORT');
  });

  it('classifies entry-grade blocks', () => {
    expect(categorizeSkipReason('BLOCKED_CHASE: Anti-chase guard triggered: price > trigger + 1.2 ATR')).toBe('GRADE');
    expect(categorizeSkipReason('B-grade: ADX below threshold')).toBe('GRADE');
    expect(categorizeSkipReason('Recent failed breakout. In 5-day cooldown')).toBe('GRADE');
    expect(categorizeSkipReason('READY — within 2% of trigger but breakout not yet confirmed')).toBe('GRADE');
    expect(categorizeSkipReason('Insufficient price data for indicators')).toBe('GRADE');
  });

  it('falls back to UNKNOWN for unrecognised reasons', () => {
    expect(categorizeSkipReason('something completely novel happened')).toBe('UNKNOWN');
    expect(categorizeSkipReason('')).toBe('UNKNOWN');
  });
});

describe('groupSkipsByCategory', () => {
  it('returns empty array for no skips', () => {
    expect(groupSkipsByCategory([])).toEqual([]);
  });

  it('groups skips, counts, and caps examples', () => {
    const groups = groupSkipsByCategory([
      { ticker: 'AAPL', reason: 'Risk gates: Total Open Risk' },
      { ticker: 'MSFT', reason: 'Risk gates: Max Positions' },
      { ticker: 'NVDA', reason: 'Risk gates: Max Positions' },
      { ticker: 'AMZN', reason: 'Risk gates: Sector Concentration' },
      { ticker: 'GOOG', reason: 'Price fell back below trigger since scan (live 100 < 102)' },
      { ticker: 'META', reason: 'Sizing failed: Stop price must be below entry' },
    ]);

    const risk = groups.find(g => g.category === 'RISK_GATES');
    expect(risk).toBeDefined();
    expect(risk!.count).toBe(4);
    expect(risk!.exampleTickers).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(risk!.exampleReasons.length).toBeGreaterThan(0);
    expect(risk!.exampleReasons.length).toBeLessThanOrEqual(2);

    const live = groups.find(g => g.category === 'LIVE_PRICE');
    expect(live?.count).toBe(1);
    expect(live?.exampleTickers).toEqual(['GOOG']);
  });

  it('preserves stable category ordering (market gates first, unknown last)', () => {
    const groups = groupSkipsByCategory([
      { ticker: 'X', reason: 'totally novel reason' },
      { ticker: '*', reason: 'Regime: BEARISH' },
      { ticker: 'Y', reason: 'No T212 ticker mapped' },
    ]);
    const categoriesInOrder = groups.map(g => g.category);
    expect(categoriesInOrder.indexOf('MARKET_GATE')).toBeLessThan(categoriesInOrder.indexOf('BROKER_MAPPING'));
    expect(categoriesInOrder.indexOf('UNKNOWN')).toBe(categoriesInOrder.length - 1);
  });
});
