// ─────────────────────────────────────────────────────────────────────────
//  Shared stop-loss placement with immediate widen-retry (audit F1, 2026)
// ─────────────────────────────────────────────────────────────────────────
// The automated path (src/cron/auto-trade.ts) already retries stop placement
// with progressively wider stops instead of giving up after a single attempt.
// The MANUAL portal path (src/app/api/positions/execute) historically made a
// single attempt and left the position unprotected on a transient T212
// rejection. This helper gives the manual path the SAME immediate widen tier,
// keeping a single source of truth for the factors / delay / terminal codes
// (imported from auto-trade.ts) so the two paths cannot silently drift.
//
// Scope: IMMEDIATE widen tier only (3 attempts, ~1.5s). The cron's extended
// back-off tier (15s/45s/90s) is intentionally NOT used here — the manual
// route is an interactive SSE modal where the user is watching, so a 150s hang
// is unacceptable. Residual failures are covered by a durable UNPROTECTED_
// POSITION alert (fired by the caller) plus the nightly orphan re-placement.

import {
  STOP_RETRY_WIDEN_FACTORS,
  STOP_RETRY_DELAY_MS,
  STOP_TERMINAL_STATUS_CODES,
  widenStop,
} from '@/cron/auto-trade';
import { Trading212Error } from '@/lib/trading212';
import type { T212PlaceStopOrderRequest, T212PendingOrder } from '@/lib/trading212';

/** Minimal structural slice of Trading212Client needed for stop placement. */
export interface StopOrderPlacer {
  placeStopOrder(order: T212PlaceStopOrderRequest): Promise<T212PendingOrder>;
}

export interface StopRetryAttempt {
  attempt: number;
  stopPrice: number;
  orderId?: string;
  error?: string;
  statusCode?: number | null;
}

export interface PlaceStopWithRetryParams {
  client: StopOrderPlacer;
  t212Ticker: string;
  filledPrice: number;
  /** Positive share count of the filled buy. */
  filledQuantity: number;
  /** The intended stop price. Attempt 1 uses this exactly (factor 1.0). */
  baseStopPrice: number;
  /** Sleep override for tests. Defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PlaceStopWithRetryResult {
  /** True if a stop order was accepted by T212. */
  placed: boolean;
  /** The stop price actually placed (on success) or last attempted (on failure). */
  stopPrice: number;
  /** T212 order id when placed. */
  orderId?: string;
  /** True if the loop aborted early on a terminal auth/permission error. */
  terminal: boolean;
  /** Per-attempt audit trail for the caller to log + alert on. */
  attempts: StopRetryAttempt[];
}

/**
 * Place a GTC stop-loss, retrying with progressively wider stops on transient
 * rejections. Terminal auth/permission errors (401/403) abort immediately —
 * widening cannot fix them. Never throws; the outcome is returned structurally.
 */
export async function placeStopWithRetry(
  params: PlaceStopWithRetryParams,
): Promise<PlaceStopWithRetryResult> {
  const { client, t212Ticker, filledPrice, filledQuantity, baseStopPrice } = params;
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const stopQuantity = -Math.abs(filledQuantity);
  const attempts: StopRetryAttempt[] = [];
  let placed = false;
  let terminal = false;
  let finalStop = baseStopPrice;
  let orderId: string | undefined;

  for (let i = 0; i < STOP_RETRY_WIDEN_FACTORS.length; i++) {
    const factor = STOP_RETRY_WIDEN_FACTORS[i];
    const widenedStop = widenStop(filledPrice, baseStopPrice, factor);
    finalStop = widenedStop;
    const request: T212PlaceStopOrderRequest = {
      quantity: stopQuantity,
      stopPrice: widenedStop,
      ticker: t212Ticker,
      timeValidity: 'GOOD_TILL_CANCEL',
    };

    try {
      const order = await client.placeStopOrder(request);
      orderId = String(order.id);
      placed = true;
      attempts.push({ attempt: i + 1, stopPrice: widenedStop, orderId });
      break;
    } catch (err) {
      const statusCode: number | null = err instanceof Trading212Error ? err.statusCode : null;
      const msg = err instanceof Trading212Error
        ? `T212 ${err.statusCode}: ${err.message}`
        : (err as Error).message;
      attempts.push({ attempt: i + 1, stopPrice: widenedStop, error: msg, statusCode });

      // Terminal errors (auth/permission) won't be fixed by widening — stop now.
      const isTerminal =
        statusCode !== null && (STOP_TERMINAL_STATUS_CODES as readonly number[]).includes(statusCode);
      if (isTerminal) {
        terminal = true;
        break;
      }

      if (i < STOP_RETRY_WIDEN_FACTORS.length - 1) {
        await sleep(STOP_RETRY_DELAY_MS);
      }
    }
  }

  return { placed, stopPrice: finalStop, orderId, terminal, attempts };
}
