<#
.SYNOPSIS
    Dashboard de monitoring pour plex-watchlist-sync
.EXAMPLE
    .\MONITOR.ps1
    .\MONITOR.ps1 -Watch
#>

param(
    [int]$Logs = 15,
    [switch]$Watch,
    [switch]$Compact
)

$Host.UI.RawUI.WindowTitle = "Plex Watchlist Bot - Monitor"

function Show-Dashboard {
    Clear-Host
    Write-Host ""
    Write-Host "  ╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║       PLEX WATCHLIST BOT - MONITORING                         ║" -ForegroundColor Cyan
    Write-Host "  ║       $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')                                    ║" -ForegroundColor Cyan
    Write-Host "  ╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2) {
        Write-Host "  ❌ PM2 non installé" -ForegroundColor Red
        return
    }

    Write-Host "  📊 PROCESSUS" -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray

    try {
        $list = pm2 jlist 2>$null | ConvertFrom-Json
        if ($list.Count -eq 0) {
            Write-Host "  ⚠️  Aucun processus" -ForegroundColor Yellow
        } else {
            foreach ($p in $list) {
                $status = $p.pm2_env.status
                $icon = if ($status -eq "online") { "🟢" } else { "🔴" }
                $color = if ($status -eq "online") { "Green" } else { "Red" }
                $mem = [math]::Round($p.monit.memory / 1MB, 1)

                Write-Host "  $icon $($p.name)" -ForegroundColor $color -NoNewline
                Write-Host " | $status | ${mem}MB | Restarts: $($p.pm2_env.restart_time)" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "  Erreur PM2" -ForegroundColor Red
    }

    Write-Host ""

    if (-not $Compact) {
        Write-Host "  📋 LOGS ($Logs lignes)" -ForegroundColor Yellow
        Write-Host "  ─────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
        pm2 logs --nostream --lines $Logs 2>&1 | ForEach-Object {
            if ($_ -match "error|❌") { Write-Host "  $_" -ForegroundColor Red }
            elseif ($_ -match "warn|⚠️") { Write-Host "  $_" -ForegroundColor Yellow }
            elseif ($_ -match "✅") { Write-Host "  $_" -ForegroundColor Green }
            else { Write-Host "  $_" -ForegroundColor Gray }
        }
        Write-Host ""
    }

    # Status Letterboxd
    $statusFile = Join-Path $PSScriptRoot "logs\letterboxd-status.json"
    if (Test-Path $statusFile) {
        Write-Host "  📅 DERNIER SYNC LETTERBOXD" -ForegroundColor Yellow
        Write-Host "  ─────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
        try {
            $s = Get-Content $statusFile | ConvertFrom-Json
            Write-Host "  • Terminé: $($s.finished_at)" -ForegroundColor Gray
            Write-Host "  • Films: $($s.total_films) | Succès: $($s.success_rate)" -ForegroundColor Gray
        } catch {}
        Write-Host ""
    }

    Write-Host "  💡 COMMANDES" -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  pm2 logs         " -NoNewline -ForegroundColor Cyan; Write-Host "Logs temps réel" -ForegroundColor Gray
    Write-Host "  pm2 restart all  " -NoNewline -ForegroundColor Cyan; Write-Host "Redémarrer" -ForegroundColor Gray
    Write-Host "  pm2 monit        " -NoNewline -ForegroundColor Cyan; Write-Host "Monitoring détaillé" -ForegroundColor Gray
    Write-Host ""
}

if ($Watch) {
    Write-Host "Mode surveillance (Ctrl+C pour quitter)" -ForegroundColor Cyan
    while ($true) { Show-Dashboard; Start-Sleep 5 }
} else {
    Show-Dashboard
}
