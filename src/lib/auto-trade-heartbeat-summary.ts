/**
 * DEPENDENCIES
 * Consumed by: src/cron/hourly-status.ts (blockers enrichment)
 * Consumes: src/lib/skip-reason-category.ts
 * Risk-sensitive: NO (display only — no trading logic)
 * Notes: Turns the last AUTO_TRADE Heartbeat row into a human-readable
 *        blocker line for the hourly Telegram status. Returns null when
 *        the last run executed cleanly (status='OK' AND no skipped
 *        candidates AND no informative reason) — operator should see
 *        no noise on a clean run.
 */

import { groupSkipsByCategory } from './skip-reason-category';

export interface HeartbeatLike {
  timestamp: Date | string;
  status: string;
  details: string | null;
}

const REASON_LABEL: Record<string, string> = {
  weekend: 'weekend (cron should not have fired)',
  'market-holiday': 'market holiday',
  'early-close': 'early-close day — session skipped',
  'kill-switch': 'kill switch active',
};

function humanReason(raw: string | undefined): string | null {
  if (!raw) return null;
  if (REASON_LABEL[raw]) return REASON_LABEL[raw];
  if (raw.startsWith('regime-')) return `regime ${raw.slice('regime-'.length)} (only BULLISH trades)`;
  if (raw.startsWith('operating-mode-')) return `operating mode ${raw.slice('operating-mode-'.length)}`;
  if (raw.startsWith('health-')) return `health ${raw.slice('health-'.length)}`;
  return raw;
}

/**
 * Build a compact blocker line from the most recent AUTO_TRADE heartbeat.
 * Returns null when the run was clean and there is nothing to surface.
 *
 * Output shape examples:
 *   "🤖 Last auto-trade 2h ago (us): SKIPPED — kill switch active"
 *   "🤖 Last auto-trade 1h ago (uk): regime BEARISH (only BULLISH trades);
 *      6 candidates skipped — Risk gates (4): AAPL, MSFT, NVDA +1 · Live-price (2): GOOG, META"
 */
export function summarizeAutoTradeBlocker(hb: HeartbeatLike | null | undefined, now: Date = new Date()): string | null {
  if (!hb) return null;

  const ts = typeof hb.timestamp === 'string' ? new Date(hb.timestamp) : hb.timestamp;
  const ageHr = Math.max(0, Math.round((now.getTime() - ts.getTime()) / 3600000));
  // Older than 25h: heartbeat is too stale to be diagnostically useful.
  if (ageHr > 25) return null;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(hb.details || '{}');
  } catch {
    parsed = {};
  }

  const session = typeof parsed.session === 'string' ? parsed.session : '?';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
  const skipped = Array.isArray(parsed.skipped)
    ? (parsed.skipped as Array<{ ticker: string; reason: string }>)
        .filter(s => s && typeof s.ticker === 'string' && typeof s.reason === 'string')
    : [];

  const human = humanReason(reason);
  const isCleanOk = hb.status === 'OK' && skipped.length === 0 && !human;
  if (isCleanOk) return null;

  const parts: string[] = [];
  const statusPrefix = hb.status === 'OK' ? '' : `${hb.status} — `;
  if (human) {
    parts.push(`${statusPrefix}${human}`);
  } else if (statusPrefix) {
    parts.push(statusPrefix.replace(/ — $/, ''));
  }

  if (skipped.length > 0) {
    const groups = groupSkipsByCategory(skipped);
    const summary = groups
      .slice(0, 3)
      .map(g => {
        const examples = g.exampleTickers.join(', ');
        const more = g.count > g.exampleTickers.length ? ` +${g.count - g.exampleTickers.length}` : '';
        return `${g.label} (${g.count}): ${examples}${more}`;
      })
      .join(' · ');
    const tail = groups.length > 3 ? ` · +${groups.length - 3} more groups` : '';
    parts.push(`${skipped.length} candidate(s) skipped — ${summary}${tail}`);
  }

  if (parts.length === 0) return null;
  return `🤖 Last auto-trade ${ageHr}h ago (${session}): ${parts.join('; ')}`;
}
