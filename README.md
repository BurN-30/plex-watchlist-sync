# Plex Watchlist Sync

A Discord bot that monitors your Plex and Letterboxd watchlists and notifies you when content becomes available on your Plex server.

## Features

- **GUID Index System**: Loads entire Plex library once at startup for O(1) instant lookups
- **3-Tier Detection**: T0 (GUID Index) → T1 (Tautulli) → T2 (Title Search)
- **High Performance**: ~3 seconds to index 3700+ items, 99%+ matched instantly
- **RSS Monitoring**: Tracks Plex and Letterboxd RSS feeds with IMDb/TMDb IDs
- **Discord Notifications**: Instant alerts when movies/shows become available
- **Auto-Cleanup**: Discord notifications auto-delete after 24 hours
- **French Title Support**: Automatic localized title detection from Plex metadata
- **Letterboxd Support**: Automatic watchlist synchronization with ID enrichment
- **PM2 Watchdog**: Automatic restart on crash

## How It Works

### GUID Index System

At each scan, the bot builds an index of your entire Plex library:

```
[INDEX] Building GUID index from 10 sections...
[INDEX] Indexed 3699 items (IMDb: 3079, TMDb: 3113, TVDB: 3054) in 2.7s
```

This creates Maps for instant O(1) lookups by IMDb, TMDb, and TVDB IDs.

### 3-Tier Matching Strategy

| Tier | Method | Speed | When Used |
|------|--------|-------|-----------|
| T0 | GUID Index Lookup | <1ms | Items with IMDb/TMDb/TVDB ID (99%+) |
| T1 | Tautulli Search | ~100ms | Fallback for edge cases |
| T2 | Plex Title Search | ~200ms | Items without any ID |

### Example Output

```
[T0] "The Wild Robot" -> "Le Robot sauvage" (instant match)
[T0] "Inception" -> "Inception" (instant match)
[T1] "Close-Up" -> "Close-up" (Tautulli)
[SCAN] Processed 502 items in 3.4s
```

## Prerequisites

- **Node.js** 18.x or higher
- **Python** 3.9+ (for Letterboxd)
- **Plex Media Server** with access token
- **Discord Bot** with token
- **PM2** (optional, for production)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/BurN-30/plex-watchlist-sync.git
cd plex-watchlist-sync
```

### 2. Configuration

```bash
# Copy configuration files
copy config.example.json config.json
copy letterboxd.config.example.json letterboxd.config.json
```

Edit `config.json` with your credentials:

```json
{
  "plexToken": "YOUR_PLEX_TOKEN",
  "plexUrl": "http://localhost:32400",
  "rssUrls": [
    "https://rss.plex.tv/YOUR_RSS_ID",
    "file:///C:/path/to/plex-watchlist-sync/feeds/username.xml"
  ],
  "discordBotToken": "YOUR_DISCORD_BOT_TOKEN",
  "discordChannelId": "YOUR_DISCORD_CHANNEL_ID",
  "excludeLibraries": ["Private Library"],
  "tautulliUrl": "http://localhost:8181",
  "tautulliApiKey": "YOUR_TAUTULLI_API_KEY",
  "scanInterval": 60
}
```

Edit `letterboxd.config.json`:

```json
{
  "letterboxdUsernames": ["user1", "user2"]
}
```

### 3. Install Dependencies

```bash
# Node.js dependencies
npm install

# Python dependencies
pip install -r requirements.txt
```

### 4. Run

**Development/Test mode:**
```bash
node index.js --test
```

**Production with PM2:**
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

**Or use the automated installer (Windows):**
```powershell
.\INSTALL-PM2.ps1
```

## Configuration Guide

### `plexToken` (Required)

Your Plex authentication token.

**How to get it:**
1. Open: `https://plex.tv/devices.xml`
2. Search for `token="` (Ctrl+F)
3. Copy the alphanumeric string

### `plexUrl` (Required)

Your Plex Media Server URL.

```json
"plexUrl": "http://localhost:32400"
```

### `rssUrls` (Required)

Array of RSS feed URLs to monitor.

#### Plex Watchlist RSS

1. Open Plex Web App
2. Go to **Settings** → **Manage** → **Libraries** → **RSS Subscriptions**
3. Copy your watchlist feed URL

#### Letterboxd Feeds (Local Files)

Use the `file://` protocol with absolute paths:

```json
"rssUrls": [
  "https://rss.plex.tv/your-feed-id",
  "file:///C:/Plex%20Tools/plex-watchlist-sync/feeds/username.xml"
]
```

### `discordBotToken` (Required)

Your Discord bot token (not a webhook URL).

**How to create:**
1. Go to https://discord.com/developers/applications
2. Create **New Application** → Go to **Bot** tab → **Add Bot**
3. **Reset Token** → Copy it
4. Enable **Message Content Intent**
5. Invite bot with: `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`

### `discordChannelId` (Required)

1. Enable **Developer Mode** in Discord settings
2. Right-click channel → **Copy Channel ID**

### `excludeLibraries` (Optional)

Libraries to exclude from scanning:

```json
"excludeLibraries": ["Private Movies", "Test Library"]
```

### `tautulliUrl` & `tautulliApiKey` (Optional, Recommended)

Tautulli integration for T1 fallback searches.

**Get API key:** Tautulli → Settings → Web Interface → API → Show API Key

```json
"tautulliUrl": "http://localhost:8181",
"tautulliApiKey": "your-api-key"
```

### `scanInterval` (Optional)

Scan interval in minutes. Omit for daily midnight scan.

```json
"scanInterval": 60
```

## Discord Notifications

### Added Content (Auto-deletes after 24h)

When content becomes available, an embed is sent:

```
🎬 New content available on Plex
─────────────────────────────────
🎥 Movies — 3 titles
✓ The Wild Robot (2024)
✓ Inception (2010)
✓ Drive (2011)
─────────────────────────────────
Total: 3 new items
```

### Pending Watchlist (Persistent, auto-updated)

A single embed tracks pending items and updates each scan:

```
📋 Watchlist — Pending content
─────────────────────────────────
🎥 Movies — 15 pending
• Dune: Part Three (2026)
• Avatar 3 (2025)
...
📊 15 items awaiting availability
```

## PM2 Commands

```bash
pm2 list                    # Process status
pm2 logs                    # Real-time logs
pm2 logs plex-watchlist-bot # Bot logs only
pm2 restart all             # Restart all
pm2 monit                   # CPU/RAM monitoring
```

Or use the PowerShell dashboard:

```powershell
.\MONITOR.ps1
.\MONITOR.ps1 -Watch  # Continuous monitoring
```

## Letterboxd Maintenance

### If scraper breaks

1. **Update selectors** in `letterboxd.selectors.json`:
   ```json
   {
     "watchlist": {
       "container": "ul.grid",
       "item": "li.griditem",
       "poster_div": "div.react-component[data-component-class='LazyPoster']",
       "poster_attr_slug": "data-item-slug",
       "poster_attr_id": "data-film-id",
       "poster_attr_name": "data-item-name"
     }
   }
   ```

2. **Test the fix:**
   ```bash
   python scripts/letterboxd_scraper.py username
   ```

### Useful Commands

```bash
# Test scraper
python scripts/letterboxd_scraper.py USERNAME

# Force regenerate all feeds with IDs
python scripts/letterboxd_watchlist_bot_updater.py --force-custom

# Check selectors
python scripts/letterboxd_watchlist_bot_updater.py --check-selectors
```

## Project Structure

```
plex-watchlist-sync/
├── index.js                 # Main entry point
├── package.json
├── ecosystem.config.cjs     # PM2 configuration
├── config.json              # Configuration (git ignored)
├── letterboxd.config.json   # Letterboxd usernames (git ignored)
├── letterboxd.selectors.json # Configurable CSS selectors
├── requirements.txt         # Python dependencies
│
├── utils/
│   ├── configLoader.js      # Config loading with validation
│   ├── rssReader.js         # RSS feed reader (supports IMDb/TMDb IDs)
│   ├── discordClient.js     # Discord client & embeds
│   └── plexChecker.js       # GUID indexing & 3-tier matching
│
├── scripts/
│   ├── letterboxd_scraper.py           # Scraping with ID enrichment
│   └── letterboxd_watchlist_bot_updater.py
│
├── feeds/                   # Generated XML files (git ignored)
├── logs/                    # PM2 logs (git ignored)
│
├── INSTALL-PM2.ps1          # Automated installation
├── MONITOR.ps1              # Monitoring dashboard
└── START.bat                # Development launcher
```

## Troubleshooting

### Bot won't start

```bash
node -e "console.log(require('./config.json'))"
node index.js --test
```

### No matches found

1. Check RSS feeds have IMDb/TMDb IDs:
   ```bash
   python scripts/letterboxd_watchlist_bot_updater.py --force-custom
   ```

2. Verify GUID index builds correctly:
   ```
   [INDEX] Indexed 3699 items (IMDb: 3079, TMDb: 3113, TVDB: 3054)
   ```

### Letterboxd not working

```bash
python scripts/letterboxd_watchlist_bot_updater.py --test USERNAME
pm2 logs letterboxd-updater
```

## Performance

| Metric | Value |
|--------|-------|
| Index build time | ~3s for 3700 items |
| T0 lookup | <1ms per item |
| Full scan (500 items) | ~4s total |
| Memory usage | ~50MB |

## License

MIT License - see [LICENSE](LICENSE)

## Contributing

Pull requests are welcome! For major changes, please open an issue first.
