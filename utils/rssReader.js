// utils/rssReader.js
// RSS feed reader (HTTP and local files)

import Parser from 'rss-parser';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Parser with custom headers for Plex feeds and custom fields for IDs
const parser = new Parser({
  customFields: {
    item: ['category', 'imdbId', 'tmdbId']
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
});

/**
 * Fetch and parse an RSS feed from URL or local file
 * @param {string} url - HTTP URL or file://
 * @returns {Array} List of items with title, year, provider, id, type
 */
export async function fetchWatchlist(url) {
  try {
    let feed;

    // Support local files (file://)
    if (url.startsWith('file://')) {
      const filePath = fileURLToPath(url);
      if (!fs.existsSync(filePath)) {
        console.warn(`[RSS] File not found: ${filePath}`);
        return [];
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      feed = await parser.parseString(content);
    } else {
      // HTTP feed with retry on failure
      try {
        feed = await parser.parseURL(url);
      } catch (e) {
        // Retry with delay on temporary error
        if (e.message.includes('403') || e.message.includes('404')) {
          console.warn(`[RSS] Error ${e.message} for ${url}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          feed = await parser.parseURL(url);
        } else {
          throw e;
        }
      }
    }

    const items = (feed.items || []).map(item => {
      const raw = item.title || '';

      // Extract title and year
      // Supports: "Title (2024)", "Title [2024]", "Title {2024}"
      const match = raw.match(/^(.*?)\s*[([{\s](\d{4})[)\]}\s]?/);
      const title = match ? match[1].trim() : raw.trim();
      const year  = match ? parseInt(match[2]) : null;

      // Extract provider and ID from guid or link
      let provider = null;
      let id = null;

      const guid = item.guid || item.link || '';

      // Priority 1: IMDb ID from custom field (Letterboxd XML)
      if (item.imdbId) {
        provider = 'imdb';
        id = item.imdbId;
      }
      // Priority 2: TMDb ID from custom field (Letterboxd XML)
      else if (item.tmdbId) {
        provider = 'tmdb';
        id = item.tmdbId;
      }
      // Priority 3: IMDb from GUID
      else if (guid.includes('imdb.com') || guid.includes('tt')) {
        const imdbMatch = guid.match(/(tt\d+)/);
        if (imdbMatch) {
          provider = 'imdb';
          id = imdbMatch[1];
        }
      }
      // Priority 4: TMDb from GUID
      else if (guid.includes('themoviedb.org') || guid.includes('tmdb')) {
        const tmdbMatch = guid.match(/(\d+)/);
        if (tmdbMatch) {
          provider = 'tmdb';
          id = tmdbMatch[1];
        }
      }
      // Priority 5: TVDB
      else if (guid.includes('thetvdb.com') || guid.includes('tvdb')) {
        const tvdbMatch = guid.match(/(\d+)/);
        if (tvdbMatch) {
          provider = 'tvdb';
          id = tvdbMatch[1];
        }
      }

      // Detect type (movie vs show)
      // Default movie, unless indicators of show
      let type = 'movie';
      const lowerTitle = raw.toLowerCase();
      const lowerGuid = guid.toLowerCase();

      if (
        lowerGuid.includes('tv') ||
        lowerGuid.includes('series') ||
        lowerGuid.includes('show') ||
        lowerTitle.includes('season') ||
        lowerTitle.includes('saison') ||
        lowerTitle.includes('episode')
      ) {
        type = 'show';
      }

      return { title, year, provider, id, type };
    });

    return items;

  } catch (e) {
    console.error(`[RSS] Read error (${url}):`, e.message);
    return [];
  }
}
