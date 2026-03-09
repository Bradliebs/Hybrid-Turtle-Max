-- CreateTable
CREATE TABLE "EveningWorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionDate" DATETIME NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "summaryJson" JSONB,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EveningWorkflowStepRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eveningWorkflowRunId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "detailsJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EveningWorkflowStepRun_eveningWorkflowRunId_fkey" FOREIGN KEY ("eveningWorkflowRunId") REFERENCES "EveningWorkflowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EveningWorkflowRun_sessionDate_idx" ON "EveningWorkflowRun"("sessionDate");

-- CreateIndex
CREATE INDEX "EveningWorkflowRun_startedAt_idx" ON "EveningWorkflowRun"("startedAt");

-- CreateIndex
CREATE INDEX "EveningWorkflowRun_status_idx" ON "EveningWorkflowRun"("status");

-- CreateIndex
CREATE INDEX "EveningWorkflowStepRun_eveningWorkflowRunId_stepKey_idx" ON "EveningWorkflowStepRun"("eveningWorkflowRunId", "stepKey");

-- CreateIndex
CREATE INDEX "EveningWorkflowStepRun_startedAt_idx" ON "EveningWorkflowStepRun"("startedAt");

-- CreateIndex
CREATE INDEX "EveningWorkflowStepRun_status_idx" ON "EveningWorkflowStepRun"("status");
