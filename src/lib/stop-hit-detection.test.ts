import { describe, it, expect } from 'vitest';
import { selectStopHitTriggerPrice } from './stop-hit-detection';

describe('selectStopHitTriggerPrice', () => {
  const today = '2026-06-15';

  it('prefers intra-day low when today bar is present and valid', () => {
    const result = selectStopHitTriggerPrice(
      { date: today, low: 42.5 },
      99.0,
      today
    );
    expect(result).toEqual({ price: 42.5, source: 'INTRA_DAY_LOW' });
  });

  it('falls back to snapshot when bar date is stale (yesterday)', () => {
    const result = selectStopHitTriggerPrice(
      { date: '2026-06-14', low: 42.5 },
      99.0,
      today
    );
    expect(result).toEqual({ price: 99.0, source: 'SNAPSHOT' });
  });

  it('falls back to snapshot when bar is null (weekend / fetch failure)', () => {
    const result = selectStopHitTriggerPrice(null, 99.0, today);
    expect(result).toEqual({ price: 99.0, source: 'SNAPSHOT' });
  });

  it('falls back to snapshot when bar.low is zero', () => {
    const result = selectStopHitTriggerPrice(
      { date: today, low: 0 },
      99.0,
      today
    );
    expect(result).toEqual({ price: 99.0, source: 'SNAPSHOT' });
  });

  it('falls back to snapshot when bar.low is negative (corrupt)', () => {
    const result = selectStopHitTriggerPrice(
      { date: today, low: -1 },
      99.0,
      today
    );
    expect(result).toEqual({ price: 99.0, source: 'SNAPSHOT' });
  });

  it('falls back to snapshot when bar.low is NaN', () => {
    const result = selectStopHitTriggerPrice(
      { date: today, low: NaN },
      99.0,
      today
    );
    expect(result).toEqual({ price: 99.0, source: 'SNAPSHOT' });
  });

  it('returns null when both intra-day bar and snapshot are unusable', () => {
    expect(selectStopHitTriggerPrice(null, null, today)).toBeNull();
    expect(selectStopHitTriggerPrice(null, 0, today)).toBeNull();
    expect(selectStopHitTriggerPrice(null, -5, today)).toBeNull();
    expect(selectStopHitTriggerPrice(undefined, undefined, today)).toBeNull();
    expect(
      selectStopHitTriggerPrice({ date: today, low: 0 }, NaN, today)
    ).toBeNull();
  });

  it('uses intra-day low even when much lower than snapshot (the stop-bounce case)', () => {
    // Real-money scenario: stop = 50. Intra-day low touched 49.2 (T212 fills).
    // Price recovered to 51.8 by snapshot time. Old logic: 51.8 > 50 → NO alert.
    // New logic: 49.2 < 50 → ALERT (correctly surfaces the broker fill).
    const result = selectStopHitTriggerPrice(
      { date: today, low: 49.2 },
      51.8,
      today
    );
    expect(result).toEqual({ price: 49.2, source: 'INTRA_DAY_LOW' });
  });

  it('uses intra-day low when it is higher than snapshot (post-low recovery and re-fall)', () => {
    // Bar low always wins when valid — even if snapshot now lower.
    // (This is rare: snapshot < bar.low means the day still has more downside.
    //  The bar low gets superseded later; for the run window, low is authoritative.)
    const result = selectStopHitTriggerPrice(
      { date: today, low: 55.0 },
      48.0,
      today
    );
    expect(result).toEqual({ price: 55.0, source: 'INTRA_DAY_LOW' });
  });
});
