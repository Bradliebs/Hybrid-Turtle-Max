-- Near-stop alert: prevent duplicate nightly alerts for positions approaching stop-loss
ALTER TABLE "Position" ADD COLUMN "nearStopAlertSentAt" DATETIME;
