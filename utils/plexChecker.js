// utils/plexChecker.js
import fetch from 'node-fetch';

let logFn = console.log;
let warnFn = console.warn;
let errorFn = console.error;

export function setPlexLogger(fn) {
  logFn = fn;
  warnFn = (msg) => fn(`⚠️ ${msg}`);
  errorFn = (msg) => fn(`❌ ${msg}`);
}

// CACHE GLOBAL POUR LA SESSION DE SCAN
// Key: "sectionID_year" (ex: "1_2024")
// Value: Array of items metadata
const scanCache = new Map();
let sectionsCache = null; // Cache pour les sections

export function clearScanCache() {
  scanCache.clear();
  sectionsCache = null; // On force le rechargement des sections au prochain scan
  // logFn('🧹 Cache de scan vidé.');
}

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function getLibrarySections(config) {
  if (sectionsCache) return sectionsCache; // Retourne le cache si dispo

  const url = `${config.plexUrl}/library/sections?X-Plex-Token=${config.plexToken}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json();
    const allSections = json.MediaContainer?.Directory || [];
    
    // Filtrer pour ne garder que les bibliothèques de films et séries
    // ET qui ne sont pas dans la liste d'exclusion
    const excluded = config.excludeLibraries || [];

    const sections = allSections
      .filter(s => ['movie', 'show'].includes(s.type))
      .filter(s => !excluded.includes(s.title))
      .map(s => ({ id: String(s.key), type: s.type }));

    logFn(`📚 Sections détectées : ${sections.map(s => `${s.id} (${s.type})`).join(', ')}`);
    sectionsCache = sections; // Sauvegarde dans le cache
    return sections;
  } catch (e) {
    warnFn('Impossible de récupérer les sections de la bibliothèque Plex.');
    return [];
  }
}

/**
 * Récupère les métadonnées complètes d'un item via son ratingKey.
 * Indispensable pour les séries où la liste globale ne contient pas toujours les GUIDs externes.
 */
async function fetchItemDetails(config, ratingKey) {
  const url = `${config.plexUrl}/library/metadata/${ratingKey}?includeGuids=1&X-Plex-Token=${config.plexToken}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.MediaContainer?.Metadata?.[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Vérifie si un item Plex correspond strictement à l'ID recherché.
 * Gère les subtilités IMDb (tt...) et TVDB (tvdb vs thetvdb).
 */
function isIdMatch(item, provider, id) {
  if (!provider || !id) return false;

  const externalGuids = item.Guid || [];
  const targetGuid = `${provider}://${id}`;

  // 1. Match Strict Exact
  let match = externalGuids.some(g => g.id === targetGuid);

  // 2. Fallback IMDb (tt...)
  if (!match && id.startsWith('tt')) {
      match = externalGuids.some(g => g.id && g.id.endsWith(`://${id}`));
      // Legacy agent
      if (!match && item.guid) {
        match = item.guid.includes(`://${id}`) || item.guid.endsWith(id);
      }
  }

  // 3. Fallback TVDB (tvdb vs thetvdb)
  if (!match && provider === 'tvdb') {
      match = externalGuids.some(g => g.id && (g.id === `thetvdb://${id}` || g.id.endsWith(`/${id}`)));
      // Legacy agent
      if (!match && item.guid) {
        match = item.guid.includes(`thetvdb://${id}`) || item.guid.includes(`tvdb://${id}`);
      }
  }

  return match;
}

/**
 * Vérifie via Tautulli si disponible
 * Utilise get_library_media_info pour chercher par ID ou Titre
 * Et vérifie le ratingKey via Plex pour confirmation ID absolue.
 */
async function checkViaTautulli(config, title, year, provider, id, sectionsList) {
  if (!config.tautulliUrl || !config.tautulliApiKey) return null;
  
  const baseUrl = config.tautulliUrl;
  const apiKey = config.tautulliApiKey;
  
  // On scanne toutes les sections disponibles pour être exhaustif
  const sectionIDs = sectionsList.map(s => s.id);

  for (const sectionId of sectionIDs) {
    try {
      let candidates = [];

      // 1. Recherche par ID (Prioritaire)
      if (id) {
        const url = `${baseUrl}/api/v2?apikey=${apiKey}&cmd=get_library_media_info&section_id=${sectionId}&search=${encodeURIComponent(id)}`;
        const res = await fetch(url);
        const json = await res.json();
        const items = json.response?.data?.data || [];
        candidates.push(...items);
      }

      // 2. Recherche par Titre (Si ID ne donne rien ou pour compléter)
      // On le fait si on n'a pas trouvé de candidats par ID, ou si on veut être sûr.
      if (candidates.length === 0 && title) {
         const url = `${baseUrl}/api/v2?apikey=${apiKey}&cmd=get_library_media_info&section_id=${sectionId}&search=${encodeURIComponent(title)}`;
         const res = await fetch(url);
         const json = await res.json();
         const items = json.response?.data?.data || [];
         // On évite les doublons
         for (const it of items) {
             if (!candidates.some(c => c.rating_key === it.rating_key)) {
                 candidates.push(it);
             }
         }
      }

      // 3. Vérification via Plex (RatingKey)
      for (const candidate of candidates) {
          if (!candidate.rating_key) continue;
          
          // On récupère les métadonnées complètes Plex pour vérifier les GUIDs
          const fullItem = await fetchItemDetails(config, candidate.rating_key);
          if (fullItem) {
              // Vérification ID stricte
              if (isIdMatch(fullItem, provider, id)) {
                  const section = sectionsList.find(s => s.id === String(sectionId));
                  const detectedType = section ? section.type : null;
                  
                  logFn(`🎯 [Tautulli] Match confirmé via Plex ! (Section ${sectionId}) "${title}" -> "${fullItem.title}"`);
                  return { found: true, plexTitle: fullItem.title, detectedType };
              }
          }
      }
    } catch (e) {
      warnFn(`Erreur Tautulli check (Section ${sectionId}): ${e.message}`);
    }
  }
  return null;
}

/**
 * Fonction interne qui exécute la recherche Plex (M1 + M2) pour un type donné.
 */
async function checkTypeInPlex(title, year, type, config, provider, id, sectionsList) {
  const token = config.plexToken;
  const plexBase = config.plexUrl || 'http://localhost:32400'; 
  const headers = { 'Accept': 'application/json' };
  const plexType = (type === 'show') ? '2' : '1';

  // Filtrage des sections : on ne scanne que les bibliothèques du type demandé
  const relevantSections = sectionsList.filter(s => s.type === type).map(s => s.id);

  // --- M1: Recherche par Titre + Filtrage strict ---
  try {
    const searchUrl = `${plexBase}/search?query=${encodeURIComponent(title)}&type=${plexType}&includeGuids=1&X-Plex-Container-Size=50&X-Plex-Token=${token}`;
    const res = await fetch(searchUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const results = json.MediaContainer?.Metadata || [];

    for (const item of results) {
      if (relevantSections.length > 0 && !relevantSections.includes(String(item.librarySectionID))) continue;

      // 1. Vérification par ID
      if (provider && id) {
        if (isIdMatch(item, provider, id)) {
           logFn(`🎯 [M1] Titre "${title}" trouvé via ID Strict (${provider}://${id}) -> "${item.title}"`);
           return { found: true, plexTitle: item.title };
        }
        continue;
      }

      // 2. Vérification par Titre + Année
      const itemYear = parseInt(item.year);
      const targetYear = parseInt(year);
      const yearMatch = !year || !itemYear || (Math.abs(itemYear - targetYear) <= 1);
      
      const cleanTitle = normalize(title);
      const cleanPlexTitle = normalize(item.title);
      const cleanOriginal = normalize(item.originalTitle);

      if (yearMatch && (cleanTitle === cleanPlexTitle || cleanTitle === cleanOriginal)) {
        logFn(`🎯 [M1] Titre Match -> "${item.title}" (Année: ${item.year})`);
        return { found: true, plexTitle: item.title };
      }
    }
  } catch (e) { 
    errorFn(`Erreur check Plex (M1) pour "${title}": ${e.message}`); 
  }

  // --- M2: Scan Structuré par Année (Méthode Ultime) ---
  if (id && year) {
    try {
      const yearsToScan = [year, year - 1, year + 1];
      const uniqueYears = [...new Set(yearsToScan)].filter(y => y > 1900 && y < 2100);

      for (const sectionID of relevantSections) {
        for (const scanYear of uniqueYears) {
          const cacheKey = `${sectionID}_${scanYear}`;
          let items = [];

          if (scanCache.has(cacheKey)) {
            items = scanCache.get(cacheKey);
          } else {
            let start = 0;
            const size = 100; 
            let hasMore = true;
            
            while (hasMore) {
              const url = `${plexBase}/library/sections/${sectionID}/all?type=${plexType}&year=${scanYear}&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}&X-Plex-Token=${token}`;
              const res = await fetch(url, { headers });
              if (!res.ok) break;

              const json = await res.json();
              const metaItems = json.MediaContainer?.Metadata || [];
              const dirItems  = json.MediaContainer?.Directory || [];
              const pageItems = [...metaItems, ...dirItems];
              
              items.push(...pageItems);

              if (pageItems.length < size) hasMore = false;
              else start += size;
            }
            scanCache.set(cacheKey, items);
            logFn(`🔎 [M2] Scan Section ${sectionID} | Année ${scanYear} : ${items.length} éléments trouvés.`);
          }

          for (const item of items) {
            if (isIdMatch(item, provider, id)) {
               logFn(`🎯 [M2-Ultime] Scan Année ${scanYear} (Cible: ${year}) (Section ${sectionID}) -> Trouvé : "${item.title}"`);
               return { found: true, plexTitle: item.title };
            }
          }

          // --- DEEP SCAN (Spécial Séries) ---
          if (plexType === '2') {
            const incompleteItems = items.filter(i => !i.Guid || i.Guid.length === 0);
            if (incompleteItems.length > 0) {
                for (const incomplete of incompleteItems) {
                    if (!incomplete.ratingKey) continue;
                    const fullItem = await fetchItemDetails(config, incomplete.ratingKey);
                    if (fullItem && isIdMatch(fullItem, provider, id)) {
                        logFn(`🎯 [M2-DeepScan] Trouvé via scan approfondi ! -> "${fullItem.title}"`);
                        return { found: true, plexTitle: fullItem.title };
                    }
                }
            }
          }
        }
      }
    } catch (e) {
      errorFn(`Erreur check Plex (M2-Ultime) pour "${title}": ${e.message}`);
    }
  }

  // --- M3: Scan Global (Méthode Nucléaire) ---
  // Si on a un ID et qu'on n'a toujours rien trouvé, on scanne l'intégralité de la section.
  // C'est la seule méthode 100% fiable si le titre ne correspond pas et que Tautulli ne trouve pas l'ID.
  if (id) {
    try {
      for (const sectionID of relevantSections) {
        const cacheKey = `${sectionID}_ALL`;
        let items = [];

        if (scanCache.has(cacheKey)) {
          items = scanCache.get(cacheKey);
        } else {
          let start = 0;
          const size = 200; 
          let hasMore = true;
          
          logFn(`☢️ [M3-Nuclear] Lancement scan complet Section ${sectionID} (ID: ${provider}://${id})...`);

          while (hasMore) {
            const url = `${plexBase}/library/sections/${sectionID}/all?type=${plexType}&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}&X-Plex-Token=${token}`;
            const res = await fetch(url, { headers });
            if (!res.ok) break;

            const json = await res.json();
            const metaItems = json.MediaContainer?.Metadata || [];
            const dirItems  = json.MediaContainer?.Directory || [];
            const pageItems = [...metaItems, ...dirItems];
            
            items.push(...pageItems);

            if (pageItems.length < size) hasMore = false;
            else start += size;
          }
          scanCache.set(cacheKey, items);
          logFn(`☢️ [M3-Nuclear] Section ${sectionID} chargée en cache : ${items.length} éléments.`);
        }

        for (const item of items) {
          if (isIdMatch(item, provider, id)) {
             logFn(`🎯 [M3-Nuclear] Trouvé dans le scan complet ! -> "${item.title}"`);
             return { found: true, plexTitle: item.title };
          }
        }
        
        // Deep Scan M3 (Only for items without GUIDs)
        if (plexType === '2') {
             const incompleteItems = items.filter(i => !i.Guid || i.Guid.length === 0);
             if (incompleteItems.length > 0) {
                 for (const incomplete of incompleteItems) {
                    if (!incomplete.ratingKey) continue;
                    const fullItem = await fetchItemDetails(config, incomplete.ratingKey);
                    if (fullItem && isIdMatch(fullItem, provider, id)) {
                        logFn(`🎯 [M3-DeepScan] Trouvé via scan approfondi ! -> "${fullItem.title}"`);
                        return { found: true, plexTitle: fullItem.title };
                    }
                 }
             }
        }
      }
    } catch (e) {
      errorFn(`Erreur check Plex (M3-Nuclear) pour "${title}": ${e.message}`);
    }
  }

  return { found: false, plexTitle: null };
}

/**
 * Retourne un objet : { found: boolean, plexTitle: string | null, detectedType: string | null }
 */
export async function checkIfInPlex(title, year, type, config, provider = null, id = null) {
  // Récupérer les sections (objets {id, type})
  const sectionsList = await getLibrarySections(config);

  // --- M0: Tautulli Check (Prioritaire) ---
  const tautulliRes = await checkViaTautulli(config, title, year, provider, id, sectionsList);
  if (tautulliRes) {
    return { 
      ...tautulliRes, 
      detectedType: tautulliRes.detectedType || type 
    };
  }

  // --- 1. Essai avec le type demandé (ex: movie) ---
  // logFn(`🕵️ [PlexCheck] Vérification 1/2 : Type "${type}"...`);
  let res = await checkTypeInPlex(title, year, type, config, provider, id, sectionsList);
  if (res.found) return { ...res, detectedType: type };

  // --- 2. Essai avec le type opposé (ex: show) ---
  // Utile pour les flux RSS (Letterboxd) qui mettent tout en "movie"
  const otherType = (type === 'movie') ? 'show' : 'movie';
  // On ne tente l'inversion que si on a un ID ou un titre clair, pour éviter trop de requêtes
  // Mais ici on veut être exhaustif.
  
  // logFn(`🕵️ [PlexCheck] Vérification 2/2 : Type "${otherType}"...`);
  res = await checkTypeInPlex(title, year, otherType, config, provider, id, sectionsList);
  if (res.found) {
      logFn(`💡 [SmartCheck] Trouvé ! C'était en fait un(e) "${otherType}".`);
      return { ...res, detectedType: otherType };
  }

  return { found: false, plexTitle: null };
}