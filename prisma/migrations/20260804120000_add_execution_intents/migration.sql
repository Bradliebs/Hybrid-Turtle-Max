CREATE TABLE "ExecutionIntent" (
    "operationId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "activePayloadHash" TEXT,
    "ticker" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "orderId" TEXT,
    "positionId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "ExecutionIntent_userId_createdAt_idx"
ON "ExecutionIntent"("userId", "createdAt");

CREATE INDEX "ExecutionIntent_status_idx"
ON "ExecutionIntent"("status");

CREATE UNIQUE INDEX "ExecutionIntent_activePayloadHash_key"
ON "ExecutionIntent"("activePayloadHash");