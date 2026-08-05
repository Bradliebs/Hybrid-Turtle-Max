ALTER TABLE "ExecutionIntent" ADD COLUMN "stockId" TEXT;
ALTER TABLE "ExecutionIntent" ADD COLUMN "requestedQuantity" REAL;
ALTER TABLE "ExecutionIntent" ADD COLUMN "stopPrice" REAL;
ALTER TABLE "ExecutionIntent" ADD COLUMN "baselineQuantity" REAL;
ALTER TABLE "ExecutionIntent" ADD COLUMN "baselineAveragePrice" REAL;
ALTER TABLE "ExecutionIntent" ADD COLUMN "brokerSubmittedAt" DATETIME;
ALTER TABLE "ExecutionIntent" ADD COLUMN "stopOrderId" TEXT;