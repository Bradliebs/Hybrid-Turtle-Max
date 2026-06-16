# ============================================================
# HybridTurtle - Register Telegram Heartbeat Scheduled Task
# ============================================================
# Sends a daily Telegram "alive" ping at 07:00 UK time. If the
# delivery fails, writes a CRITICAL in-app notification so the
# operator notices that the alert channel itself is down.
# Audit 2026-06-16 (HIGH-3).
# ============================================================

param([switch]$FromBat)

# Self-elevate if not running as admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

# Locate repo root (this script lives in scripts/, repo root is one up)
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "  ==========================================================" -ForegroundColor Cyan
Write-Host "   HybridTurtle - Registering Telegram Heartbeat Task" -ForegroundColor Cyan
Write-Host "  ==========================================================" -ForegroundColor Cyan
Write-Host ""

try {
    $existing = Get-ScheduledTask -TaskName "HybridTurtle-TelegramHeartbeat" -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Removing existing task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName "HybridTurtle-TelegramHeartbeat" -Confirm:$false
    }

    $Action = New-ScheduledTaskAction `
        -Execute "cmd.exe" `
        -Argument "/c `"$RepoRoot\telegram-heartbeat-task.bat`"" `
        -WorkingDirectory "$RepoRoot"

    # Daily at 07:00 — before any UK trade session, before briefings
    $Trigger = New-ScheduledTaskTrigger -Daily -At 07:00

    $Settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

    $Principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERNAME" `
        -LogonType S4U `
        -RunLevel Highest

    $task = Register-ScheduledTask `
        -TaskName "HybridTurtle-TelegramHeartbeat" `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description "HybridTurtle daily Telegram alert-channel meta-alarm (07:00 UK)"

    Write-Host ""
    Write-Host "  Task registered successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Schedule: Daily at 07:00" -ForegroundColor White
    Write-Host "  Action:   telegram-heartbeat-task.bat" -ForegroundColor White
    Write-Host "  Timeout:  5 minutes" -ForegroundColor White
    Write-Host ""
    Write-Host "  To test now:  double-click telegram-heartbeat-task.bat" -ForegroundColor Yellow
    Write-Host "  To remove:    schtasks /delete /tn `"HybridTurtle-TelegramHeartbeat`" /f" -ForegroundColor Yellow
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "  FAILED to register task: $_" -ForegroundColor Red
    Write-Host ""
}

if (-NOT $FromBat) {
    Write-Host "Press any key to close..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
