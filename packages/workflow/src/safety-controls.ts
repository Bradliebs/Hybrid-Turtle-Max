/**
 * DEPENDENCIES
 * Consumed by: packages/workflow/src/execution.ts, packages/workflow/src/index.ts, src/app/api/scan/route.ts, src/app/api/settings/kill-switches/route.ts, src/components/settings/SafetyControlsPanel.tsx, scripts/verify-phase10.ts
 * Consumes: packages/data/src/prisma.ts
 * Risk-sensitive: YES — blocks scan and submission flows when safety toggles are enabled
 * Last modified: 2026-03-09
 * Notes: Phase 10 kill-switch persistence and enforcement helpers.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../data/src/prisma';

const KILL_SWITCH_SETTINGS_KEY = 'phase10.kill-switches';

export interface KillSwitchSettings {
  disableAllSubmissions: boolean;
  disableAutomatedSubmissions: boolean;
  disableScansWhenDataStale: boolean;
  updatedAt: string | null;
}

export interface MarketDataSafetyStatus {
  isStale: boolean;
  staleSymbolCount: number;
  latestRefreshStatus: string | null;
  latestRefreshAt: string | null;
}

export class SafetyControlError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SafetyControlError';
  }
}

const DEFAULT_KILL_SWITCH_SETTINGS: KillSwitchSettings = {
  disableAllSubmissions: false,
  disableAutomatedSubmissions: false,
  disableScansWhenDataStale: true,
  updatedAt: null,
};

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeSettings(value: unknown): KillSwitchSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_KILL_SWITCH_SETTINGS;
  }

  const input = value as Partial<KillSwitchSettings>;

  return {
    disableAllSubmissions: input.disableAllSubmissions ?? DEFAULT_KILL_SWITCH_SETTINGS.disableAllSubmissions,
    disableAutomatedSubmissions: input.disableAutomatedSubmissions ?? DEFAULT_KILL_SWITCH_SETTINGS.disableAutomatedSubmissions,
    disableScansWhenDataStale: input.disableScansWhenDataStale ?? DEFAULT_KILL_SWITCH_SETTINGS.disableScansWhenDataStale,
    updatedAt: input.updatedAt ?? null,
  };
}

export async function getKillSwitchSettings(): Promise<KillSwitchSettings> {
  const record = await prisma.appSetting.findUnique({
    where: { key: KILL_SWITCH_SETTINGS_KEY },
    select: { valueJson: true },
  });

  return normalizeSettings(record?.valueJson);
}

export async function updateKillSwitchSettings(
  patch: Partial<Omit<KillSwitchSettings, 'updatedAt'>>,
): Promise<KillSwitchSettings> {
  const current = await getKillSwitchSettings();
  const updated: KillSwitchSettings = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await prisma.appSetting.upsert({
    where: { key: KILL_SWITCH_SETTINGS_KEY },
    update: {
      value: JSON.stringify(updated),
      valueJson: toInputJson(updated),
      description: 'Phase 10 kill-switch safety controls',
    },
    create: {
      key: KILL_SWITCH_SETTINGS_KEY,
      value: JSON.stringify(updated),
      valueJson: toInputJson(updated),
      description: 'Phase 10 kill-switch safety controls',
    },
  });

  return updated;
}

export async function getMarketDataSafetyStatus(): Promise<MarketDataSafetyStatus> {
  const [latestRefresh, staleSymbolCount] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobName: 'market-data.refresh-universe-daily-bars' },
      orderBy: { startedAt: 'desc' },
      select: { status: true, finishedAt: true },
    }),
    prisma.instrument.count({
      where: { isActive: true, isPriceDataStale: true },
    }),
  ]);

  const refreshFailed = latestRefresh?.status === 'FAILED';
  const isStale = refreshFailed || staleSymbolCount > 0;

  return {
    isStale,
    staleSymbolCount,
    latestRefreshStatus: latestRefresh?.status ?? null,
    latestRefreshAt: latestRefresh?.finishedAt?.toISOString() ?? null,
  };
}

export async function assertSubmissionAllowed(options: { automated: boolean }) {
  const settings = await getKillSwitchSettings();

  if (settings.disableAllSubmissions) {
    throw new SafetyControlError(
      'ALL_SUBMISSIONS_DISABLED',
      'All order submissions are currently disabled by the Phase 10 kill switch.'
    );
  }

  if (options.automated && settings.disableAutomatedSubmissions) {
    throw new SafetyControlError(
      'AUTOMATED_SUBMISSIONS_DISABLED',
      'Automated order submissions are currently disabled by the Phase 10 kill switch.'
    );
  }
}

export async function assertScanAllowed() {
  const settings = await getKillSwitchSettings();
  if (!settings.disableScansWhenDataStale) {
    return;
  }

  const marketData = await getMarketDataSafetyStatus();
  if (marketData.isStale) {
    throw new SafetyControlError(
      'SCANS_DISABLED_STALE_DATA',
      `Scans are blocked because market data is stale (${marketData.staleSymbolCount} stale symbols; latest refresh ${marketData.latestRefreshStatus ?? 'UNKNOWN'}).`
    );
  }
}