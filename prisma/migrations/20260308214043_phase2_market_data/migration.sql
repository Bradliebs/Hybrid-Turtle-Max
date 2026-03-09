-- CreateTable
CREATE TABLE "DataRefreshRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "requestedRange" TEXT NOT NULL,
    "requestedInterval" TEXT NOT NULL,
    "requestedSymbols" INTEGER NOT NULL,
    "succeededSymbols" INTEGER NOT NULL DEFAULT 0,
    "failedSymbols" INTEGER NOT NULL DEFAULT 0,
    "staleSymbols" INTEGER NOT NULL DEFAULT 0,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "summaryJson" JSONB,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DataRefreshResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataRefreshRunId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedRange" TEXT NOT NULL,
    "requestedInterval" TEXT NOT NULL,
    "barsFetched" INTEGER NOT NULL DEFAULT 0,
    "lastBarDate" DATETIME,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "staleAfterRun" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "rawMetaJson" JSONB,
    "rawEventsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataRefreshResult_dataRefreshRunId_fkey" FOREIGN KEY ("dataRefreshRunId") REFERENCES "DataRefreshRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DataRefreshResult_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dataSource" TEXT NOT NULL DEFAULT 'YAHOO',
    "isPriceDataStale" BOOLEAN NOT NULL DEFAULT true,
    "staleReason" TEXT,
    "staleAsOf" DATETIME,
    "lastPriceBarDate" DATETIME,
    "lastSuccessfulDataFetchAt" DATETIME,
    "lastFailedDataFetchAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Instrument" ("assetType", "createdAt", "currency", "exchange", "id", "isActive", "name", "symbol", "updatedAt") SELECT "assetType", "createdAt", "currency", "exchange", "id", "isActive", "name", "symbol", "updatedAt" FROM "Instrument";
DROP TABLE "Instrument";
ALTER TABLE "new_Instrument" RENAME TO "Instrument";
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DataRefreshRun_startedAt_idx" ON "DataRefreshRun"("startedAt");

-- CreateIndex
CREATE INDEX "DataRefreshRun_status_idx" ON "DataRefreshRun"("status");

-- CreateIndex
CREATE INDEX "DataRefreshResult_symbol_idx" ON "DataRefreshResult"("symbol");

-- CreateIndex
CREATE INDEX "DataRefreshResult_status_idx" ON "DataRefreshResult"("status");

-- CreateIndex
CREATE INDEX "DataRefreshResult_createdAt_idx" ON "DataRefreshResult"("createdAt");
