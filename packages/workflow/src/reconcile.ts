import { runBrokerSync } from '../../broker/src';
import { runProtectiveStopWorkflow } from '../../stops/src';
import type { ReconciliationResult, StopVerificationResult } from './types';

export async function verifyProtectiveStops(workflowRunId?: string): Promise<StopVerificationResult> {
  const result = await runProtectiveStopWorkflow(
    workflowRunId
      ? {
          entityType: 'EveningWorkflowRun',
          entityId: workflowRunId,
        }
      : {},
  );

  return {
    positionsChecked: result.positionsChecked,
    missingStopsCreated: result.missingStopsCreated,
    verifiedStops: result.verifiedStops,
    activeStops: result.activeStops,
    missingStops: result.missingStops,
    mismatchedStops: result.mismatchedStops,
    failedStops: result.failedStops,
    closedStops: result.closedStops,
  };
}

export async function reconcileStopsAndPositions(workflowRunId?: string): Promise<ReconciliationResult> {
  const brokerSyncResult = await runBrokerSync();
  const stopVerification = await verifyProtectiveStops(workflowRunId);

  return {
    brokerSyncRunId: brokerSyncResult.runId,
    discrepancyCount: brokerSyncResult.discrepancyCount,
    positionsCount: brokerSyncResult.positionsCount,
    ordersCount: brokerSyncResult.ordersCount,
    stopVerification,
  };
}