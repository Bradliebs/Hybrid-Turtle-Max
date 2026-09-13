#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
    Read structured HybridTurtle scheduler settings without changing tasks.
.DESCRIPTION
    Exports only operational settings, using the Windows XML parser.
.EXAMPLE
    pwsh -NoProfile -File scripts/Get-AutomationTaskState.ps1
.NOTES
    Used by the read-only scheduler audit.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

function Get-AutomationTaskState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][xml]$TaskXml, [Parameter(Mandatory)][string]$TaskName)
    $Namespace = [System.Xml.XmlNamespaceManager]::new($TaskXml.NameTable)
    $Namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $Triggers = @($TaskXml.SelectNodes('/t:Task/t:Triggers/*', $Namespace) | ForEach-Object {
        [pscustomobject]@{
            type = $_.LocalName
            enabled = $_.Enabled -ne 'false'
            startBoundary = [string]$_.StartBoundary
            endBoundary = [string]$_.EndBoundary
            daysInterval = [string]$_.ScheduleByDay.DaysInterval
            interval = [string]$_.Repetition.Interval
            duration = [string]$_.Repetition.Duration
            randomDelay = [string]$_.RandomDelay
        }
    })
    [pscustomobject]@{
        name = $TaskName
        logonType = [string]$TaskXml.Task.Principals.Principal.LogonType
        wakeToRun = $TaskXml.Task.Settings.WakeToRun -eq 'true'
        startWhenAvailable = $TaskXml.Task.Settings.StartWhenAvailable -eq 'true'
        triggers = $Triggers
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $States = @(Get-ScheduledTask | Where-Object TaskName -Like 'HybridTurtle*' | ForEach-Object {
            Get-AutomationTaskState -TaskName $_.TaskName -TaskXml ([xml](Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath))
        })
        ConvertTo-Json -InputObject $States -Depth 5 -Compress
    } catch {
        Write-Error -ErrorAction Continue "Scheduler inspection failed: $($_.Exception.Message)"
        exit 1
    }
}