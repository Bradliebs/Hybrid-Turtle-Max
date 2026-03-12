-- Breakout evidence capture: passive Layer 2 fields on SnapshotTicker
-- Advisory only — no impact on scan decisions or risk gates

ALTER TABLE "SnapshotTicker" ADD COLUMN "isBreakout20" BOOLEAN;
ALTER TABLE "SnapshotTicker" ADD COLUMN "breakoutDistancePct" REAL;
ALTER TABLE "SnapshotTicker" ADD COLUMN "breakoutWindowDays" INTEGER;
ALTER TABLE "SnapshotTicker" ADD COLUMN "entropy63" REAL;
ALTER TABLE "SnapshotTicker" ADD COLUMN "netIsolation" REAL;
ALTER TABLE "SnapshotTicker" ADD COLUMN "entropyObsCount" INTEGER;
ALTER TABLE "SnapshotTicker" ADD COLUMN "netIsolationPeerCount" INTEGER;
ALTER TABLE "SnapshotTicker" ADD COLUMN "netIsolationObsCount" INTEGER;
ALTER TABLE "SnapshotTicker" ADD COLUMN "novelSignalVersion" INTEGER;
