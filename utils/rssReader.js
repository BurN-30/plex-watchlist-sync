// utils/rssReader.js - RSS feed parser
import Parser from 'rss-parser';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const parser = new Parser();

/**
 * Loads an RSS feed (HTTP(S) or local file://) and returns an array
 * of [{ title, year, provider, id, type }] objects usable by checkIfInPlex().
 *
 * @param {string} rssUrl — HTTP/HTTPS URL or file://C:/…
 * @returns {Promise<Array<object>>}
 */
export async function fetchWatchlist(rssUrl) {
  let feed = { items: [] };

  /* ---------- 1) Load feed ---------- */
  try {
    if (rssUrl.startsWith('file://')) {
      // Properly transform file:// URI to local path
      const path = fileURLToPath(rssUrl);           // e.g., C:/PlexTools/feeds/username.xml
      const xml  = await fs.readFile(path, 'utf8');
      feed       = await parser.parseString(xml);
    } else {
      feed = await parser.parseURL(rssUrl);
    }
  } catch (err) {
    console.warn(`⚠️  Unable to read ${rssUrl}: ${err.code || err.message}`);
    return [];            // fail-soft: ignore this feed
  }

  /* ---------- 2) Parse each item ---------- */
  return feed.items.map(item => {
    /* -------- title + year -------- */
    // Enhanced regex to capture "Title (Year)" or "Title [Year]"
    // Also handles text after year (e.g., "Title (2024) [1080p]")
    const mTitle = item.title?.match(/^(.*?)\s*[([{\s](\d{4})[)\]}\s]/);
    
    const title  = mTitle ? mTitle[1].trim()
                          : (item.title ?? '').trim();
    const year   = mTitle && !isNaN(mTitle[2]) ? Number(mTitle[2]) : null;

    /* -------- provider + id -------- */
    let provider = null;
    let id       = null;

    if (item.guid) {
      const guid = item.guid;

      /* 1) Format "imdb://tt123" or "tmdb://456" ------------------- */
      let m = guid.match(/^(imdb|tvdb|tmdb):\/\/(.+)$/i);
      if (m) {
        provider = m[1].toLowerCase();
        id       = m[2].trim(); // <--- TRIM ADDED HERE
      } else {
        /* 2) Full IMDb link ------------------------------------ */
        m = guid.match(/imdb\.com\/title\/(tt\d+)/i);
        if (m) {
          provider = 'imdb';
          id       = m[1];
        } else {
          /* 3) Full TMDB link ---------------------------------- */
          m = guid.match(/(?:tmdb|themoviedb).*?\/(\d+)/i);
          if (m) {
            provider = 'tmdb';
            id       = m[1];
          }
        }
      }
    }

    /* -------- type movie / show --- */
    let type = 'movie'; // Default

    const rawCategory = (item.categories?.[0] || item.category || '').toLowerCase();
    const linkUrl     = (item.link || '').toLowerCase();

    // 1. Via RSS category (e.g., "show")
    if (rawCategory === 'show' || rawCategory === 'tv') {
      type = 'show';
    }
    // 2. Via URL (e.g., https://watch.plex.tv/show/...)
    else if (linkUrl.includes('/show/') || linkUrl.includes('/tv/')) {
      type = 'show';
    }

    return { title, year, provider, id, type };
  });
}
