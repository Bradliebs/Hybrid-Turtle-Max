/**
 * DEPENDENCIES
 * Consumed by: cron/midday-sync.ts, cron/nightly.ts
 * Consumes: trading212.ts, crypto.ts, prisma.ts, alert-service.ts
 * Risk-sensitive: NO — refreshes User.equity from broker totalValue.
 *                 Last-write-wins is correct semantics for this field; the
 *                 dashboard sync route (/api/trading212/sync) and these crons
 *                 race harmlessly because all writers agree on the source of
 *                 truth (T212 combined totalValue).
 * Notes: Audit fix F4 (2026-...). Before this helper, cron paths READ
 *        User.equity (auto-trade sizing, nightly snapshot, hourly status)
 *        but never WROTE it — so sizing and reporting drifted from broker
 *        reality whenever the operator went a while without opening the
 *        dashboard.
 */

import prisma from '@/lib/prisma';
import { Trading212Client } from '@/lib/trading212';
import type { T212AccountType } from '@/lib/trading212-dual';
import { decryptField } from '@/lib/crypto';
import { sendAlert } from '@/lib/alert-service';

export interface EquityRefreshResult {
  combinedTotalValueGbp: number;
  investTotalValue: number | null;
  isaTotalValue: number | null;
  /** True iff User.equity was updated. False if both accounts failed. */
  written: boolean;
}

interface DecryptedCreds {
  apiKey: string;
  apiSecret: string;
}

/**
 * Fetch T212 account summaries for both accounts and write the combined
 * totalValue to User.equity. Never throws — credential or API failures are
 * logged and the existing User.equity is left untouched (last-known-good).
 *
 * Duplicate-key handling mirrors /api/trading212/sync/route.ts: if Invest
 * and ISA use the same decrypted API key, ISA is skipped to avoid double-
 * counting the same holdings (H3 / 2026-05-16).
 */
export async function refreshUserEquityFromBroker(
  userId: string = 'default-user',
): Promise<EquityRefreshResult> {
  const empty: EquityRefreshResult = {
    combinedTotalValueGbp: 0,
    investTotalValue: null,
    isaTotalValue: null,
    written: false,
  };

  let user:
    | {
        t212ApiKey: string | null;
        t212ApiSecret: string | null;
        t212Environment: string;
        t212Connected: boolean;
        t212IsaApiKey: string | null;
        t212IsaApiSecret: string | null;
        t212IsaConnected: boolean;
      }
    | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212ApiKey: true,
        t212ApiSecret: true,
        t212Environment: true,
        t212Connected: true,
        t212IsaApiKey: true,
        t212IsaApiSecret: true,
        t212IsaConnected: true,
      },
    });
  } catch (err) {
    console.warn(`[equity-refresh] User lookup failed: ${(err as Error).message}`);
    return empty;
  }
  if (!user) return empty;

  const envType: 'demo' | 'live' = user.t212Environment === 'live' ? 'live' : 'demo';

  function decryptFor(accountType: T212AccountType): DecryptedCreds | null {
    const rawKey = accountType === 'isa' ? user!.t212IsaApiKey : user!.t212ApiKey;
    const rawSecret = accountType === 'isa' ? user!.t212IsaApiSecret : user!.t212ApiSecret;
    const connected = accountType === 'isa' ? user!.t212IsaConnected : user!.t212Connected;
    if (!rawKey || !connected) return null;
    try {
      return { apiKey: decryptField(rawKey), apiSecret: decryptField(rawSecret ?? '') };
    } catch (err) {
      // The canonical credential-decrypt alert is fired by the nightly path
      // (getNightlyT212Client). Here we just log to avoid double-alerting.
      console.warn(`[equity-refresh] T212 ${accountType} decrypt failed: ${(err as Error).message}`);
      return null;
    }
  }

  const investCreds = decryptFor('invest');
  const isaRawCreds = decryptFor('isa');
  const isaCreds =
    investCreds && isaRawCreds && investCreds.apiKey === isaRawCreds.apiKey
      ? null // duplicate API key — skip ISA, would double-count
      : isaRawCreds;

  async function fetchSummary(creds: DecryptedCreds, label: T212AccountType): Promise<number | null> {
    try {
      const client = new Trading212Client(creds.apiKey, creds.apiSecret, envType);
      const summary = await client.getAccountSummary();
      return typeof summary.totalValue === 'number' && summary.totalValue >= 0
        ? summary.totalValue
        : null;
    } catch (err) {
      console.warn(`[equity-refresh] T212 ${label} getAccountSummary failed: ${(err as Error).message}`);
      return null;
    }
  }

  const investTotal = investCreds ? await fetchSummary(investCreds, 'invest') : null;
  const isaTotal = isaCreds ? await fetchSummary(isaCreds, 'isa') : null;

  const combined = (investTotal ?? 0) + (isaTotal ?? 0);

  if (combined > 0 && (investTotal != null || isaTotal != null)) {
    try {
      await prisma.user.update({ where: { id: userId }, data: { equity: combined } });
      return {
        combinedTotalValueGbp: combined,
        investTotalValue: investTotal,
        isaTotalValue: isaTotal,
        written: true,
      };
    } catch (err) {
      console.warn(`[equity-refresh] User.equity update failed: ${(err as Error).message}`);
      sendAlert({
        type: 'SYSTEM',
        title: 'Equity refresh DB write failed',
        message: `Fetched combined £${combined.toFixed(2)} from T212 but could not persist to User.equity. Error: ${(err as Error).message}`,
        priority: 'WARNING',
        telegramDedupeKey: 'equity-refresh:db-write-fail',
        telegramThrottleMs: 6 * 60 * 60 * 1000,
      }).catch(() => {});
    }
  }

  return {
    combinedTotalValueGbp: combined,
    investTotalValue: investTotal,
    isaTotalValue: isaTotal,
    written: false,
  };
}
