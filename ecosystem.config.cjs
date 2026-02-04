// ═══════════════════════════════════════════════════════════════════════════
// ecosystem.config.cjs - Configuration PM2 pour plex-watchlist-sync
// Documentation: https://pm2.keymetrics.io/docs/usage/application-declaration/
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    // ═══════════════════════════════════════════════════════════════
    // APP 1: Bot Principal (Node.js) - Tourne H24
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'plex-watchlist-bot',
      script: 'index.js',

      // ⚠️ IMPORTANT: Modifier ce chemin selon votre installation
      // Exemple Windows: 'C:\\Users\\VotreNom\\plex-watchlist-sync'
      // Exemple Linux: '/home/user/plex-watchlist-sync'
      cwd: process.env.BOT_PATH || '.',

      // ─────────────────────────────────────────────────────────────
      // Watchdog : Redémarrage automatique en cas de crash
      // ─────────────────────────────────────────────────────────────
      autorestart: true,
      watch: false,                    // Ne pas surveiller les fichiers
      max_restarts: 10,                // Max 10 restarts avant stop
      min_uptime: '10s',               // Doit tourner 10s minimum
      restart_delay: 5000,             // Attendre 5s entre chaque restart
      exp_backoff_restart_delay: 100,  // Backoff exponentiel si crash répétés

      // ─────────────────────────────────────────────────────────────
      // Logs
      // ─────────────────────────────────────────────────────────────
      error_file: './logs/bot-error.log',
      out_file: './logs/bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // ─────────────────────────────────────────────────────────────
      // Environnement
      // ─────────────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production'
      },

      // ─────────────────────────────────────────────────────────────
      // Limites de ressources
      // ─────────────────────────────────────────────────────────────
      max_memory_restart: '500M',      // Restart si > 500MB RAM
      kill_timeout: 5000
    },

    // ═══════════════════════════════════════════════════════════════
    // APP 2: Letterboxd Updater (Python) - Exécution périodique
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'letterboxd-updater',
      script: 'scripts/letterboxd_watchlist_bot_updater.py',
      interpreter: 'python',           // Utilise 'python3' sur Linux/Mac

      cwd: process.env.BOT_PATH || '.',

      // ─────────────────────────────────────────────────────────────
      // Planification : Exécution toutes les 6 heures
      // Format cron: minute heure jour mois jour_semaine
      // "0 */6 * * *" = À la minute 0, toutes les 6 heures
      // ─────────────────────────────────────────────────────────────
      cron_restart: '0 */6 * * *',
      autorestart: false,              // Ne pas restart en boucle après exécution

      // ─────────────────────────────────────────────────────────────
      // Logs
      // ─────────────────────────────────────────────────────────────
      error_file: './logs/letterboxd-error.log',
      out_file: './logs/letterboxd-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // ─────────────────────────────────────────────────────────────
      // Environnement Python
      // ─────────────────────────────────────────────────────────────
      env: {
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'          // Logs en temps réel
      }
    }
  ]
};
