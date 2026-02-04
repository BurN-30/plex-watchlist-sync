// index.js - Plex Watchlist Sync Bot
// Monitors RSS feeds and notifies when content becomes available on Plex

import { loadConfig } from './utils/configLoader.js';
import { fetchWatchlist } from './utils/rssReader.js';
import { checkIfInPlex, clearScanCache, setPlexLogger, buildGuidIndex } from './utils/plexChecker.js';
import { getDiscordClient, buildAddedEmbed, buildPendingEmbed, sendOrUpdateEmbed, sendAddedMessage, cleanupOldAddedMessages } from './utils/discordClient.js';
import fs from 'fs';

console.log('Starting Plex Watchlist Sync Bot...');

const config = loadConfig();
const FILE = './watchlist.json';

// Initialize data structure
let data = { messages: { pending: null, added: [] }, entries: [], history: [] };
if (fs.existsSync(FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    if (!data.messages) data.messages = { pending: null, added: [] };
    if (!data.messages.added) data.messages.added = [];
    if (!data.entries) data.entries = [];
    if (!data.history) data.history = [];
  } catch (e) {
    console.error("Error reading watchlist.json, resetting.", e);
    data = { messages: { pending: null, added: [] }, entries: [], history: [] };
  }
}

// Logger
function log(msg) {
  console.log(msg);
}

setPlexLogger(log);

let isScanning = false;

/**
 * Main scan function
 */
async function run() {
  if (isScanning) {
    log("[WARN] Scan already in progress, skipping.");
    return { addedFilms: 0, addedShows: 0 };
  }
  isScanning = true;

  try {
    clearScanCache();

    const now = Date.now();
    const client = await getDiscordClient(config.discordBotToken);
    log(`\n=== Scan started at ${new Date().toLocaleTimeString()} ===`);

    // Build GUID index first (one-time cost, enables O(1) lookups)
    await buildGuidIndex(config);

    // Fetch all RSS items
    const sources = Array.isArray(config.rssUrls) ? config.rssUrls : [config.rssUrl];
    const allItems = (await Promise.all(sources.map(fetchWatchlist))).flat();
    log(`[RSS] ${allItems.length} items from ${sources.length} feeds`);

    const addedThisScan = [];
    const startTime = Date.now();

    for (const it of allItems) {
      const { title, year, provider, id, type } = it;

      // Find existing entry by ID (preferred) or title
      let existing = data.entries.find(e => {
        if (e.provider && e.id && provider && id) return e.provider === provider && e.id === id;
        return e.title === title && e.type === type;
      });

      // Check Plex availability
      const plexResult = await checkIfInPlex(title, year, type, config, provider, id);
      const isInLib = plexResult.found;
      const plexTitle = plexResult.plexTitle;
      const detectedType = plexResult.detectedType;

      if (!existing) {
        // New item
        existing = {
          title: isInLib && plexTitle ? plexTitle : title,
          year,
          type: (isInLib && detectedType) ? detectedType : type,
          provider,
          id,
          status: isInLib ? 'added' : 'pending',
          addedAt: isInLib ? now : null
        };
        data.entries.push(existing);

        if (isInLib) {
          log(`[NEW] "${title}" -> "${plexTitle}" (available)`);
          addedThisScan.push(existing);
        } else {
          log(`[NEW] "${title}" (pending)`);
        }
      } else {
        // Existing item - update if needed

        // Update type if Plex detected different
        if (isInLib && detectedType && existing.type !== detectedType) {
          log(`[TYPE] "${existing.title}" (${existing.type} -> ${detectedType})`);
          existing.type = detectedType;
        }

        // Update title if Plex has different (localized) title
        if (isInLib && plexTitle && existing.title !== plexTitle) {
          log(`[TITLE] "${existing.title}" -> "${plexTitle}"`);
          existing.title = plexTitle;
        }

        // Update status: pending -> added
        if (isInLib && existing.status !== 'added') {
          existing.status = 'added';
          existing.addedAt = now;
          log(`[AVAILABLE] "${existing.title}"`);
          addedThisScan.push(existing);
        }

        // Downgrade: added -> pending (content removed from Plex)
        if (!isInLib && existing.status === 'added') {
          existing.status = 'pending';
          log(`[REMOVED] "${existing.title}" -> pending`);
        }
      }
    }

    // Cleanup: remove items no longer in RSS (except 'added' ones)
    const beforeCount = data.entries.length;
    data.entries = data.entries.filter(entry => {
      if (entry.status === 'added') return true;
      const existsInRss = allItems.some(rssItem => {
        if (rssItem.provider && rssItem.id && entry.provider && entry.id) {
          return rssItem.provider === entry.provider && rssItem.id === entry.id;
        }
        return rssItem.title === entry.title;
      });
      if (!existsInRss) log(`[CLEANUP] "${entry.title}" removed from watchlist`);
      return existsInRss;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`[SCAN] Processed ${allItems.length} items in ${elapsed}s`);

    // Discord: cleanup old added messages (>24h)
    data.messages.added = await cleanupOldAddedMessages({
      client,
      channelId: config.discordChannelId,
      addedMessages: data.messages.added,
      maxAge: 24 * 60 * 60 * 1000
    });

    // Discord: send new additions notification
    if (addedThisScan.length > 0 && addedThisScan.length < 50) {
      const emb = buildAddedEmbed(addedThisScan);
      const msgInfo = await sendAddedMessage({
        client,
        channelId: config.discordChannelId,
        embed: emb
      });
      if (msgInfo) {
        data.messages.added.push(msgInfo);
        log(`[DISCORD] Sent notification (${addedThisScan.length} items, auto-delete in 24h)`);
      }
    }

    // Discord: update pending list
    const pending = data.entries.filter(e => e.status === 'pending');
    const embPend = buildPendingEmbed(pending);
    const msgId = await sendOrUpdateEmbed({
      client,
      channelId: config.discordChannelId,
      messageId: data.messages.pending,
      embed: embPend
    });
    if (msgId) data.messages.pending = msgId;

    // Update history
    if (!data.history) data.history = [];
    data.history.push({ date: Date.now(), pending: pending.length });
    if (data.history.length > 50) data.history.shift();

    // Save
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    log('[SAVE] watchlist.json updated');

    const addedFilms = addedThisScan.filter(e => e.type === 'movie').length;
    const addedShows = addedThisScan.filter(e => e.type === 'show').length;

    log(`\n=== Scan complete: ${addedFilms} movies, ${addedShows} shows added ===\n`);

    return { addedFilms, addedShows };

  } catch (error) {
    console.error("[ERROR] Scan failed:", error);
    return { addedFilms: 0, addedShows: 0 };
  } finally {
    isScanning = false;
  }
}

// CLI arguments
const args = process.argv.slice(2);

if (args.includes('--test')) {
  log("[TEST] Single scan mode");
  run().then((res) => {
    log(`[RESULT] ${res.addedFilms} movies, ${res.addedShows} shows`);
    process.exit(0);
  });
} else {
  run();
  scheduleNext();
}

function scheduleNext() {
  if (config.scanInterval) {
    const intervalMs = config.scanInterval * 60 * 1000;
    log(`[SCHEDULE] Next scan in ${config.scanInterval} minutes`);
    setInterval(run, intervalMs);
    return;
  }

  // Default: daily at midnight
  const now = new Date();
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  log(`[SCHEDULE] Next scan: ${next.toLocaleString()}`);

  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, next - now);
}
