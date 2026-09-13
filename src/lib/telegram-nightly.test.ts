import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/crypto', () => ({ decryptField: (value: string) => value }));

import { sendNightlySummary } from './telegram';

const transport = vi.fn<typeof fetch>();

function summary(): Parameters<typeof sendNightlySummary>[0] {
  return {
    date: '2026-09-13', healthStatus: 'YELLOW', regime: 'SYNCED',
    openPositions: 0, stopsUpdated: 0, readyCandidates: 0,
    alerts: ['Breadth < 40% & risk > limit', '<unsupported>'],
    portfolioValue: 0, dailyChange: 0, dailyChangePercent: 0,
    equity: 200, openRiskPercent: 0, positions: [], stopChanges: [],
    trailingStopChanges: [], snapshotSynced: 1054, snapshotFailed: 19,
    readyToBuy: [], breadthAlert: {
      breadthPct: 30, isRestricted: true, maxPositionsOverride: 2, reason: 'Restricted',
    },
  };
}

beforeEach(() => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat');
  transport.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('nightly Telegram delivery', () => {
  it('escapes alert text and the restricted breadth comparison in the actual payload', async () => {
    expect(await sendNightlySummary(summary())).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('Breadth &lt; 40% &amp; risk &gt; limit');
    expect(body.text).toContain('&lt;unsupported&gt;');
    expect(body.text).toContain('(&lt; 40%)');
    expect(body.text.replace(/<\/?(?:b|i)>/g, '')).not.toContain('<');
  });

  it('escapes position fields while preserving intentional formatting', async () => {
    const input = summary();
    input.positions = [{ ticker: 'A&B', sleeve: 'CORE', shares: 1, entryPrice: 10,
      currentPrice: 11, currentStop: 9, protectionLevel: '<INITIAL>', rMultiple: 1,
      pnl: 1, pnlPercent: 10, currency: 'GBP' }];
    await sendNightlySummary(input);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.text).toContain('<b>A&amp;B</b>');
    expect(body.text).toContain('[&lt;INITIAL&gt;]');
  });

  it('reports rejected delivery instead of success', async () => {
    transport.mockResolvedValue(new Response('{"ok":false}', { status: 400 }));
    expect(await sendNightlySummary(summary())).toBe(false);
  });
});