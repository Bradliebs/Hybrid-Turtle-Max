@echo off
:: ============================================================
:: HybridTurtle — Telegram Heartbeat (alert-channel meta-alarm)
:: ============================================================
:: Sends a once-daily "alive" ping over Telegram. If delivery
:: fails, writes a CRITICAL in-app notification so the operator
:: notices that the alert channel itself is down. Audit
:: 2026-06-16 (HIGH-3).
:: Schedule via Task Scheduler to run Daily at 07:00 UK.
:: ============================================================

title HybridTurtle Telegram Heartbeat
setlocal
cd /d "%~dp0"

:: Ensure migrations are current
call node scripts/auto-migrate.mjs --quiet 2>nul

:: Run the heartbeat
call npx tsx src/cron/telegram-heartbeat.ts --run-now

endlocal
