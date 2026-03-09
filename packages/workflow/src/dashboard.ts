import { countDraftPlannedTradesForNextSession, getCurrentSessionDate, getLatestWorkflowRun, getNextExecutionSessionDate } from './repository';
import type { TonightWorkflowActionKey, TonightWorkflowCardData } from './types';

const actionDefinitions: Array<{ key: TonightWorkflowActionKey; label: string; description: string }> = [
  { key: 'refresh-data', label: 'Refresh Data', description: 'Refresh the tracked universe after market close.' },
  { key: 'run-scan', label: 'Run Scan', description: 'Generate tonight\'s next-session candidates.' },
  { key: 'review-candidates', label: 'Review Candidates', description: 'Inspect top setups and bucket counts.' },
  { key: 'review-risk', label: 'Review Risk', description: 'Review open risk, concentration, and missing stops.' },
  { key: 'generate-plan', label: 'Generate Plan', description: 'Create draft next-session planned trades.' },
  { key: 'sync-broker', label: 'Sync Broker', description: 'Refresh local broker-backed portfolio state.' },
  { key: 'verify-stops', label: 'Verify Stops', description: 'Confirm every open position has a protective stop record.' },
];

export async function getTonightWorkflowCardData(): Promise<TonightWorkflowCardData> {
  const [latestRun, draftTrades] = await Promise.all([getLatestWorkflowRun(), countDraftPlannedTradesForNextSession()]);
  const latestStepByKey = new Map<string, { status: string; finishedAt: Date | null }>();

  for (const step of latestRun?.steps ?? []) {
    latestStepByKey.set(step.stepKey, {
      status: step.status,
      finishedAt: step.finishedAt,
    });
  }

  return {
    title: 'Tonight\'s Workflow',
    summary: {
      lastRunAt: latestRun?.finishedAt?.toISOString() ?? null,
      lastRunStatus: latestRun?.status ?? null,
      currentSessionDate: getCurrentSessionDate().toISOString(),
    },
    actions: actionDefinitions.map((action) => ({
      key: action.key,
      label: action.label,
      description: action.description,
      lastStatus: latestStepByKey.get(action.key)?.status ?? null,
      lastFinishedAt: latestStepByKey.get(action.key)?.finishedAt?.toISOString() ?? null,
    })),
    latestPlan: {
      executionSessionDate: getNextExecutionSessionDate().toISOString(),
      draftTrades,
    },
  };
}