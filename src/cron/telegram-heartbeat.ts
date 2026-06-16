/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler — Daily at 07:00 UK (one ping per day is enough)
 * Consumes: telegram.ts, prisma.ts, alert-service.ts, cron-logger.ts, uk-time.ts
 * Risk-sensitive: NO — read-only ping, no trading actions
 *
 * Usage: npx tsx src/cron/telegram-heartbeat.ts --run-now
 *
 * Purpose
 * ───────
 * Meta-alarm for the alert pipeline. Silent-failure protection added by
 * audit 2026-06-16 (HIGH-3): if Telegram credentials become undecryptable
 * (e.g. NEXTAUTH_SECRET rotated without ENCRYPTION_SECRET set), every
 * production alert quietly drops to DB-only and the operator does not
 * notice until they manually open the dashboard.
 *
 * What it does
 * ────────────
 * 1. Sends a one-line "alive" ping via sendTelegramMessage.
 * 2. On success: writes Heartbeat(kind='TELEGRAM_HEARTBEAT', status='OK').
 * 3. On failure: writes Heartbeat(kind='TELEGRAM_HEARTBEAT', status='FAILED')
 *    AND a CRITICAL Notification (DB-only — Telegram is broken so don't
 *    try Layer 2). The next dashboard load surfaces the bell badge.
 * 4. Independently, looks at the most recent successful TELEGRAM_HEARTBEAT
 *    and if it's >24h old (i.e. yesterday's run failed and today's also
 *    failed), the failure notification message includes that fact.
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKTimeString } from '@/lib/uk-time';

const log = createCronLogger('telegram-heartbeat');
const RUN_NOW = process.argv.includes('--run-now');

async function runTelegramHeartbeat() {
  log.info('Telegram heartbeat starting');

  const ts = getUKTimeString();
  const text = `🟢 HybridTurtle alert channel alive — ${ts}`;

  let sent = false;
  let sendError: string | null = null;
  try {
    sent = await sendTelegramMessage({ text, parseMode: 'HTML' });
  } catch (err) {
    sendError = (err as Error).message;
    sent = false;
  }

  if (sent) {
    try {
      await prisma.heartbeat.create({
        data: {
          kind: 'TELEGRAM_HEARTBEAT',
          status: 'OK',
          details: JSON.stringify({ type: 'telegram-heartbeat', ts }),
        },
      });
    } catch (dbErr) {
      log.warn('Failed to write OK heartbeat', { error: (dbErr as Error).message });
    }
    log.info('Telegram heartbeat OK');
    console.log(`[telegram-heartbeat] OK at ${ts}`);
    return;
  }

  // Telegram delivery failed. Look up the last successful ping for context.
  let lastOk: Date | null = null;
  try {
    const last = await prisma.heartbeat.findFirst({
      where: { kind: 'TELEGRAM_HEARTBEAT', status: 'OK' },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });
    lastOk = last?.timestamp ?? null;
  } catch (dbErr) {
    log.warn('Failed to query last OK heartbeat', { error: (dbErr as Error).message });
  }

  const hoursSinceLastOk = lastOk
    ? (Date.now() - lastOk.getTime()) / (1000 * 60 * 60)
    : null;
  const lastOkLine = lastOk
    ? `Last successful Telegram delivery: ${lastOk.toISOString()} (${hoursSinceLastOk!.toFixed(1)}h ago)`
    : 'No successful Telegram delivery has ever been recorded.';

  log.error('Telegram heartbeat FAILED', { lastOk: lastOk?.toISOString() ?? null, sendError });
  console.error(`[telegram-heartbeat] FAILED at ${ts} — ${lastOkLine}`);

  // Persist the failure heartbeat (best-effort).
  try {
    await prisma.heartbeat.create({
      data: {
        kind: 'TELEGRAM_HEARTBEAT',
        status: 'FAILED',
        details: JSON.stringify({ type: 'telegram-heartbeat', ts, lastOkAt: lastOk?.toISOString() ?? null, sendError }),
      },
    });
  } catch (dbErr) {
    log.warn('Failed to write FAILED heartbeat', { error: (dbErr as Error).message });
  }

  // Persist a DB-only Notification. We do NOT call sendAlert here, because
  // sendAlert's Layer 2 would attempt Telegram again and the noise of that
  // retry obscures the diagnostic. The bell badge on the dashboard is the
  // surface that catches the operator's eye on next page load.
  try {
    await prisma.notification.create({
      data: {
        type: 'SYSTEM',
        title: 'Telegram alert channel down',
        message:
          `Daily Telegram heartbeat failed to deliver.\n\n` +
          `${lastOkLine}\n\n` +
          (sendError ? `Send error: ${sendError}\n\n` : '') +
          `Likely causes:\n` +
          `  - Bot token / chat ID unset or wrong\n` +
          `  - Stored credentials undecryptable (NEXTAUTH_SECRET rotation?)\n` +
          `  - Telegram API outage\n\n` +
          `Until resolved, all production alerts (UNPROTECTED_POSITION, ` +
          `STOP_HIT, ORPHAN_T212_FILL, backup failure, etc.) will only ` +
          `appear in the in-app notification centre — no push.`,
        priority: 'CRITICAL',
      },
    });
  } catch (dbErr) {
    log.error('Failed to write Telegram-down notification', { error: (dbErr as Error).message });
  }

  // Exit non-zero so the Windows Task Scheduler "Last Result" surfaces the
  // failure in the audit script and watchdog.
  process.exitCode = 1;
}

if (RUN_NOW) {
  runTelegramHeartbeat()
    .catch((err) => {
      console.error('[telegram-heartbeat] Top-level failure:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { runTelegramHeartbeat };
