# VIEW_TASKS.ps1 - Display All Scheduled Tasks
Write-Host "📋 WINDOWS SCHEDULED TASKS DASHBOARD" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$Tasks = Get-ScheduledTask | Where-Object { $_.State -ne "Disabled" -and $_.TaskPath -notlike "\Microsoft\*" }

if ($Tasks.Count -eq 0) {
    Write-Host "No active scheduled tasks found." -ForegroundColor Yellow
    exit
}

Write-Host "Found $($Tasks.Count) active task(s):" -ForegroundColor Green
Write-Host ""

foreach ($Task in $Tasks) {
    $Info = Get-ScheduledTaskInfo -TaskName $Task.TaskName -ErrorAction SilentlyContinue
    
    Write-Host "Task: $($Task.TaskName)" -ForegroundColor Cyan
    Write-Host "  State: $($Task.State)" -ForegroundColor White
    
    if ($Info.NextRunTime) {
        Write-Host "  Next Run: $($Info.NextRunTime)" -ForegroundColor Green
    }
    Write-Host ""
}

Write-Host "To open Task Scheduler: taskschd.msc" -ForegroundColor Yellow
