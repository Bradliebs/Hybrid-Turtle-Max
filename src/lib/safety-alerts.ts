/**
 * DEPENDENCIES
 * Consumed by: src/app/api/alerts/active/route.ts, src/app/alerts/page.tsx, src/components/dashboard/SafetyAlertsPanel.tsx, scripts/verify-phase10.ts
 * Consumes: src/lib/alert-service.ts, src/lib/prisma.ts, packages/stops/src/index.ts, packages/risk/src/account-state.ts, packages/workflow/src/index.ts
 * Risk-sensitive: YES — surfaces dangerous states and can emit notifications/Telegram alerts through cooldown-controlled sync
 * Last modified: 2026-03-09
 * Notes: Phase 10 active-alert projection and sync layer.
 */
import prisma from '@/lib/prisma';
import { sendAlert, type AlertPriority, type NotificationType } from '@/lib/alert-service';
import { getStopDashboardData } from '../../packages/stops/src';
import { getAccountRiskState } from '../../packages/risk/src/account-state';
import { getKillSwitchSettings, getMarketDataSafetyStatus, type KillSwitchSettings } from '../../packages/workflow/src';

export type SafetyAlertKind =
  | 'STALE_MARKET_DATA'
  | 'BROKER_SYNC_FAILURE'
  | 'UNPROTECTED_POSITION'
  | 'STOP_MISMATCH'
  | 'FAILED_ORDER'
  | 'EXCESSIVE_DRAWDOWN'
  | 'RISK_LIMIT_BREACH';

export interface SafetyAlert {
  kind: SafetyAlertKind;
  severity: AlertPriority;
  title: string;
  message: string;
  count: number;
  actionHref: string;
  updatedAt: string | null;
}

export interface SafetyAlertSnapshot {
  summary: {
    total: number;
    critical: number;
    warning: number;
  };
  killSwitches: KillSwitchSettings;
  alerts: SafetyAlert[];
}

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const EXCESSIVE_DRAWDOWN_THRESHOLD_PCT = -10;
const CRITICAL_DRAWDOWN_THRESHOLD_PCT = -15;

function buildAlert(
  kind: SafetyAlertKind,
  severity: AlertPriority,
  title: string,
  message: string,
  count: number,
  actionHref: string,
  updatedAt: string | null,
): SafetyAlert {
  return { kind, severity, title, message, count, actionHref, updatedAt };
}

function parseViolationCount(ruleViolationsJson: unknown): number {
  if (!Array.isArray(ruleViolationsJson)) {
    return 0;
  }
  return ruleViolationsJson.length;
}

async function getDrawdownState() {
  const [user, snapshots] = await Promise.all([
    prisma.user.findUnique({
      where: { id: 'default-user' },
      select: { equity: true, startingEquityOverride: true },
    }),
    prisma.equitySnapshot.findMany({
      orderBy: { capturedAt: 'asc' },
      select: { equity: true, capturedAt: true },
    }),
  ]);

  const series = snapshots.map((snapshot) => ({
    equity: snapshot.equity,
    capturedAt: snapshot.capturedAt,
  }));

  if (series.length === 0 && user?.equity == null) {
    return { drawdownPct: null as number | null, updatedAt: null as string | null };
  }

  const peak = Math.max(
    ...(series.map((snapshot) => snapshot.equity)),
    user?.startingEquityOverride ?? Number.NEGATIVE_INFINITY,
    user?.equity ?? Number.NEGATIVE_INFINITY,
  );

  const currentEquity = series.length > 0 ? series[series.length - 1].equity : (user?.equity ?? null);
  if (currentEquity == null || !Number.isFinite(peak) || peak <= 0) {
    return { drawdownPct: null as number | null, updatedAt: series.at(-1)?.capturedAt.toISOString() ?? null };
  }

  const drawdownPct = ((currentEquity - peak) / peak) * 100;
  return {
    drawdownPct,
    updatedAt: series.at(-1)?.capturedAt.toISOString() ?? null,
  };
}

export async function getActiveSafetyAlerts(): Promise<SafetyAlertSnapshot> {
  const [
    killSwitches,
    marketData,
    latestBrokerSync,
    stopDashboard,
    failedOrders,
    latestRiskSnapshot,
    accountRiskState,
    drawdownState,
  ] = await Promise.all([
    getKillSwitchSettings(),
    getMarketDataSafetyStatus(),
    prisma.brokerSyncRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { status: true, finishedAt: true },
    }),
    getStopDashboardData(),
    prisma.brokerOrder.findMany({
      where: { status: 'REJECTED' },
      take: 20,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, symbol: true, updatedAt: true },
    }),
    prisma.riskSnapshot.findFirst({
      orderBy: { snapshotAt: 'desc' },
      select: { totalOpenRiskPct: true, maxOpenRiskPct: true, ruleViolationsJson: true, snapshotAt: true },
    }),
    getAccountRiskState(),
    getDrawdownState(),
  ]);

  const alerts: SafetyAlert[] = [];

  if (marketData.isStale) {
    alerts.push(
      buildAlert(
        'STALE_MARKET_DATA',
        marketData.latestRefreshStatus === 'FAILED' ? 'CRITICAL' : 'WARNING',
        'Stale market data',
        `Market data is stale for ${marketData.staleSymbolCount} active symbol(s). Latest refresh status: ${marketData.latestRefreshStatus ?? 'UNKNOWN'}.`,
        marketData.staleSymbolCount,
        '/settings',
        marketData.latestRefreshAt,
      ),
    );
  }

  if (latestBrokerSync?.status === 'FAILED') {
    alerts.push(
      buildAlert(
        'BROKER_SYNC_FAILURE',
        'CRITICAL',
        'Broker sync failed',
        'The latest broker sync failed. Local portfolio state may be stale until the next successful sync.',
        1,
        '/jobs',
        latestBrokerSync.finishedAt?.toISOString() ?? null,
      ),
    );
  }

  if (stopDashboard.summary.unprotectedCount > 0) {
    alerts.push(
      buildAlert(
        'UNPROTECTED_POSITION',
        'CRITICAL',
        'Unprotected positions detected',
        `${stopDashboard.summary.unprotectedCount} live position(s) do not have an active protective stop.`,
        stopDashboard.summary.unprotectedCount,
        '/stops',
        stopDashboard.rows[0]?.verificationTime ?? null,
      ),
    );
  }

  if (stopDashboard.summary.mismatchedCount > 0) {
    alerts.push(
      buildAlert(
        'STOP_MISMATCH',
        'WARNING',
        'Stop mismatch detected',
        `${stopDashboard.summary.mismatchedCount} live position(s) have a local stop state that does not match broker verification.`,
        stopDashboard.summary.mismatchedCount,
        '/stops',
        stopDashboard.rows.find((row) => row.status === 'MISMATCHED')?.verificationTime ?? null,
      ),
    );
  }

  if (failedOrders.length > 0) {
    alerts.push(
      buildAlert(
        'FAILED_ORDER',
        'CRITICAL',
        'Failed order detected',
        `${failedOrders.length} rejected broker order(s) are recorded locally. Review the execution log before submitting again.`,
        failedOrders.length,
        '/orders',
        failedOrders[0]?.updatedAt.toISOString() ?? null,
      ),
    );
  }

  if (drawdownState.drawdownPct != null && drawdownState.drawdownPct <= EXCESSIVE_DRAWDOWN_THRESHOLD_PCT) {
    alerts.push(
      buildAlert(
        'EXCESSIVE_DRAWDOWN',
        drawdownState.drawdownPct <= CRITICAL_DRAWDOWN_THRESHOLD_PCT ? 'CRITICAL' : 'WARNING',
        'Excessive drawdown',
        `Account equity is ${Math.abs(drawdownState.drawdownPct).toFixed(1)}% below the recorded peak. Review exposure and new-trade activity.`,
        1,
        '/portfolio/positions',
        drawdownState.updatedAt,
      ),
    );
  }

  const openRiskPct = latestRiskSnapshot?.totalOpenRiskPct ?? accountRiskState.openRiskPct;
  const maxOpenRiskPct = latestRiskSnapshot?.maxOpenRiskPct ?? 10;
  const violationCount = parseViolationCount(latestRiskSnapshot?.ruleViolationsJson ?? null);
  if (openRiskPct > maxOpenRiskPct || violationCount > 0) {
    alerts.push(
      buildAlert(
        'RISK_LIMIT_BREACH',
        'CRITICAL',
        'Risk limit breach',
        `Open risk is ${openRiskPct.toFixed(2)}% against a ${maxOpenRiskPct.toFixed(2)}% limit${violationCount > 0 ? `, with ${violationCount} stored rule violation(s)` : ''}.`,
        violationCount > 0 ? violationCount : 1,
        '/risk',
        latestRiskSnapshot?.snapshotAt.toISOString() ?? null,
      ),
    );
  }

  const critical = alerts.filter((alert) => alert.severity === 'CRITICAL').length;
  const warning = alerts.filter((alert) => alert.severity === 'WARNING').length;

  return {
    summary: {
      total: alerts.length,
      critical,
      warning,
    },
    killSwitches,
    alerts,
  };
}

export async function syncActiveSafetyAlerts(): Promise<SafetyAlertSnapshot> {
  const snapshot = await getActiveSafetyAlerts();

  for (const alert of snapshot.alerts) {
    const recent = await prisma.notification.findFirst({
      where: {
        type: alert.kind,
        title: alert.title,
        createdAt: {
          gte: new Date(Date.now() - ALERT_COOLDOWN_MS),
        },
      },
      select: { id: true },
    });

    if (recent) {
      continue;
    }

    await sendAlert({
      type: alert.kind as NotificationType,
      title: alert.title,
      message: alert.message,
      priority: alert.severity,
      data: {
        count: alert.count,
        actionHref: alert.actionHref,
        updatedAt: alert.updatedAt,
      },
    });
  }

  return snapshot;
}