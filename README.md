# 🎬 Plex Watchlist Sync

> **A custom Discord bot that monitors RSS feeds (Plex, Letterboxd) and automatically notifies when content from your watchlist becomes available on your Plex server.**

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-14.x-blue.svg)](https://discord.js.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## ✨ Features

- 🔍 **Multi-source RSS parsing** (Plex Watchlist, Letterboxd)
- 🎯 **Intelligent Plex detection** with 4-tier matching system
- 🤖 **Discord notifications** with live-updating embeds
- 📊 **Smart caching** for optimal performance
- 🌍 **French title detection** (automatically uses localized Plex titles)
- 🎭 **Auto type-correction** (movie ↔ show detection)
- 📈 **Historical tracking** of watchlist evolution

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure
cp config.example.json config.json
# Edit config.json with your credentials (see detailed guide below)

# Run
node index.js --test
```

## 📦 Prerequisites

- **Node.js** 18.x or higher
- **Plex Media Server** with a valid token
- **Discord Webhook** or Bot with message permissions
- **Tautulli** (optional, recommended for faster detection)
- **Python 3.8+** (for Letterboxd sync)

---

## ⚙️ Configuration Guide

### Step 1: Create Your Config File

Copy the example configuration:
```bash
cp config.example.json config.json
```

Your `config.json` should look like this:
```json
{
  "plexToken": "YOUR_PLEX_TOKEN",
  "plexUrl": "http://localhost:32400",
  "rssUrls": [
    "https://rss.plex.tv/YOUR_RSS_ID",
    "file:///C:/path/to/feeds/username.xml"
  ],
  "discordBotToken": "YOUR_DISCORD_BOT_TOKEN",
  "discordChannelId": "YOUR_CHANNEL_ID",
  "excludeLibraries": ["Private Library"],
  "tautulliUrl": "http://localhost:8181",
  "tautulliApiKey": "YOUR_TAUTULLI_API_KEY"
}
```

---

### 🔑 Step 2: Get Your Plex Token

**Method 1: Via Plex Web App (Easiest)**

1. Open **Plex Web App** in your browser (`http://localhost:32400/web` or `https://app.plex.tv`)
2. Play **any media** (movie, show, music)
3. Click the **three dots** (`...`) → Select **"Get Info"** or **"View XML"**
4. Look at the browser URL bar, you'll see:
   ```
   https://app.plex.tv/desktop/#!/server/.../details?key=/library/metadata/12345&X-Plex-Token=AbCdEf123456789
   ```
5. Copy everything after `X-Plex-Token=` → That's your token!

**Method 2: Via Plex Settings**

1. Go to **Settings** → **Account**
2. Scroll down to **"Authorized Devices"**
3. Click on your server name
4. Your token will be visible in the URL

**Example:**
```json
"plexToken": "aBc123XyZ456-Pq7Rs8Tv"
```

⚠️ **Keep this token private!** It gives full access to your Plex server.

---

### 📡 Step 3: Configure RSS URLs

The bot supports **two types of RSS feeds**:

#### A) Plex Watchlist RSS (Official)

1. Go to [Plex Settings](https://app.plex.tv/desktop/#!/settings/watchlist)
2. Click **"Get RSS Feed"** for each user
3. Copy the URL (looks like `https://rss.plex.tv/a1f716af-6b6f-4541...`)
4. Add to `rssUrls` array

**Example:**
```json
"rssUrls": [
  "https://rss.plex.tv/a1f716af-6b6f-4541-b18b-f2288e63cf89",
  "https://rss.plex.tv/4493e83f-a5cb-41b9-a8e9-33e182ed25cc"
]
```

#### B) Letterboxd Watchlists (via Python Scraper)

Letterboxd doesn't provide official RSS feeds, so we use a Python scraper to generate compatible XML files.

##### 🐍 Python Setup

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure Letterboxd usernames:**
   ```bash
   cp letterboxd.config.example.json letterboxd.config.json
   ```
   
   Edit `letterboxd.config.json` and add your friends' usernames:
   ```json
   {
     "letterboxdUsernames": [
       "friend1_username",
       "friend2_username",
       "friend3_username"
     ]
   }
   ```

3. **Generate XML feeds:**
   ```bash
   python scripts/letterboxd_watchlist_bot_updater.py
   ```
   
   This creates RSS-compatible XML files in `feeds/`:
   ```
   feeds/
     ├── friend1_username.xml
     ├── friend2_username.xml
     └── friend3_username.xml
   ```

4. **Add to config.json** using absolute paths with `file://` protocol:
   ```json
   "rssUrls": [
     "https://rss.plex.tv/YOUR_PLEX_RSS",
     "file:///C:/Plex%20Tools/plex-watchlist-sync/feeds/friend1_username.xml",
     "file:///C:/Plex%20Tools/plex-watchlist-sync/feeds/friend2_username.xml"
   ]
   ```

##### 📅 Auto-Update Letterboxd Feeds (Optional)

**Windows Task Scheduler:**
```powershell
schtasks /create /tn "Letterboxd Feed Update" /tr "python C:\Plex Tools\plex-watchlist-sync\scripts\letterboxd_watchlist_bot_updater.py" /sc daily /st 04:00
```

**Linux Cron:**
```bash
0 4 * * * cd /path/to/plex-watchlist-sync && python3 scripts/letterboxd_watchlist_bot_updater.py
```

⚠️ **Rate Limiting:** The script includes 3-6 second delays between requests to respect Letterboxd's servers.

⚠️ **Important:**
- Use **forward slashes** `/` (not backslashes `\`)
- Use `%20` for spaces in paths
- Use **absolute paths** starting with your drive letter

---

### 🤖 Step 4: Setup Discord Webhook/Bot

You have **two options**:

#### Option A: Discord Webhook (Simpler, Recommended)

1. Open your Discord server
2. Go to **Server Settings** → **Integrations** → **Webhooks**
3. Click **"New Webhook"**
4. Name it (e.g., "Plex Bot"), choose the target channel
5. Copy the **Webhook URL** (looks like `https://discord.com/api/webhooks/123456.../AbCdEf...`)
6. Use it as `discordBotToken`:

```json
"discordBotToken": "https://discord.com/api/webhooks/1362841415654051940/GTnXOE...",
"discordChannelId": "1362835444219248660"
```

#### Option B: Discord Bot (More Features)

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** → Give it a name
3. Go to **"Bot"** tab → Click **"Add Bot"**
4. **Copy the Bot Token** (click "Reset Token" if needed)
5. Enable **"MESSAGE CONTENT INTENT"** (under Privileged Gateway Intents)
6. Go to **"OAuth2"** → **"URL Generator"**
7. Select:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Embed Links`, `Read Message History`
8. Copy the generated URL and open it to **invite the bot** to your server
9. Get your **Channel ID**:
   - Enable **Developer Mode** in Discord (User Settings → Advanced)
   - Right-click on your channel → **"Copy Channel ID"**

```json
"discordBotToken": "MTM2Mjg0MTQxNTY1NDA1MTk0MA.GTnXOE.WNHRwH1_q63NFo...",
"discordChannelId": "1362835444219248660"
```

---

### 🔥 Step 5: Configure Tautulli (Optional but Recommended)

Tautulli dramatically speeds up detection (M0 tier).

#### Installing Tautulli

1. Download from [tautulli.com](https://tautulli.com/)
2. Install and connect to your Plex server
3. Access Tautulli web interface (usually `http://localhost:8181`)

#### Getting API Key

1. Open Tautulli → **Settings** (⚙️)
2. Go to **"Web Interface"** tab
3. Scroll down to **"API"**
4. Click **"Show API Key"**
5. Copy the key

#### Add to Config

```json
"tautulliUrl": "http://localhost:8181",
"tautulliApiKey": "5d4b8704a7d94e6290c78f84311871e6"
```

**If running on another machine:**
```json
"tautulliUrl": "http://192.168.1.100:8181",
"tautulliApiKey": "YOUR_API_KEY"
```

⚠️ **If you don't have Tautulli**, the bot will still work but will be slower (uses M1-M3 tiers).

---

### 🎯 Step 6: Plex URL Configuration

#### Local Server (Same Machine)
```json
"plexUrl": "http://localhost:32400"
```

#### Remote Server (Different Machine on Network)
```json
"plexUrl": "http://192.168.1.50:32400"
```

#### Remote Server (Internet/Cloud)
```json
"plexUrl": "https://your-plex-server.com:32400"
```

To find your Plex Server URL:
1. Open Plex Web App
2. Settings → Network
3. Look for **"Custom server access URLs"**

---

### 📚 Step 7: Exclude Private Libraries (Optional)

Hide specific libraries from scanning:

```json
"excludeLibraries": [
  "Private Movies",
  "Adult Content",
  "Test Library"
]
```

These libraries will be completely ignored by the bot.

---

## ✅ Final Configuration Example

```json
{
  "plexToken": "aBc123XyZ456-Pq7Rs8Tv",
  "plexUrl": "http://localhost:32400",
  "rssUrls": [
    "https://rss.plex.tv/a1f716af-6b6f-4541-b18b-f2288e63cf89",
    "file:///C:/Plex%20Tools/plex-watchlist-bot-FULL/feeds/friend1.xml",
    "file:///C:/Plex%20Tools/plex-watchlist-bot-FULL/feeds/friend2.xml"
  ],
  "discordBotToken": "MTM2Mjg0MTQxNTY1NDA1MTk0MA.GTnXOE.WNHRwH1_q63...",
  "discordChannelId": "1362835444219248660",
  "excludeLibraries": ["Private Movies", "Test Content"],
  "tautulliUrl": "http://localhost:8181",
  "tautulliApiKey": "5d4b8704a7d94e6290c78f84311871e6"
}
```

---

## 📖 Usage

### Manual Run
```bash
node index.js --test
```

### Continuous Mode
```bash
node index.js
```

### Schedule Daily (Windows)
```powershell
.\SETUP_TASK.ps1
```
Creates a task that runs daily at **5:00 AM**.

### View Scheduled Tasks
```powershell
.\VIEW_TASKS.ps1
```

## 🔧 How It Works

### Detection System (4 Tiers)

1. **M0 - Tautulli** (Fastest): Direct API queries
2. **M1 - Search API**: Title + ID matching
3. **M2 - Year Scan**: Section-based year filtering
4. **M3 - Nuclear**: Complete library scan (last resort)

```
RSS Feed → Parse Items → Check Plex (M0-M3) → Update Status → Notify Discord
```

## 📁 Project Structure

```
plex-watchlist-sync/
├── index.js                 # Main bot logic
├── config.json              # Configuration (create from example)
├── config.example.json      # Configuration template
├── watchlist.json           # Database (auto-generated)
├── feeds/                   # Local Letterboxd XML feeds (auto-generated)
├── scripts/
│   └── letterboxd_watchlist_bot_updater.py  # Letterboxd feed generator
└── utils/
    ├── configLoader.js      # Configuration loader
    ├── discordClient.js     # Discord embed builder
    ├── plexChecker.js       # Plex detection engine (4-tier system)
    └── rssReader.js         # RSS feed parser
```

## 🎨 Discord Notifications

### New Additions Embed
```
🎉 New Additions to Plex
✅ **Inception** (2010)
✅ **Breaking Bad** (2008)
```

### Pending Content Embed (Live-updating)
```
🕓 Pending Content
🎬 Movies (12)
🟡 Dune: Part Two (2024)
🟡 The Batman (2022)

📺 Shows (8)
🟡 The Last of Us (2023)
```

## 🛠️ Advanced Features

### Smart Caching
- Section metadata cached per scan
- Year-based results cached per session
- Full library scans cached for M3 tier

### Duplicate Detection
- Merges entries with matching provider IDs
- Updates titles when better matches found
- Auto-cleanup of duplicates

### Status Management
- `pending`: In watchlist, not yet on Plex
- `added`: Found on Plex server
- Auto-transition when content appears/disappears

## 🐛 Troubleshooting

### Bot doesn't find content
1. Verify `plexToken` is valid
2. Check libraries aren't in `excludeLibraries`
3. Enable Tautulli for faster detection
4. Ensure content has proper metadata (TMDB/IMDB/TVDB IDs)

### RSS feeds not loading
- Use proper `file://` encoding: `file:///C:/Path/To/file.xml`
- Use `%20` for spaces in paths
- Verify XML file validity

### Discord bot not posting
1. Check `Send Messages` and `Embed Links` permissions
2. Verify `discordChannelId` is correct
3. Ensure bot token is valid

### Tautulli not working
1. Check `tautulliUrl` is accessible
2. Verify API key is correct
3. Check Tautulli logs for errors
4. Bot will fallback to M1-M3 if Tautulli fails

## 🤝 Contributing

Feel free to:
- 🐛 Report bugs via Issues
- 💡 Suggest features
- 🔧 Fork and adapt to your needs

## ⚠️ Privacy Notice

**This project is configured for personal use.**

Before sharing:
1. Remove sensitive data from `config.json`
2. Clear personal entries from `watchlist.json`
3. Don't commit tokens/API keys

## 📄 License

MIT License - Free to use and modify for personal use.

---

## 🙏 Acknowledgments

- [Plex Media Server](https://www.plex.tv/)
- [Discord.js](https://discord.js.org/)
- [Tautulli](https://tautulli.com/)
- [Letterboxd](https://letterboxd.com/)

---

**⚠️ Disclaimer:** This is a personal automation tool. Not affiliated with Plex Inc.

**Made with ❤️ for efficient media management**
