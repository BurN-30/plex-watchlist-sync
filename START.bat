@echo off
title Plex Watchlist Bot (Dev Mode)
echo ========================================
echo   PLEX WATCHLIST BOT - Mode Dev
echo ========================================
echo.
echo Pour la production, utilisez PM2:
echo   pm2 start ecosystem.config.cjs
echo.
echo ----------------------------------------
echo.
node index.js
echo.
echo ----------------------------------------
echo Bot arrêté.
pause
