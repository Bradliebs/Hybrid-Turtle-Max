#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
    Preview or repair HybridTurtle unattended task settings and watchdog timing.
.DESCRIPTION
    Preserves task owners, actions and non-watchdog schedules. Apply requires an
    administrator shell, exports original XML before writes, verifies results,
    and attempts rollback on failure. Does not manually start tasks.
.PARAMETER Apply
    Apply the reviewed settings. Without this switch the operation is read-only.
.EXAMPLE
    pwsh -NoProfile -File scripts/Repair-AutomationTasks.ps1
.EXAMPLE
    pwsh -NoProfile -File scripts/Repair-AutomationTasks.ps1 -Apply
.NOTES
    Restoring scheduled execution can allow normal jobs to run, including trades.
#>
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Get-AutomationTaskState.ps1')

function Get-RepairedAutomationTaskXml {
    [CmdletBinding()]
    [OutputType([xml])]
    param([Parameter(Mandatory)][xml]$TaskXml, [Parameter(Mandatory)][string]$TaskName)
    $Result = [xml]$TaskXml.OuterXml
    $NamespaceUri = 'http://schemas.microsoft.com/windows/2004/02/mit/task'
    $Namespace = [System.Xml.XmlNamespaceManager]::new($Result.NameTable)
    $Namespace.AddNamespace('t', $NamespaceUri)
    $Principal = $Result.SelectSingleNode('/t:Task/t:Principals/t:Principal', $Namespace)
    if ($Principal.LogonType -notin @('InteractiveToken', 'S4U')) {
        throw "Unsupported logon type for $TaskName; preserve it for manual review."
    }
    $Principal.LogonType = 'S4U'
    $Settings = $Result.SelectSingleNode('/t:Task/t:Settings', $Namespace)
    foreach ($Setting in @('WakeToRun', 'StartWhenAvailable')) {
        $Node = $Settings.SelectSingleNode("t:$Setting", $Namespace)
        if (-not $Node) {
            $Node = $Result.CreateElement($Setting, $NamespaceUri)
            $null = $Settings.AppendChild($Node)
        }
        $Node.InnerText = 'true'
    }
    if ($TaskName -eq 'HybridTurtle Watchdog') {
        $Triggers = $Result.SelectSingleNode('/t:Task/t:Triggers', $Namespace)
        $Triggers.RemoveAll()
        foreach ($Time in @('10:05', '13:05', '16:05', '19:05', '22:05')) {
            $Trigger = $Result.CreateElement('CalendarTrigger', $NamespaceUri)
            foreach ($Field in @(@('StartBoundary', "2026-01-01T${Time}:00"), @('Enabled', 'true'))) {
                $Node = $Result.CreateElement($Field[0], $NamespaceUri)
                $Node.InnerText = $Field[1]
                $null = $Trigger.AppendChild($Node)
            }
            $Daily = $Result.CreateElement('ScheduleByDay', $NamespaceUri)
            $Interval = $Result.CreateElement('DaysInterval', $NamespaceUri)
            $Interval.InnerText = '1'
            $null = $Daily.AppendChild($Interval)
            $null = $Trigger.AppendChild($Daily)
            $null = $Triggers.AppendChild($Trigger)
        }
    }
    return $Result
}

if ($MyInvocation.InvocationName -ne '.') {
    $Updated = [System.Collections.Generic.List[object]]::new()
    $BackupDirectory = $null
    try {
        if ($Apply -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Apply requires an administrator PowerShell. No elevation is requested automatically.'
        }
        $RepoRoot = Split-Path -Parent $PSScriptRoot
        $Drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($RepoRoot))
        if ($Drive.DriveType -ne [System.IO.DriveType]::Fixed) {
            throw 'Unattended S4U repair requires a local fixed drive, not a mapped/network drive.'
        }
        foreach ($Required in @('.env', 'prisma/dev.db')) {
            $Item = Get-Item -LiteralPath (Join-Path $RepoRoot $Required)
            if ($Item.Attributes -band [System.IO.FileAttributes]::Encrypted) {
                throw "S4U cannot use EFS-encrypted $Required; manual account configuration is required."
            }
        }
        Push-Location $RepoRoot
        try {
            $ManifestJson = & node --input-type=module -e "import {EXPECTED_TASKS} from './scripts/audit-scheduled-tasks.mjs'; console.log(JSON.stringify(EXPECTED_TASKS));"
            if ($LASTEXITCODE -ne 0) { throw 'Could not load the scheduler manifest.' }
            $Manifest = $ManifestJson | ConvertFrom-Json
        } finally { Pop-Location }

        $Plans = @(foreach ($Expected in $Manifest) {
            $Task = Get-ScheduledTask -TaskName $Expected.name -TaskPath '\'
            if ($Task.State -ne 'Ready') { throw "Task $($Expected.name) is not Ready; retry during a quiet window." }
            $Before = [xml](Export-ScheduledTask -TaskName $Task.TaskName -TaskPath $Task.TaskPath)
            $ExpectedPath = Join-Path $RepoRoot $Expected.requiredPath
            $Actions = [string]$Before.Task.Actions.InnerText
            if ($Actions.IndexOf($ExpectedPath, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw "Unexpected action target for $($Task.TaskName); refusing to change it."
            }
            $After = Get-RepairedAutomationTaskXml -TaskXml $Before -TaskName $Task.TaskName
            [pscustomobject]@{ Name = $Task.TaskName; Before = $Before; After = $After }
        })
        $Plans | ForEach-Object {
            [pscustomobject]@{ Task = $_.Name; Logon = 'S4U'; WakeToRun = $true; StartWhenAvailable = $true;
                Schedule = $(if ($_.Name -eq 'HybridTurtle Watchdog') { 'Daily 10:05,13:05,16:05,19:05,22:05' } else { 'Preserved' }) }
        } | Format-Table -AutoSize
        if (-not $Apply) {
            Write-Host 'Preview only. Run this command with -Apply in an administrator PowerShell to update tasks.'
            exit 0
        }

        $BackupDirectory = Join-Path $RepoRoot "prisma/backups/automation-tasks-$([datetime]::UtcNow.ToString('yyyyMMdd-HHmmss'))-$([guid]::NewGuid().ToString('N'))"
        $null = New-Item -ItemType Directory -Path $BackupDirectory
        foreach ($Plan in $Plans) {
            $Plan.Before.Save((Join-Path $BackupDirectory "$($Plan.Name).xml"))
        }
        foreach ($Plan in $Plans) {
            $Current = Get-ScheduledTask -TaskName $Plan.Name -TaskPath '\'
            $CurrentXml = [xml](Export-ScheduledTask -TaskName $Plan.Name -TaskPath '\')
            if ($Current.State -ne 'Ready' -or $CurrentXml.OuterXml -ne $Plan.Before.OuterXml) {
                throw "Task $($Plan.Name) changed after inspection; aborting."
            }
            $Updated.Add($Plan)
            $null = Register-ScheduledTask -TaskName $Plan.Name -TaskPath '\' -Xml $Plan.After.OuterXml -Force
            $Actual = [xml](Export-ScheduledTask -TaskName $Plan.Name -TaskPath '\')
            $ExpectedState = Get-AutomationTaskState -TaskXml $Plan.After -TaskName $Plan.Name | ConvertTo-Json -Depth 5 -Compress
            $ActualState = Get-AutomationTaskState -TaskXml $Actual -TaskName $Plan.Name | ConvertTo-Json -Depth 5 -Compress
            if ($ActualState -ne $ExpectedState -or $Actual.Task.Actions.OuterXml -ne $Plan.Before.Task.Actions.OuterXml -or
                $Actual.Task.Principals.Principal.UserId -ne $Plan.Before.Task.Principals.Principal.UserId -or
                $Actual.Task.Principals.Principal.RunLevel -ne $Plan.Before.Task.Principals.Principal.RunLevel -or
                $Actual.Task.Settings.ExecutionTimeLimit -ne $Plan.Before.Task.Settings.ExecutionTimeLimit) {
                throw "Verification failed for $($Plan.Name)."
            }
        }
        [pscustomobject]@{ AppliedAt = [datetime]::UtcNow.ToString('o'); Tasks = @($Updated | ForEach-Object Name) } |
            ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $BackupDirectory 'receipt.json') -Encoding utf8
        Write-Host "Applied and verified $($Updated.Count) tasks. Original XML: $BackupDirectory"
    } catch {
        Write-Error -ErrorAction Continue $_.Exception.Message
        for ($Index = $Updated.Count - 1; $Index -ge 0; $Index--) {
            $Plan = $Updated[$Index]
            try {
                $null = Register-ScheduledTask -TaskName $Plan.Name -TaskPath '\' -Xml $Plan.Before.OuterXml -Force
                Write-Warning "Restored original definition for $($Plan.Name)."
            } catch {
                Write-Error -ErrorAction Continue "ROLLBACK FAILED for $($Plan.Name); original XML is in $BackupDirectory."
            }
        }
        exit 1
    }
}