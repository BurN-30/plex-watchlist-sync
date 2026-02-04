<#
.SYNOPSIS
    Installation automatisée de PM2 pour plex-watchlist-sync

.DESCRIPTION
    Installe PM2, configure le service Windows, et démarre le bot.

.EXAMPLE
    .\INSTALL-PM2.ps1
    .\INSTALL-PM2.ps1 -SkipService
#>

param(
    [switch]$SkipService,
    [switch]$SkipPython,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

function Write-Step { param($msg) Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "  ❌ $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║       PLEX WATCHLIST BOT - INSTALLATION PM2                   ║" -ForegroundColor Magenta
Write-Host "  ╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $SkipService) {
    Write-Warn "Non admin - service Windows ignoré"
    $SkipService = $true
}

# Vérification prérequis
Write-Step "Vérification des prérequis..."

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Err "Node.js non installé"; exit 1 }
Write-Success "Node.js $(node --version)"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Write-Err "npm non installé"; exit 1 }
Write-Success "npm v$(npm --version)"

if (-not $SkipPython) {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) { Write-Success "$(python --version)" }
    else { Write-Warn "Python non installé"; $SkipPython = $true }
}

# Installation npm
Write-Step "Installation dépendances npm..."
Push-Location $ProjectRoot
try {
    npm install 2>&1 | Out-Null
    Write-Success "Dépendances npm OK"
} finally { Pop-Location }

# Installation PM2
Write-Step "Installation PM2..."
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2 -or $Force) {
    npm install -g pm2 2>&1 | Out-Null
}
Write-Success "PM2 v$(pm2 --version)"

pm2 install pm2-logrotate 2>&1 | Out-Null
pm2 set pm2-logrotate:max_size 10M 2>&1 | Out-Null
pm2 set pm2-logrotate:retain 5 2>&1 | Out-Null
Write-Success "pm2-logrotate configuré"

# Installation Python
if (-not $SkipPython) {
    Write-Step "Installation dépendances Python..."
    $req = "$ProjectRoot\requirements.txt"
    if (Test-Path $req) {
        python -m pip install -r $req --quiet 2>&1 | Out-Null
        Write-Success "Dépendances Python OK"
    }
}

# Création dossiers
Write-Step "Création dossiers..."
@("logs", "feeds") | ForEach-Object {
    $dir = Join-Path $ProjectRoot $_
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}
Write-Success "Dossiers créés"

# Vérification config
Write-Step "Vérification configuration..."
if (-not (Test-Path "$ProjectRoot\config.json")) {
    Write-Warn "config.json manquant - copiez config.example.json"
} else { Write-Success "config.json OK" }

# Mise à jour chemin ecosystem.config.cjs
$ecosystemFile = "$ProjectRoot\ecosystem.config.cjs"
if (Test-Path $ecosystemFile) {
    $content = Get-Content $ecosystemFile -Raw
    # Utiliser variable d'environnement ou chemin actuel
    Write-Success "ecosystem.config.cjs OK"
}

# Démarrage PM2
Write-Step "Démarrage PM2..."
Push-Location $ProjectRoot
try {
    pm2 delete all 2>&1 | Out-Null
    pm2 start ecosystem.config.cjs 2>&1 | Out-Null
    Write-Success "Applications démarrées"
    pm2 list
    pm2 save 2>&1 | Out-Null
    Write-Success "Configuration sauvegardée"
} finally { Pop-Location }

# Service Windows
if (-not $SkipService) {
    Write-Step "Installation service Windows..."
    $svc = Get-Command pm2-service-install -ErrorAction SilentlyContinue
    if (-not $svc) {
        npm install -g pm2-windows-service 2>&1 | Out-Null
    }
    Write-Host ""
    Write-Host "  Répondez: Yes, Yes, $env:USERPROFILE\.pm2, No, Yes" -ForegroundColor Yellow
    pm2-service-install -n PM2
}

# Résumé
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║       INSTALLATION TERMINÉE !                                 ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Commandes utiles:" -ForegroundColor Cyan
Write-Host "    pm2 list              - État des processus"
Write-Host "    pm2 logs              - Logs en temps réel"
Write-Host "    pm2 restart all       - Redémarrer"
Write-Host "    .\MONITOR.ps1         - Dashboard"
Write-Host ""
