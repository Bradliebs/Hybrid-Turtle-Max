CREATE TABLE IF NOT EXISTS "BacktestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'FULL',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "replayDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "initialCapital" REAL NOT NULL,
    "riskPerTradePct" REAL NOT NULL,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "completedTrades" INTEGER NOT NULL DEFAULT 0,
    "winRate" REAL,
    "averageR" REAL,
    "totalReturnPct" REAL,
    "maxDrawdownPct" REAL,
    "filtersJson" JSONB,
    "summaryJson" JSONB,
    "tradesJson" JSONB,
    "equityCurveJson" JSONB,
    "drawdownCurveJson" JSONB,
    "errorMessage" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

CREATE INDEX IF NOT EXISTS "BacktestRun_requestedAt_idx" ON "BacktestRun"("requestedAt");
CREATE INDEX IF NOT EXISTS "BacktestRun_status_idx" ON "BacktestRun"("status");