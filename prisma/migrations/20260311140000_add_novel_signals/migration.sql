-- Novel signals — passive capture for Phase 6 prediction engine
-- Advisory only — no impact on scan decisions or risk gates

ALTER TABLE "SnapshotTicker" ADD COLUMN "smartMoney21" REAL;
ALTER TABLE "SnapshotTicker" ADD COLUMN "fractalDim" REAL;
ALTER TABLE "SnapshotTicker" ADD COLUMN "complexity" REAL;
