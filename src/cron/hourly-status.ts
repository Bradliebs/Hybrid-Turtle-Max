/**
 * DEPENDENCIES
 * Consumed by: hourly-status-task.bat, Windows Task Scheduler
 * Consumes: prisma.ts, telegram.ts, market-data.ts, risk-gates.ts, scan-engine.ts, safety-controls.ts, position-sync.ts
 * Risk-sensitive: YES (audit F3+F8, 2026-) — now calls syncClosedPositions
 *                 before reporting to close the count-drift window (Telegram
 *                 was reporting stale OPEN counts up to 2–3h after a T212
 *                 stop-out). Sync uses the same safety guards as midday-sync;
 *                 only closes a DB position when T212 confirms it is gone.
 * Last modified: 2026-
 * Notes: Sends hourly Telegram status during market hours (08:00–21:00 UK Mon-Fri).
 *        Reports portfolio state, blockers, candidate readiness, and system health.
 *        Position reconciliation is best-effort — failure does not block the report.
 */
/**
 * HybridTurtle Hourly Status — Telegram Status Updates
 *
 * Sends detailed Telegram updates during market hours showing:
 *   - Portfolio snapshot (equity, open risk, P&L)
 *   - Trade blockers (regime, health, kill switch, gates)
 *   - READY candidates and their distance to trigger
 *   - Open position status with R-multiples
 *   - System health indicators
 *
 * Runs every hour during UK market hours (08:00–21:00 Mon-Fri).
 * Read-only — no trades, no stop changes, no mutations.
 *
 * Usage:
 *   npx tsx src/cron/hourly-status.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { getBatchPrices, normalizeBatchPricesToGBP, getMarketRegime } from '@/lib/market-data';
import { fetchT212LivePrices } from '@/lib/position-sync';
import { getKillSwitchSettings, isAutoTradingEnabled, getMarketDataSafetyStatus } from '../../packages/workflow/src';
import { RISK_PROFILES, type RiskProfileType, type Sleeve } from '@/types';
import { getUKDayOfWeek, getUKHour, getUKTimeString } from '@/lib/uk-time';
import { createCronLogger } from '@/lib/cron-logger';
import { isEarlyCloseDay } from '@/lib/market-holidays';

const log = createCronLogger('hourly-status');

// ── Helpers ──────────────────────────────────────────────────

function formatCurrency(value: number, symbol = '£'): string {
  return `${symbol}${Math.abs(value).toFixed(2)}`;
}

// ── Main ─────────────────────────────────────────────────────

async function runHourlyStatus() {
  const userId = 'default-user';
  const ukHour = getUKHour();
  const ukDay = getUKDayOfWeek();

  console.log(`[HybridTurtle] Hourly status check — ${getUKTimeString()}`);

  // Skip weekends
  if (ukDay === 0 || ukDay === 6) {
    console.log('  Weekend — skipping.');
    return;
  }

  // Skip outside market hours (08:00–21:00 UK)
  if (ukHour < 8 || ukHour >= 21) {
    console.log(`  Outside market hours (${ukHour}:00 UK) — skipping.`);
    return;
  }

  try {
    // Audit fix F3+F8 (2026-): reconcile DB positions against T212 BEFORE
    // reading them, so the Telegram status reflects current broker reality
    // (previously stop-outs were invisible until the next midday-sync, up
    // to 2–3h later). detectUntrackedSales=false matches midday-sync — we
    // only close positions T212 confirms are gone, never adjust quantities.
    try {
      const { syncClosedPositions } = await import('@/lib/position-sync');
      const syncResult = await syncClosedPositions(userId, { detectUntrackedSales: false });
      if (syncResult.closed > 0) {
        console.log(`  Pre-status sync closed ${syncResult.closed} position(s) detected as gone in T212`);
      }
    } catch (syncErr) {
      console.warn(`  Pre-status sync failed (non-fatal): ${(syncErr as Error).message}`);
    }

    // ── Gather data (read-only from here, all wrapped in try/catch) ──

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { riskProfile: true, equity: true },
    });
    const equity = user?.equity || 0;
    const riskProfile = (user?.riskProfile || 'BALANCED') as RiskProfileType;
    const profile = RISK_PROFILES[riskProfile];

    // Open positions with live prices
    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
      orderBy: { entryDate: 'asc' },
    });

    const tickers = positions.map(p => p.stock.ticker);
    // T212 real-time prices as primary, Yahoo as fallback
    const t212Prices = tickers.length > 0 ? await fetchT212LivePrices(userId) : {};
    const missingTickers = tickers.filter(t => !t212Prices[t]);
    const yahooFallback = missingTickers.length > 0 ? await getBatchPrices(missingTickers) : {};
    const prices: Record<string, number> = { ...yahooFallback, ...t212Prices };
    const currencies: Record<string, string | null> = {};
    for (const p of positions) currencies[p.stock.ticker] = p.stock.currency;
    const gbpPrices = tickers.length > 0 ? await normalizeBatchPricesToGBP(prices, currencies) : {};

    // Market regime
    let regime = 'UNKNOWN';
    try { regime = await getMarketRegime(); } catch { /* use UNKNOWN */ }

    // Safety controls
    const killSwitch = await getKillSwitchSettings();
    const autoEnabled = await isAutoTradingEnabled();
    const marketDataStatus = await getMarketDataSafetyStatus();

    // Health check
    const latestHealth = await prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    });

    // Latest scan results (READY candidates)
    const latestScan = await prisma.scan.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          where: { status: 'READY', passesAllFilters: true },
          orderBy: { rankScore: 'desc' },
          take: 10,
          include: { stock: true },
        },
      },
    });

    // Last heartbeat for auto-trade
    const lastAutoTrade = await prisma.heartbeat.findFirst({
      where: { details: { contains: 'auto-trade' } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, status: true, details: true },
    });

    // ── Build Telegram message ──

    const healthEmoji = latestHealth?.overall === 'GREEN' ? '🟢'
      : latestHealth?.overall === 'YELLOW' ? '🟡' : '🔴';
    const regimeEmoji = regime === 'BULLISH' ? '🟢' : regime === 'SIDEWAYS' ? '🟡' : regime === 'BEARISH' ? '🔴' : '⚪';

    const lines: string[] = [
      `⏰ <b>HybridTurtle Status — ${getUKTimeString()}</b>`,
      '',
    ];

    // Note early-close half-days
    const earlyClose = isEarlyCloseDay();
    if (earlyClose) {
      lines.push(`📅 <i>Early-close day — US market closes at ${earlyClose} ET</i>`, '');
    }

    // ── Portfolio snapshot ──
    let totalUnrealisedPnl = 0;
    let totalOpenRisk = 0;
    let totalMarketValue = 0;
    // Audit fix F5 (2026-): track tickers where no live price is available.
    // Previous behaviour silently substituted entryPrice, which falsely
    // reported 0% P&L and inaccurate open risk.
    const stalePriceTickers: string[] = [];

    for (const p of positions) {
      const livePrice = gbpPrices[p.stock.ticker] ?? prices[p.stock.ticker];
      const currentPrice = livePrice ?? p.entryPrice;
      if (livePrice == null) stalePriceTickers.push(p.stock.ticker);
      const rawPrice = prices[p.stock.ticker] || p.entryPrice;
      const fxRatio = rawPrice > 0 ? currentPrice / rawPrice : 1;
      const entryGbp = p.entryPrice * fxRatio;
      const stopGbp = p.currentStop * fxRatio;
      totalUnrealisedPnl += (currentPrice - entryGbp) * p.shares;
      totalOpenRisk += Math.max(0, (currentPrice - stopGbp) * p.shares);
      totalMarketValue += currentPrice * p.shares;
    }

    const openRiskPct = equity > 0 ? (totalOpenRisk / equity) * 100 : 0;
    const pnlEmoji = totalUnrealisedPnl >= 0 ? '🟩' : '🟥';

    lines.push(
      `<b>Portfolio</b>`,
      `  Equity: ${formatCurrency(equity)} | Positions: ${positions.length}/${profile.maxPositions}`,
      `  ${pnlEmoji} Unrealised: ${totalUnrealisedPnl >= 0 ? '+' : ''}${formatCurrency(totalUnrealisedPnl)}`,
      `  Open risk: ${openRiskPct.toFixed(1)}% / ${profile.maxOpenRisk}%`,
      '',
    );

    // ── Positions detail ──
    if (positions.length > 0) {
      lines.push(`<b>Positions</b>`);
      for (const p of positions) {
        const livePrice = prices[p.stock.ticker];
        const currentPrice = livePrice ?? p.entryPrice;
        const staleMark = livePrice == null ? ' 🟧' : '';
        const initialR = p.initialRisk || (p.entryPrice - p.stopLoss) || 1;
        const rMultiple = (currentPrice - p.entryPrice) / initialR;
        const pnlPct = p.entryPrice > 0 ? ((currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
        const posEmoji = rMultiple >= 0 ? '🟩' : '🟥';
        const protLevel = p.protectionLevel || 'INITIAL';
        lines.push(`  ${posEmoji} <b>${p.stock.ticker}</b>${staleMark} ${currentPrice.toFixed(2)} | ${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(1)}R | ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% | Stop: ${p.currentStop.toFixed(2)} [${protLevel}]`);
      }
      // Audit fix F5: explicit stale warning so operator does not trust the
      // entry-price-substituted values.
      if (stalePriceTickers.length > 0) {
        lines.push(`  🟧 Stale prices (using entry): ${stalePriceTickers.join(', ')}`);
      }
      lines.push('');
    }

    // ── Blockers ──
    const blockers: string[] = [];
    if (regime !== 'BULLISH') blockers.push(`${regimeEmoji} Regime: ${regime}`);
    if (latestHealth?.overall === 'RED') blockers.push('🔴 Health: RED');
    if (killSwitch.disableAllSubmissions) blockers.push('🚫 Kill switch: ALL submissions disabled');
    if (killSwitch.disableAutomatedSubmissions) blockers.push('🚫 Kill switch: automated submissions disabled');
    if (marketDataStatus.isStale) blockers.push(`⚠️ Stale market data (${marketDataStatus.staleSymbolCount} symbols)`);
    if (!autoEnabled) blockers.push('⏸ Auto-trading: OFF');
    if (positions.length >= profile.maxPositions) blockers.push(`📊 Max positions reached (${positions.length}/${profile.maxPositions})`);
    if (openRiskPct >= profile.maxOpenRisk) blockers.push(`📊 Open risk at limit (${openRiskPct.toFixed(1)}%/${profile.maxOpenRisk}%)`);

    // Audit fix F2 (2026-): surface unresolved STOP_MISMATCH notifications so
    // stop drift is visible every hour, not just once per 12h Telegram window.
    // The in-app dedupe is the Notification.readAt flag — the operator clears
    // these from the dashboard once they act on them.
    try {
      const driftNotes = await prisma.notification.findMany({
        where: {
          type: 'STOP_MISMATCH',
          readAt: null,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { createdAt: true, title: true },
      });
      for (const n of driftNotes) {
        const ageHr = Math.round((Date.now() - n.createdAt.getTime()) / 3600000);
        blockers.push(`🚨 ${n.title} (${ageHr}h ago, unread)`);
      }
    } catch (driftErr) {
      console.warn(`  Stop-drift notification check failed: ${(driftErr as Error).message}`);
    }

    // Audit fix F6 (2026-): surface unresolved ORPHAN_T212_FILL notifications.
    // An orphan = live T212 position with no DB row → invisible to dashboard
    // and stop manager. Operator MUST reconcile (manual Position insert) and
    // then mark the notification read.
    try {
      const orphanNotes = await prisma.notification.findMany({
        where: {
          type: 'ORPHAN_T212_FILL',
          readAt: null,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { createdAt: true, title: true },
      });
      for (const n of orphanNotes) {
        const ageHr = Math.round((Date.now() - n.createdAt.getTime()) / 3600000);
        blockers.push(`🚨 ${n.title} (${ageHr}h ago, RECONCILE)`);
      }
    } catch (orphanErr) {
      console.warn(`  Orphan-fill notification check failed: ${(orphanErr as Error).message}`);
    }

    if (blockers.length > 0) {
      lines.push(`<b>⛔ Blockers (${blockers.length})</b>`);
      for (const b of blockers) lines.push(`  ${b}`);
    } else {
      lines.push(`<b>✅ No blockers — clear to trade</b>`);
    }
    lines.push('');

    // ── READY candidates ──
    const readyCandidates = latestScan?.results ?? [];
    const openTickers = new Set(positions.map(p => p.stock.ticker));
    const newCandidates = readyCandidates.filter(c => !openTickers.has(c.stock.ticker));

    if (newCandidates.length > 0) {
      lines.push(`<b>📋 READY Candidates (${newCandidates.length})</b>`);
      for (const c of newCandidates.slice(0, 8)) {
        const distEmoji = c.distancePercent <= 1 ? '🔥' : c.distancePercent <= 2 ? '📍' : '📌';
        lines.push(`  ${distEmoji} <b>${c.stock.ticker}</b> — rank ${c.rankScore.toFixed(1)} | ${c.distancePercent.toFixed(1)}% from trigger | stop ${c.stopPrice.toFixed(2)}`);
      }
      if (newCandidates.length > 8) {
        lines.push(`  ... and ${newCandidates.length - 8} more`);
      }
    } else {
      lines.push('📋 No READY candidates');
    }
    lines.push('');

    // ── System status ──
    lines.push(`<b>System</b>`);
    lines.push(`  Health: ${healthEmoji} ${latestHealth?.overall ?? 'UNKNOWN'} | Regime: ${regimeEmoji} ${regime}`);
    lines.push(`  Auto-trade: ${autoEnabled ? '✅ ON' : '⏸ OFF'}`);
    // Audit fix F13 (2026-): explicit freshness watermark so the operator
    // can tell at a glance whether they are reading a current report or a
    // stuck cron run.
    lines.push(`  Data refreshed: ${getUKTimeString()} UK`);

    if (lastAutoTrade) {
      const ago = Math.round((Date.now() - new Date(lastAutoTrade.timestamp).getTime()) / 3600000);
      let details = '';
      try {
        const d = JSON.parse(lastAutoTrade.details || '{}');
        details = ` (${d.session || '?'}: ${d.executed ?? 0} executed, ${d.failed ?? 0} failed)`;
      } catch { /* ignore */ }
      lines.push(`  Last auto-trade: ${ago}h ago — ${lastAutoTrade.status}${details}`);
    }

    // ── Send ──
    await sendTelegramMessage({ text: lines.join('\n') });
    console.log('  ✓ Hourly status sent via Telegram');

  } catch (err) {
    console.error('  ✗ Hourly status failed:', err);
    // Try to send error notification (throttled — repeated failures within 1h dedupe)
    try {
      const { sendThrottledTelegramAlert } = await import('@/lib/telegram');
      const { ALERT_CATEGORY } = await import('@/lib/alert-categories');
      await sendThrottledTelegramAlert(
        { text: `⚠️ Hourly status failed: ${(err as Error).message}` },
        ALERT_CATEGORY.HOURLY_STATUS_FAIL
      );
    } catch { /* give up */ }
  } finally {
    await prisma.$disconnect();
  }
}

// ── Entry point ───────────────────────────────
// Only auto-execute when run as a script, not when imported by a test.
// Production cron invokes via hourly-status-task.bat → tsx with neither
// VITEST nor NODE_ENV=test set, so this gate is a no-op there.
if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  const args = process.argv.slice(2);
  if (args.includes('--run-now')) {
    console.log('[HybridTurtle] Running hourly status immediately');
  }

  runHourlyStatus().then(() => process.exit(0)).catch((err) => {
    console.error('Fatal error in hourly status:', err);
    process.exit(1);
  });
}
