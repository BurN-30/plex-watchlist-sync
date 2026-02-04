// utils/discordClient.js
// Discord client and embed management

import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

let clientInstance = null;

/**
 * Initialize and return Discord client (singleton)
 */
export async function getDiscordClient(token) {
  if (clientInstance && clientInstance.isReady()) {
    return clientInstance;
  }

  clientInstance = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  await clientInstance.login(token);

  return new Promise((resolve) => {
    if (clientInstance.isReady()) {
      resolve(clientInstance);
    } else {
      clientInstance.once('ready', () => {
        console.log(`[DISCORD] Connected as ${clientInstance.user.tag}`);
        resolve(clientInstance);
      });
    }
  });
}

/**
 * Build embed for newly added movies/shows
 */
export function buildAddedEmbed(list) {
  const movies = list.filter(e => e.type === 'movie');
  const shows = list.filter(e => e.type === 'show');

  const embed = new EmbedBuilder()
    .setTitle('🎬 New content available on Plex')
    .setDescription('─────────────────────────────────────')
    .setColor(0x2ecc71)
    .setTimestamp();

  if (movies.length > 0) {
    const movieList = movies
      .map(m => `✓ **${m.title}** ${m.year ? `(${m.year})` : ''}`)
      .join('\n');
    embed.addFields({
      name: `\n🎥 Movies — ${movies.length} ${movies.length > 1 ? 'titles' : 'title'}`,
      value: movieList.substring(0, 1024),
      inline: false
    });
  }

  if (shows.length > 0) {
    const showList = shows
      .map(s => `✓ **${s.title}** ${s.year ? `(${s.year})` : ''}`)
      .join('\n');
    embed.addFields({
      name: `\n📺 Shows — ${shows.length} ${shows.length > 1 ? 'titles' : 'title'}`,
      value: showList.substring(0, 1024),
      inline: false
    });
  }

  embed.addFields({
    name: '─────────────────────────────────────',
    value: `Total: **${list.length}** new ${list.length > 1 ? 'items' : 'item'}`,
    inline: false
  });

  return embed;
}

/**
 * Build embed for pending watchlist items
 */
export function buildPendingEmbed(entries) {
  const movies = entries.filter(e => e.type === 'movie');
  const shows = entries.filter(e => e.type === 'show');

  const embed = new EmbedBuilder()
    .setTitle('📋 Watchlist — Pending content')
    .setDescription('─────────────────────────────────────')
    .setColor(0xf39c12)
    .setTimestamp();

  if (entries.length === 0) {
    embed.setDescription('✨ No pending content!\n\nAll movies and shows from your watchlist are available on Plex.');
    return embed;
  }

  // Movies
  if (movies.length > 0) {
    const sortedMovies = movies.sort((a, b) => (b.year || 0) - (a.year || 0));
    const chunks = chunkLines(sortedMovies.map(m => `• ${m.title} ${m.year ? `(${m.year})` : ''}`), 1024);

    chunks.forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? `\n🎥 Movies — ${movies.length} pending` : '​',
        value: chunk,
        inline: true
      });
    });
  }

  // Shows
  if (shows.length > 0) {
    const sortedShows = shows.sort((a, b) => (b.year || 0) - (a.year || 0));
    const chunks = chunkLines(sortedShows.map(s => `• ${s.title} ${s.year ? `(${s.year})` : ''}`), 1024);

    chunks.forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? `\n📺 Shows — ${shows.length} pending` : '​',
        value: chunk,
        inline: true
      });
    });
  }

  // Footer with statistics
  embed.addFields({
    name: '─────────────────────────────────────',
    value: `📊 **${entries.length}** ${entries.length > 1 ? 'items' : 'item'} awaiting availability`,
    inline: false
  });

  embed.setFooter({
    text: `🎬 ${movies.length} movies • 📺 ${shows.length} shows • Updated`
  });

  return embed;
}

/**
 * Split array of lines into chunks respecting character limit
 */
function chunkLines(lines, maxLength) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ['None'];
}

/**
 * Send or update an embed message
 */
export async function sendOrUpdateEmbed({ client, channelId, messageId, embed }) {
  try {
    const channel = await client.channels.fetch(channelId);

    if (messageId) {
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [embed] });
        return messageId;
      } catch (e) {
        // Message deleted or not found, create a new one
        console.log('[DISCORD] Previous message not found, creating new one');
      }
    }

    const newMsg = await channel.send({ embeds: [embed] });
    return newMsg.id;

  } catch (e) {
    console.error('[DISCORD] Error:', e.message);
    return null;
  }
}

/**
 * Send an "added" notification message and return its ID with timestamp
 */
export async function sendAddedMessage({ client, channelId, embed }) {
  try {
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.send({ embeds: [embed] });
    return { id: msg.id, sentAt: Date.now() };
  } catch (e) {
    console.error('[DISCORD] Error sending added message:', e.message);
    return null;
  }
}

/**
 * Delete added messages older than maxAge (in ms)
 * @param {Client} client - Discord client
 * @param {string} channelId - Channel ID
 * @param {Array} addedMessages - Array of {id, sentAt}
 * @param {number} maxAge - Max age in ms (default 24h)
 * @returns {Array} - Remaining messages (not yet expired)
 */
export async function cleanupOldAddedMessages({ client, channelId, addedMessages, maxAge = 24 * 60 * 60 * 1000 }) {
  if (!addedMessages || addedMessages.length === 0) return [];

  const now = Date.now();
  const remaining = [];

  try {
    const channel = await client.channels.fetch(channelId);

    for (const msg of addedMessages) {
      const age = now - msg.sentAt;

      if (age >= maxAge) {
        // Message expired, delete it
        try {
          const discordMsg = await channel.messages.fetch(msg.id);
          await discordMsg.delete();
          console.log(`[CLEANUP] Deleted added message (${Math.round(age / 3600000)}h old)`);
        } catch (e) {
          // Message already deleted or not found, ignore
          console.log(`[CLEANUP] Message ${msg.id} already deleted or not found`);
        }
      } else {
        // Message still valid, keep it
        remaining.push(msg);
      }
    }
  } catch (e) {
    console.error('[DISCORD] Cleanup error:', e.message);
    return addedMessages; // Return original list on error
  }

  return remaining;
}
