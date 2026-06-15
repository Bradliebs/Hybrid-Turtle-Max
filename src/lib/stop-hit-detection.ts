/**
 * DEPENDENCIES
 * Consumed by: src/cron/nightly.ts (Step 3d stop-hit detection)
 * Consumes: (none — pure logic)
 * Risk-sensitive: NO (selection logic only; alert delivery + DB handled by caller)
 *
 * WHY
 * Snapshot prices (Yahoo close + T212 real-time overlay) miss the case where
 * a stop is hit INTRA-DAY and price recovers above the stop by snapshot time.
 * That is a silent false negative: T212 may have filled the stop, but nightly
 * never alerts. Compare today's intra-day LOW against the stop instead. Fall
 * back to snapshot only when today's bar is unavailable (weekend, holiday,
 * data-source outage).
 */

export interface DailyBarLike {
  date: string; // YYYY-MM-DD
  low: number;
}

export type StopHitTriggerSource = 'INTRA_DAY_LOW' | 'SNAPSHOT';

export interface StopHitTrigger {
  price: number;
  source: StopHitTriggerSource;
}

/**
 * Pick the price to compare against currentStop for stop-hit detection.
 *
 * Preference order:
 *   1. Today's intra-day low (catches stops hit and bounced back).
 *   2. Snapshot price (used when today's bar is unavailable or stale).
 *
 * Returns null when neither signal is usable — the caller should skip
 * the position rather than alert on a null/zero/negative price.
 */
export function selectStopHitTriggerPrice(
  todayBar: DailyBarLike | null | undefined,
  snapshotPrice: number | null | undefined,
  todayStr: string
): StopHitTrigger | null {
  if (
    todayBar &&
    todayBar.date === todayStr &&
    Number.isFinite(todayBar.low) &&
    todayBar.low > 0
  ) {
    return { price: todayBar.low, source: 'INTRA_DAY_LOW' };
  }

  if (
    typeof snapshotPrice === 'number' &&
    Number.isFinite(snapshotPrice) &&
    snapshotPrice > 0
  ) {
    return { price: snapshotPrice, source: 'SNAPSHOT' };
  }

  return null;
}
