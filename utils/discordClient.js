// utils/discordClient.js
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

let client = null;

export async function getDiscordClient(token) {
  if (client) return client;
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });
  await client.login(token);
  return client;
}

export async function sendOrUpdateEmbed({ client, channelId, messageId = null, embed }) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return null;

  let msg;
  if (messageId) {
    try {
      msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
    } catch (err) {
      if (err.code === 10008) {
        console.warn(`⚠️ Old message not found (${messageId}), sending a new one.`);
        msg = await channel.send({ embeds: [embed] });
      } else {
        console.error('❌ Discord error (fetch/edit message):', err);
        return null;
      }
    }
  } else {
    msg = await channel.send({ embeds: [embed] });
  }

  return msg.id;
}

export function buildAddedEmbed(list) {
  const desc = list
    .map(e => `✅ **${e.title}** (${e.year || '????'})`)
    .join('\n');

  return new EmbedBuilder()
    .setTitle('🎉 New Additions to Plex')
    .setDescription(desc || '*Nothing new…*')
    .setColor(0x2ecc71)
    .setFooter({ text: 'Plex Watchlist Bot' })
    .setTimestamp();
}

function chunkLines(lines, maxLen = 1024) {
  const chunks = [];
  let current = [], length = 0;
  for (const line of lines) {
    const len = line.length + 1;
    if (length + len > maxLen) {
      chunks.push(current);
      current = [line];
      length = len;
    } else {
      current.push(line);
      length += len;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function buildPendingEmbed(entries) {
  const films  = entries.filter(e => e.type === 'movie');
  const shows  = entries.filter(e => e.type === 'show');

  const filmsCount = films.length;
  const showsCount = shows.length;

  // Prepare lines
  const filmLines = filmsCount
    ? films.map(e => `🟡 ${e.title} (${e.year || '????'})`)
    : ['*No movies pending.*'];
  const showLines = showsCount
    ? shows.map(e => `🟡 ${e.title} (${e.year || '????'})`)
    : ['*No shows pending.*'];

  // Split into chunks ≤1024 characters
  const filmChunks = chunkLines(filmLines);
  const showChunks = chunkLines(showLines);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle('🕓 Pending Content')
    .setColor(0xf1c40f)
    .setFooter({ text: 'Last update' })
    .setTimestamp();

  // Add fields with counters in parentheses
  filmChunks.forEach((chunk, i) => {
    embed.addFields({
      name: `🎬 Movies (${filmsCount})${filmChunks.length > 1 ? ` (${i+1}/${filmChunks.length})` : ''}`,
      value: chunk.join('\n'),
      inline: true
    });
  });

  showChunks.forEach((chunk, i) => {
    embed.addFields({
      name: `📺 Shows (${showsCount})${showChunks.length > 1 ? ` (${i+1}/${showChunks.length})` : ''}`,
      value: chunk.join('\n'),
      inline: true
    });
  });

  return embed;
}


