// index.js - Main bot logic
import { loadConfig } from './utils/configLoader.js';
import { fetchWatchlist } from './utils/rssReader.js';
import { checkIfInPlex, clearScanCache, setPlexLogger } from './utils/plexChecker.js';
import { getDiscordClient, buildAddedEmbed, buildPendingEmbed, sendOrUpdateEmbed } from './utils/discordClient.js';
import fs from 'fs';

console.log('✅ Starting Plex Watchlist Bot...');

const config = loadConfig();
const FILE   = './watchlist.json';

let data = { messages: { pending: null }, entries: [], history: [] };
if (fs.existsSync(FILE)) { 
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf-8')); 
    // Migration / Safety checks
    if (!data.messages) data.messages = { pending: null };
    if (!data.entries) data.entries = [];
    if (!data.history) data.history = [];
  } catch (e) {
    console.error("❌ Error reading watchlist.json, resetting.", e);
    data = { messages: { pending: null }, entries: [], history: [] };
  }
}

// Simple log handler
function log(msg) {
  console.log(msg);
}

// Connect plexChecker logger to central logging system
setPlexLogger(log);

let isScanning = false;

async function run() {
  if (isScanning) {
    log("⚠️ Scan already in progress, request ignored.");
    return { addedFilms: 0, addedShows: 0 };
  }
  isScanning = true;

  try {
    // Clear scan cache at the beginning of each cycle for fresh data
    clearScanCache();
    
    const now    = Date.now();
    const client = await getDiscordClient(config.discordBotToken);
    log(`\n=== 🔁 Scan started at ${new Date().toLocaleTimeString()} ===`);

    const sources = Array.isArray(config.rssUrls) ? config.rssUrls : [config.rssUrl];
    // Fetch RSS items
    const allItems = (await Promise.all(sources.map(fetchWatchlist))).flat();
    log(`📰 ${allItems.length} items in RSS feeds.`);

    const addedThisScan = [];

    for (const it of allItems) {
      const { title, year, provider, id, type } = it;

      // Smart retrieval from local file (ID > Title)
      let existing = data.entries.find(e => {
        if (e.provider && e.id && provider && id) return e.provider === provider && e.id === id;
        return e.title === title && e.type === type;
      });

      // 🔍 PLEX SCAN: Systematic verification (Reliability > Speed)
      // Query Plex every time to ensure content is still available
      const plexResult = await checkIfInPlex(title, year, type, config, provider, id);
      const isInLib = plexResult.found;
      const plexTitle = plexResult.plexTitle;
      const detectedType = plexResult.detectedType; // Actual type found in Plex (e.g., 'show' when we searched for 'movie')

      if (!existing) {
        existing = {
          title:   isInLib && plexTitle ? plexTitle : title,
          year, 
          type:    (isInLib && detectedType) ? detectedType : type, // Prioritize type detected by Plex
          provider, id,
          status:  isInLib ? 'added' : 'pending',
          addedAt: isInLib ? now : null
        };
        data.entries.push(existing);
        log(`🆕 "${title}" -> ${isInLib ? `✅ Found: "${plexTitle}"` : '🕓 Pending'}`);
        if (isInLib) addedThisScan.push(existing);

      } else {
        // If the item already existed...
        
        // 0. Type correction if necessary (e.g., movie -> show)
        // Absolute priority to what Plex found. If Plex says it's a show, it's a show.
        if (isInLib && detectedType && existing.type !== detectedType) {
           log(`🔄 Type correction (Plex): "${existing.title}" (${existing.type} ➔ ${detectedType})`);
           existing.type = detectedType;
        }
        // Otherwise, check if RSS changed its mind (rare for Letterboxd but possible elsewhere)
        else if (existing.type !== type) {
           log(`🔄 Type correction (RSS): "${existing.title}" (${existing.type} ➔ ${type})`);
           existing.type = type;
        }

        // 1. Update title if Plex found a better one (e.g., French title)
        if (isInLib && plexTitle && existing.title !== plexTitle) {
           log(`🇫🇷 Title translation: "${existing.title}" ➔ "${plexTitle}"`);
           existing.title = plexTitle;
        }
        
        // 2. Status update (Pending -> Added)
        if (isInLib && existing.status !== 'added') {
          existing.status  = 'added';
          existing.addedAt = now;
          log(`✅ "${existing.title}" is now available!`);
          addedThisScan.push(existing);
        }

        // 3. Downgrade (Added -> Pending) if content disappeared from Plex
        if (!isInLib && existing.status === 'added') {
            existing.status = 'pending';
            log(`⚠️ "${existing.title}" is no longer detected in Plex -> Back to pending.`);
        }
      }
    }

    // CLEANUP: Remove items no longer in RSS (except if already added)
    const beforeCount = data.entries.length;
    data.entries = data.entries.filter(entry => {
      if (entry.status === 'added') return true; // Keep history of additions
      const existsInRss = allItems.some(rssItem => {
        if (rssItem.provider && rssItem.id && entry.provider && entry.id) return rssItem.provider === entry.provider && rssItem.id === entry.id;
        return rssItem.title === entry.title;
      });
      if (!existsInRss) log(`🗑️ Deleted (no longer in RSS): "${entry.title}"`);
      return existsInRss;
    });
    if (beforeCount - data.entries.length > 0) log(`🧹 Cleanup completed.`);

    // DISCORD NOTIFICATIONS
    // Using addedThisScan which is more reliable than timestamp
    if (addedThisScan.length > 0 && addedThisScan.length < 50) { 
      const emb = buildAddedEmbed(addedThisScan);
      const ch  = await client.channels.fetch(config.discordChannelId);
      await ch.send({ embeds: [emb] });
    }

    const pending = data.entries.filter(e => e.status === 'pending');
    const embPend = buildPendingEmbed(pending);
    const msgId = await sendOrUpdateEmbed({ client, channelId: config.discordChannelId, messageId: data.messages.pending, embed: embPend });
    if (msgId) data.messages.pending = msgId;

    // UPDATE HISTORY
    if (!data.history) data.history = [];
    data.history.push({ date: Date.now(), pending: pending.length });
    if (data.history.length > 50) data.history.shift();

    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    log('💾 watchlist.json updated.');

    const addedFilms = addedThisScan.filter(e => e.type === 'movie').length;
    const addedShows = addedThisScan.filter(e => e.type === 'show').length;
    return { addedFilms, addedShows };

  } catch (error) {
    console.error("❌ Critical error during scan:", error);
    return { addedFilms: 0, addedShows: 0 };
  } finally {
    isScanning = false;
  }
}

const args = process.argv.slice(2);

if (args.includes('--test')) {
  log("🧪 TEST mode enabled: Single execution then exit.");
  run().then((res) => {
    log(`📊 Results: ${res.addedFilms} movies, ${res.addedShows} shows.`);
    process.exit(0);
  });
} else {
  run();
  scheduleNext();
}

function scheduleNext () {
  // If a custom interval is defined (in minutes), use it
  if (config.scanInterval) {
    const intervalMs = config.scanInterval * 60 * 1000;
    log(`⏰ Next automatic scan in ${config.scanInterval} minutes.`);
    setInterval(run, intervalMs);
    return;
  }

  // Otherwise, default behavior: daily at midnight
  const now = new Date(); 
  const next = new Date(); 
  next.setHours(24, 0, 0, 0); // Next midnight
  
  if (next <= now) next.setDate(next.getDate() + 1);

  log(`⏰ Next automatic scan: ${next.toLocaleString()}`);
  
  setTimeout(() => { 
    run(); 
    setInterval(run, 24 * 60 * 60 * 1000); 
  }, next - now);
}