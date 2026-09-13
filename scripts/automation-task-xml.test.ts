import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('Windows task XML repair', () => {
  it('changes only unattended settings and watchdog timing, without mutating the source', () => {
    const result = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
      . ./scripts/Repair-AutomationTasks.ps1
      $Original = [xml]'<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><CalendarTrigger><StartBoundary>2026-01-01T10:05:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Principals><Principal id="Author"><UserId>S-1-5-21-test</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals><Settings><ExecutionTimeLimit>PT10M</ExecutionTimeLimit><WakeToRun>false</WakeToRun><StartWhenAvailable>false</StartWhenAvailable><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy></Settings><Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c test.bat --scheduled</Arguments></Exec></Actions></Task>'
      $Before = $Original.OuterXml
      $Watchdog = Get-RepairedAutomationTaskXml -TaskXml $Original -TaskName 'HybridTurtle Watchdog'
      $Trade = Get-RepairedAutomationTaskXml -TaskXml $Original -TaskName 'HybridTurtle-Trade-US'
      $Again = Get-RepairedAutomationTaskXml -TaskXml $Watchdog -TaskName 'HybridTurtle Watchdog'
      [pscustomobject]@{
        sourceUnchanged = $Original.OuterXml -eq $Before
        actionsUnchanged = $Watchdog.Task.Actions.OuterXml -eq $Original.Task.Actions.OuterXml
        ownerUnchanged = $Watchdog.Task.Principals.Principal.UserId -eq $Original.Task.Principals.Principal.UserId
        runLevelUnchanged = $Watchdog.Task.Principals.Principal.RunLevel -eq $Original.Task.Principals.Principal.RunLevel
        limitUnchanged = $Watchdog.Task.Settings.ExecutionTimeLimit -eq 'PT10M'
        overlapUnchanged = $Watchdog.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew'
        tradeScheduleUnchanged = $Trade.Task.Triggers.OuterXml -eq $Original.Task.Triggers.OuterXml
        idempotent = $Again.OuterXml -eq $Watchdog.OuterXml
        state = Get-AutomationTaskState -TaskXml $Watchdog -TaskName 'HybridTurtle Watchdog'
      } | ConvertTo-Json -Depth 5 -Compress
    `], { encoding: 'utf8', timeout: 20_000 });
    const output = JSON.parse(result);
    for (const key of ['sourceUnchanged', 'actionsUnchanged', 'ownerUnchanged', 'runLevelUnchanged',
      'limitUnchanged', 'overlapUnchanged', 'tradeScheduleUnchanged', 'idempotent']) {
      expect(output[key], key).toBe(true);
    }
    expect(output.state).toMatchObject({ logonType: 'S4U', wakeToRun: true, startWhenAvailable: true });
    expect(output.state.triggers.map((trigger: { startBoundary: string }) => trigger.startBoundary.slice(11, 16)))
      .toEqual(['10:05', '13:05', '16:05', '19:05', '22:05']);
    expect(output.state.triggers.every((trigger: { daysInterval: string; enabled: boolean }) =>
      trigger.daysInterval === '1' && trigger.enabled)).toBe(true);
  });
});