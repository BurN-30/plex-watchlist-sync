// utils/plexChecker.js
// Plex availability checker with optimized GUID indexing

import fetch from 'node-fetch';

let logFn = console.log;
let warnFn = console.warn;
let errorFn = console.error;

export function setPlexLogger(fn) {
  logFn = fn;
  warnFn = (msg) => fn(`[WARN] ${msg}`);
  errorFn = (msg) => fn(`[ERROR] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// GUID INDEX - Loaded once at scan start for O(1) lookups
// ═══════════════════════════════════════════════════════════════════════════

let guidIndex = {
  imdb: new Map(),  // imdb_id -> {title, year, ratingKey, type, sectionId}
  tmdb: new Map(),  // tmdb_id -> {title, year, ratingKey, type, sectionId}
  tvdb: new Map(),  // tvdb_id -> {title, year, ratingKey, type, sectionId}
  loaded: false,
  itemCount: 0
};

let sectionsCache = null;

/**
 * Clear all caches (call between scans)
 */
export function clearScanCache() {
  guidIndex = {
    imdb: new Map(),
    tmdb: new Map(),
    tvdb: new Map(),
    loaded: false,
    itemCount: 0
  };
  sectionsCache = null;
}

/**
 * Get library sections (movies and shows)
 */
async function getLibrarySections(config) {
  if (sectionsCache) return sectionsCache;

  const url = `${config.plexUrl}/library/sections?X-Plex-Token=${config.plexToken}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json();
    const allSections = json.MediaContainer?.Directory || [];

    const excluded = config.excludeLibraries || [];
    const sections = allSections
      .filter(s => ['movie', 'show'].includes(s.type))
      .filter(s => !excluded.includes(s.title))
      .map(s => ({ id: String(s.key), type: s.type, title: s.title }));

    sectionsCache = sections;
    return sections;
  } catch (e) {
    warnFn('Failed to fetch Plex sections');
    return [];
  }
}

/**
 * Build GUID index from all library items
 * This is the key optimization - load once, lookup O(1)
 */
export async function buildGuidIndex(config) {
  if (guidIndex.loaded) return guidIndex;

  const sections = await getLibrarySections(config);
  const startTime = Date.now();

  logFn(`[INDEX] Building GUID index from ${sections.length} sections...`);

  for (const section of sections) {
    const plexType = section.type === 'show' ? '2' : '1';
    let start = 0;
    const size = 200;
    let hasMore = true;

    while (hasMore) {
      const url = `${config.plexUrl}/library/sections/${section.id}/all?type=${plexType}&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}&X-Plex-Token=${config.plexToken}`;

      try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) break;

        const json = await res.json();
        const items = json.MediaContainer?.Metadata || [];

        for (const item of items) {
          const guids = item.Guid || [];
          const entry = {
            title: item.title,
            year: item.year,
            ratingKey: item.ratingKey,
            type: section.type,
            sectionId: section.id
          };

          for (const g of guids) {
            const id = g.id || '';
            if (id.startsWith('imdb://')) {
              guidIndex.imdb.set(id.replace('imdb://', ''), entry);
            } else if (id.startsWith('tmdb://')) {
              guidIndex.tmdb.set(id.replace('tmdb://', ''), entry);
            } else if (id.startsWith('tvdb://') || id.startsWith('thetvdb://')) {
              const tvdbId = id.replace('tvdb://', '').replace('thetvdb://', '');
              guidIndex.tvdb.set(tvdbId, entry);
            }
          }
          guidIndex.itemCount++;
        }

        if (items.length < size) hasMore = false;
        else start += size;
      } catch (e) {
        warnFn(`Failed to index section ${section.id}: ${e.message}`);
        break;
      }
    }
  }

  guidIndex.loaded = true;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logFn(`[INDEX] Indexed ${guidIndex.itemCount} items (IMDb: ${guidIndex.imdb.size}, TMDb: ${guidIndex.tmdb.size}, TVDB: ${guidIndex.tvdb.size}) in ${elapsed}s`);

  return guidIndex;
}

// ═══════════════════════════════════════════════════════════════════════════
// FAST PATH - Direct GUID lookup (O(1), no API calls)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fast lookup by ID in the GUID index
 * Returns match instantly without any API calls
 */
function lookupByGuid(provider, id) {
  if (!id || !guidIndex.loaded) return null;

  let entry = null;

  if (provider === 'imdb' || id.startsWith('tt')) {
    entry = guidIndex.imdb.get(id);
  } else if (provider === 'tmdb') {
    entry = guidIndex.tmdb.get(id);
  } else if (provider === 'tvdb') {
    entry = guidIndex.tvdb.get(id);
  }

  // Also try IMDb if ID looks like tt...
  if (!entry && id.startsWith('tt')) {
    entry = guidIndex.imdb.get(id);
  }

  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRING NORMALIZATION - For title comparison
// ═══════════════════════════════════════════════════════════════════════════

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[:\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// TAUTULLI SEARCH - Fast search via Tautulli API
// ═══════════════════════════════════════════════════════════════════════════

async function checkViaTautulli(config, title, year, provider, id) {
  if (!config.tautulliUrl || !config.tautulliApiKey) return null;

  const sections = await getLibrarySections(config);
  const baseUrl = config.tautulliUrl;
  const apiKey = config.tautulliApiKey;

  for (const section of sections) {
    try {
      // Search by ID first (most reliable)
      if (id) {
        const url = `${baseUrl}/api/v2?apikey=${apiKey}&cmd=get_library_media_info&section_id=${section.id}&search=${encodeURIComponent(id)}`;
        const res = await fetch(url);
        const json = await res.json();
        const results = json.response?.data?.data || [];

        for (const r of results) {
          // Verify match via GUID index
          const indexed = lookupByGuid(provider, id);
          if (indexed && String(indexed.ratingKey) === String(r.rating_key)) {
            return { found: true, plexTitle: indexed.title, detectedType: indexed.type };
          }
        }
      }

      // Fallback: search by title (strict matching)
      if (title) {
        const url = `${baseUrl}/api/v2?apikey=${apiKey}&cmd=get_library_media_info&section_id=${section.id}&search=${encodeURIComponent(title)}`;
        const res = await fetch(url);
        const json = await res.json();
        const results = json.response?.data?.data || [];

        for (const r of results) {
          // Strict title match: normalized titles must be very similar
          const normSearch = normalize(title);
          const normResult = normalize(r.title);

          // Only accept exact match or if one is a substring and length difference is small
          const titleMatch = normSearch === normResult ||
            (normSearch === normResult.split(' ')[0] && normSearch.length >= 8) ||
            (normResult === normSearch.split(' ')[0] && normResult.length >= 8);

          // Year must match (±1 year tolerance)
          const yearMatch = year && r.year && Math.abs(parseInt(r.year) - parseInt(year)) <= 1;

          if (titleMatch && yearMatch) {
            return { found: true, plexTitle: r.title, detectedType: section.type };
          }
        }
      }
    } catch (e) {
      // Tautulli error, continue to next method
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TITLE SEARCH - Plex API search by title (fallback for items without ID)
// ═══════════════════════════════════════════════════════════════════════════

async function searchByTitle(config, title, year, type) {
  const plexType = type === 'show' ? '2' : '1';
  const url = `${config.plexUrl}/search?query=${encodeURIComponent(title)}&type=${plexType}&includeGuids=1&X-Plex-Container-Size=30&X-Plex-Token=${config.plexToken}`;

  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;

    const json = await res.json();
    const results = json.MediaContainer?.Metadata || [];

    // Find best match by title similarity and year
    for (const item of results) {
      const normTitle = normalize(title);
      const normPlex = normalize(item.title);

      // Check for title match (exact or contains)
      const titleMatch = normTitle === normPlex ||
        normTitle.includes(normPlex) ||
        normPlex.includes(normTitle);

      // Check year (allow ±1 year tolerance)
      const yearMatch = !year || !item.year ||
        Math.abs(parseInt(year) - parseInt(item.year)) <= 1;

      if (titleMatch && yearMatch) {
        return { found: true, plexTitle: item.title, detectedType: type };
      }
    }
  } catch (e) {
    // Search failed
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CHECK FUNCTION - Tiered approach with fast path
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if content is available in Plex
 *
 * Tier 0: GUID Index lookup (instant, requires ID)
 * Tier 1: Tautulli search (fast)
 * Tier 2: Plex title search (medium)
 *
 * M3 full scan is REMOVED - too slow and rarely needed with IDs
 *
 * @returns {{ found: boolean, plexTitle: string|null, detectedType: string|null }}
 */
export async function checkIfInPlex(title, year, type, config, provider = null, id = null) {
  // Ensure index is built
  if (!guidIndex.loaded) {
    await buildGuidIndex(config);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TIER 0: GUID Index Lookup (instant, O(1))
  // This is the fast path - no API calls needed
  // ═══════════════════════════════════════════════════════════════════════
  if (id) {
    const indexed = lookupByGuid(provider, id);
    if (indexed) {
      logFn(`[T0] "${title}" -> "${indexed.title}" (instant match)`);
      return { found: true, plexTitle: indexed.title, detectedType: indexed.type };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TIER 1: Tautulli Search (fast)
  // ═══════════════════════════════════════════════════════════════════════
  const tautulliResult = await checkViaTautulli(config, title, year, provider, id);
  if (tautulliResult?.found) {
    logFn(`[T1] "${title}" -> "${tautulliResult.plexTitle}" (Tautulli)`);
    return tautulliResult;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TIER 2: Plex Title Search (fallback for items without ID)
  // ═══════════════════════════════════════════════════════════════════════
  if (!id) {
    const searchResult = await searchByTitle(config, title, year, type);
    if (searchResult?.found) {
      logFn(`[T2] "${title}" -> "${searchResult.plexTitle}" (title search)`);
      return searchResult;
    }

    // Try opposite type (movie <-> show)
    const otherType = type === 'movie' ? 'show' : 'movie';
    const altResult = await searchByTitle(config, title, year, otherType);
    if (altResult?.found) {
      logFn(`[T2] "${title}" -> "${altResult.plexTitle}" (found as ${otherType})`);
      return { ...altResult, detectedType: otherType };
    }
  }

  // Not found in Plex
  return { found: false, plexTitle: null, detectedType: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH PROCESSING - Process multiple items in parallel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check multiple items in parallel
 * @param {Array} items - Array of {title, year, type, provider, id}
 * @param {Object} config - Configuration
 * @param {number} concurrency - Max concurrent checks (default 10)
 * @returns {Promise<Map>} - Map of item -> result
 */
export async function checkBatch(items, config, concurrency = 10) {
  // Ensure index is built first
  if (!guidIndex.loaded) {
    await buildGuidIndex(config);
  }

  const results = new Map();

  // Process in chunks
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const promises = chunk.map(async (item) => {
      const result = await checkIfInPlex(
        item.title,
        item.year,
        item.type,
        config,
        item.provider,
        item.id
      );
      return { item, result };
    });

    const chunkResults = await Promise.all(promises);
    for (const { item, result } of chunkResults) {
      results.set(item, result);
    }
  }

  return results;
}
