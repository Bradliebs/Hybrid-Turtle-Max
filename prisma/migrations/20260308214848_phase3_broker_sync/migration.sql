-- AlterTable
ALTER TABLE "BrokerOrder" ADD COLUMN "accountId" TEXT;
ALTER TABLE "BrokerOrder" ADD COLUMN "accountType" TEXT;
ALTER TABLE "BrokerOrder" ADD COLUMN "lastSyncedAt" DATETIME;

-- CreateTable
CREATE TABLE "BrokerSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adapter" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "positionsCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "summaryJson" JSONB,
    "diffJson" JSONB,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BrokerPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerPositionId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "accountId" TEXT,
    "accountType" TEXT,
    "symbol" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "averagePrice" DECIMAL NOT NULL,
    "marketPrice" DECIMAL NOT NULL,
    "marketValue" DECIMAL NOT NULL,
    "unrealizedPnl" DECIMAL NOT NULL,
    "currency" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrokerPosition_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BrokerPosition" ("averagePrice", "brokerPositionId", "createdAt", "currency", "id", "instrumentId", "marketPrice", "marketValue", "quantity", "symbol", "unrealizedPnl", "updatedAt") SELECT "averagePrice", "brokerPositionId", "createdAt", "currency", "id", "instrumentId", "marketPrice", "marketValue", "quantity", "symbol", "unrealizedPnl", "updatedAt" FROM "BrokerPosition";
DROP TABLE "BrokerPosition";
ALTER TABLE "new_BrokerPosition" RENAME TO "BrokerPosition";
CREATE UNIQUE INDEX "BrokerPosition_brokerPositionId_key" ON "BrokerPosition"("brokerPositionId");
CREATE INDEX "BrokerPosition_symbol_idx" ON "BrokerPosition"("symbol");
CREATE INDEX "BrokerPosition_updatedAt_idx" ON "BrokerPosition"("updatedAt");
CREATE TABLE "new_PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerSyncRunId" TEXT,
    "snapshotAt" DATETIME NOT NULL,
    "accountId" TEXT,
    "accountType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'BROKER',
    "currency" TEXT NOT NULL,
    "cashBalance" DECIMAL NOT NULL,
    "equity" DECIMAL NOT NULL,
    "buyingPower" DECIMAL,
    "totalMarketValue" DECIMAL,
    "dailyPnl" DECIMAL,
    "rawPayloadJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_brokerSyncRunId_fkey" FOREIGN KEY ("brokerSyncRunId") REFERENCES "BrokerSyncRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PortfolioSnapshot" ("accountId", "buyingPower", "cashBalance", "createdAt", "currency", "dailyPnl", "equity", "id", "rawPayloadJson", "snapshotAt", "totalMarketValue") SELECT "accountId", "buyingPower", "cashBalance", "createdAt", "currency", "dailyPnl", "equity", "id", "rawPayloadJson", "snapshotAt", "totalMarketValue" FROM "PortfolioSnapshot";
DROP TABLE "PortfolioSnapshot";
ALTER TABLE "new_PortfolioSnapshot" RENAME TO "PortfolioSnapshot";
CREATE INDEX "PortfolioSnapshot_snapshotAt_idx" ON "PortfolioSnapshot"("snapshotAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BrokerSyncRun_startedAt_idx" ON "BrokerSyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "BrokerSyncRun_status_idx" ON "BrokerSyncRun"("status");
