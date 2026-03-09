-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DailyBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "open" DECIMAL NOT NULL,
    "high" DECIMAL NOT NULL,
    "low" DECIMAL NOT NULL,
    "close" DECIMAL NOT NULL,
    "volume" BIGINT NOT NULL,
    "adjustedClose" DECIMAL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyBar_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotAt" DATETIME NOT NULL,
    "accountId" TEXT,
    "currency" TEXT NOT NULL,
    "cashBalance" DECIMAL NOT NULL,
    "equity" DECIMAL NOT NULL,
    "buyingPower" DECIMAL,
    "totalMarketValue" DECIMAL,
    "dailyPnl" DECIMAL,
    "rawPayloadJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BrokerPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerPositionId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "averagePrice" DECIMAL NOT NULL,
    "marketPrice" DECIMAL NOT NULL,
    "marketValue" DECIMAL NOT NULL,
    "unrealizedPnl" DECIMAL NOT NULL,
    "currency" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrokerPosition_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrokerOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerOrderId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "plannedTradeId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "filledQuantity" DECIMAL,
    "limitPrice" DECIMAL,
    "stopPrice" DECIMAL,
    "averageFillPrice" DECIMAL,
    "submittedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "rawPayloadJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrokerOrder_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BrokerOrder_plannedTradeId_fkey" FOREIGN KEY ("plannedTradeId") REFERENCES "PlannedTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlannedTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "plannedQuantity" DECIMAL NOT NULL,
    "plannedEntryType" TEXT NOT NULL,
    "plannedEntryPrice" DECIMAL,
    "plannedStopPrice" DECIMAL NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionSessionDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "notes" TEXT,
    CONSTRAINT "PlannedTrade_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProtectiveStop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "linkedPositionId" TEXT,
    "stopPrice" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "brokerReference" TEXT,
    "lastVerifiedAt" DATETIME,
    "alertState" TEXT NOT NULL DEFAULT 'OK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProtectiveStop_linkedPositionId_fkey" FOREIGN KEY ("linkedPositionId") REFERENCES "BrokerPosition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "universeSize" INTEGER,
    "staleSymbolCount" INTEGER,
    "notes" TEXT,
    "parametersJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SignalCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalRunId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "currentPrice" DECIMAL,
    "triggerPrice" DECIMAL,
    "initialStop" DECIMAL,
    "stopDistancePercent" DECIMAL,
    "riskPerShare" DECIMAL,
    "setupStatus" TEXT NOT NULL,
    "rankScore" DECIMAL,
    "reasonsJson" JSONB,
    "warningsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalCandidate_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalCandidate_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotAt" DATETIME NOT NULL,
    "openRisk" DECIMAL NOT NULL,
    "accountEquity" DECIMAL,
    "cashBalance" DECIMAL,
    "concentrationJson" JSONB,
    "ruleViolationsJson" JSONB,
    "riskLevel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "detailsJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "valueText" TEXT,
    "valueJson" JSONB,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");

-- CreateIndex
CREATE INDEX "DailyBar_date_idx" ON "DailyBar"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBar_instrumentId_date_source_key" ON "DailyBar"("instrumentId", "date", "source");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_snapshotAt_idx" ON "PortfolioSnapshot"("snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerPosition_brokerPositionId_key" ON "BrokerPosition"("brokerPositionId");

-- CreateIndex
CREATE INDEX "BrokerPosition_symbol_idx" ON "BrokerPosition"("symbol");

-- CreateIndex
CREATE INDEX "BrokerPosition_updatedAt_idx" ON "BrokerPosition"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerOrder_brokerOrderId_key" ON "BrokerOrder"("brokerOrderId");

-- CreateIndex
CREATE INDEX "BrokerOrder_symbol_idx" ON "BrokerOrder"("symbol");

-- CreateIndex
CREATE INDEX "BrokerOrder_status_idx" ON "BrokerOrder"("status");

-- CreateIndex
CREATE INDEX "PlannedTrade_symbol_idx" ON "PlannedTrade"("symbol");

-- CreateIndex
CREATE INDEX "PlannedTrade_executionSessionDate_idx" ON "PlannedTrade"("executionSessionDate");

-- CreateIndex
CREATE INDEX "PlannedTrade_status_idx" ON "PlannedTrade"("status");

-- CreateIndex
CREATE INDEX "ProtectiveStop_symbol_idx" ON "ProtectiveStop"("symbol");

-- CreateIndex
CREATE INDEX "ProtectiveStop_status_idx" ON "ProtectiveStop"("status");

-- CreateIndex
CREATE INDEX "SignalRun_startedAt_idx" ON "SignalRun"("startedAt");

-- CreateIndex
CREATE INDEX "SignalRun_status_idx" ON "SignalRun"("status");

-- CreateIndex
CREATE INDEX "SignalCandidate_symbol_idx" ON "SignalCandidate"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "SignalCandidate_signalRunId_symbol_key" ON "SignalCandidate"("signalRunId", "symbol");

-- CreateIndex
CREATE INDEX "RiskSnapshot_snapshotAt_idx" ON "RiskSnapshot"("snapshotAt");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");
