# ==================================================
# SETUP_TASK.ps1 - Configure Windows Task Scheduler
# ==================================================
# This script creates a scheduled task to run the bot daily at 5:00 AM

Write-Host "🔧 Configuration de la tâche planifiée Windows..." -ForegroundColor Cyan

$TaskName = "Plex-Watchlist-Bot"
$ScriptPath = Join-Path $PSScriptRoot "START.bat"
$WorkingDir = $PSScriptRoot

# Check if task already exists
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($ExistingTask) {
    Write-Host "⚠️  La tâche '$TaskName' existe déjà." -ForegroundColor Yellow
    $Response = Read-Host "Voulez-vous la remplacer ? (O/N)"
    if ($Response -ne "O" -and $Response -ne "o") {
        Write-Host "❌ Opération annulée." -ForegroundColor Red
        exit
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "🗑️  Ancienne tâche supprimée." -ForegroundColor Yellow
}

# Create the scheduled task
$Action = New-ScheduledTaskAction -Execute $ScriptPath -WorkingDirectory $WorkingDir
$Trigger = New-ScheduledTaskTrigger -Daily -At "05:00"
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Runs Plex Watchlist Bot daily at 5:00 AM"

Write-Host "✅ Tâche planifiée créée avec succès !" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Détails de la tâche :" -ForegroundColor Cyan
Write-Host "  • Nom: $TaskName"
Write-Host "  • Heure: Tous les jours à 5h00"
Write-Host "  • Script: $ScriptPath"
Write-Host ""
Write-Host "💡 Pour gérer vos tâches planifiées :" -ForegroundColor Yellow
Write-Host "   Tapez: taskschd.msc" -ForegroundColor White
Write-Host ""
Write-Host "🔍 Pour tester immédiatement :" -ForegroundColor Yellow
Write-Host "   Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
