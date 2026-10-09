import fs from "node:fs";
import path from "node:path";
import { API_URLS, USER_AGENTS, RATE_LIMITS, CACHE_DIR } from "../config.js";
import { fetchWithRetry } from "../utils/http.js";
import { createThrottler } from "../utils/throttle.js";

const CACHE_FILE = path.join(CACHE_DIR, "place-to-universe.json");

// In-memory cache to prevent duplicate HTTP calls for the same placeId
const placeToUniverseCache = new Map();

/**
 * Loads place-to-universe mappings from disk cache if present.
 * @returns {number} Number of entries loaded.
 */
export function loadPlaceToUniverseCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      let loaded = 0;
      for (const [pid, uid] of Object.entries(data)) {
        const numPid = Number(pid);
        const numUid = Number(uid);
        if (numPid && numUid) {
          placeToUniverseCache.set(numPid, numUid);
          loaded++;
        }
      }
      console.log(`-> Loaded ${loaded} place-to-universe mappings from cache.`);
      return loaded;
    }
  } catch (err) {
    console.warn(`[Roblox Cache] Failed to load cache: ${err.message}`);
  }
  return 0;
}

/**
 * Persists current in-memory place-to-universe mappings to disk cache.
 */
export function savePlaceToUniverseCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const obj = {};
    for (const [pid, uid] of placeToUniverseCache.entries()) {
      obj[pid] = uid;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
    console.log(`-> Saved ${placeToUniverseCache.size} place-to-universe mappings to cache.`);
  } catch (err) {
    console.warn(`[Roblox Cache] Failed to save cache: ${err.message}`);
  }
}

// Automatically load existing cache from disk if available
loadPlaceToUniverseCache();

// Paced to ~55 requests/min to strictly respect Roblox's 60 req/min limit on /universes/v1/places/{placeId}/universe
const universeThrottle = createThrottler(1050);

/**
 * Batches place IDs to fetch fresh high-resolution game icons from Roblox Thumbnails API.
 * Roblox allows up to 50 placeIds per request.
 *
 * @param {(number|string)[]} placeIds
 * @returns {Promise<Map<number, string>>}
 */
const iconThrottle = createThrottler(1050); // Paced to ~55 requests/min (under Roblox's 60 req/min limit)

export async function fetchRobloxPlaceIcons(placeIds) {
  const result = new Map();
  const validIds = Array.from(
    new Set(
      placeIds
        .map((id) => (typeof id === "number" ? id : Number(id)))
        .filter((id) => !isNaN(id) && id > 0),
    ),
  );

  if (validIds.length === 0) return result;

  const chunkSize = RATE_LIMITS.robloxChunkSize || 50;
  const chunks = [];
  for (let i = 0; i < validIds.length; i += chunkSize) {
    chunks.push(validIds.slice(i, i + chunkSize));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await iconThrottle(async () => {
      const url = API_URLS.roblox.placeIcons(chunk);
      const headers = {
        "User-Agent": USER_AGENTS.roblox,
      };
      if (process.env.ROBLOX_API_KEY) {
        headers["x-api-key"] = process.env.ROBLOX_API_KEY;
      }

      try {
        const res = await fetchWithRetry(url, { headers });
        if (res.ok && Array.isArray(res.data?.data)) {
          for (const item of res.data.data) {
            if (item.imageUrl && item.state === "Completed") {
              result.set(Number(item.targetId), item.imageUrl);
            }
          }
        }
      } catch (err) {
        console.warn(
          `[Roblox] Failed to fetch place icons batch: ${err.message}`,
        );
      }
    });

    if ((i + 1) % 25 === 0 || i + 1 === chunks.length) {
      console.log(
        `-> Place icons progress: fetched ${i + 1}/${chunks.length} batches (${result.size} icons resolved)...`,
      );
    }
  }

  return result;
}

/**
 * Resolves numeric placeId to Roblox universeId with in-memory caching and polite rate limiting.
 *
 * @param {number|string} placeId
 * @returns {Promise<number|null>}
 */
export async function resolvePlaceToUniverse(placeId) {
  const numericPlaceId = Number(placeId);
  if (!numericPlaceId || isNaN(numericPlaceId) || numericPlaceId <= 0) {
    return null;
  }

  if (placeToUniverseCache.has(numericPlaceId)) {
    return placeToUniverseCache.get(numericPlaceId);
  }

  const universeId = await universeThrottle(async () => {
    const url = API_URLS.roblox.placeUniverse(numericPlaceId);
    const headers = {
      "User-Agent": USER_AGENTS.roblox,
    };
    if (process.env.ROBLOX_API_KEY) {
      headers["x-api-key"] = process.env.ROBLOX_API_KEY;
    }

    const res = await fetchWithRetry(url, { headers });
    if (res.ok && res.data?.universeId) {
      return res.data.universeId;
    }
    return null;
  });

  if (universeId) {
    placeToUniverseCache.set(numericPlaceId, universeId);
  }

  return universeId;
}

/**
 * Fetches comprehensive Roblox game details and statistics for a given placeId.
 *
 * @param {number|string} placeId
 * @returns {Promise<Object|null>}
 */
export async function fetchRobloxGameDetails(placeId) {
  const numericPlaceId = Number(placeId);
  if (!numericPlaceId || isNaN(numericPlaceId) || numericPlaceId <= 0) {
    return null;
  }

  const universeId = await resolvePlaceToUniverse(numericPlaceId);
  if (!universeId) return null;

  const headers = {
    "User-Agent": USER_AGENTS.roblox,
  };
  if (process.env.ROBLOX_API_KEY) {
    headers["x-api-key"] = process.env.ROBLOX_API_KEY;
  }

  try {
    const [gameRes, iconRes] = await Promise.allSettled([
      fetchWithRetry(API_URLS.roblox.gameDetails(universeId), { headers }),
      fetchWithRetry(API_URLS.roblox.gameIcons(universeId), { headers }),
    ]);

    let gameName = "Roblox Game";
    let description = "";
    let creatorName = "";
    let creatorType = "";
    let playing = 0;
    let visits = 0;
    let maxPlayers = 0;
    let iconUrl = "";
    let canonicalUrlPath = "";
    let updated = null;
    let created = null;

    if (gameRes.status === "fulfilled" && gameRes.value.ok) {
      const entry = gameRes.value.data?.data?.[0];
      if (entry) {
        if (entry.name) gameName = entry.name;
        if (entry.description) description = entry.description;
        if (entry.creator?.name) creatorName = entry.creator.name;
        if (entry.creator?.type) creatorType = entry.creator.type;
        if (typeof entry.playing === "number") playing = entry.playing;
        if (typeof entry.visits === "number") visits = entry.visits;
        if (typeof entry.maxPlayers === "number") maxPlayers = entry.maxPlayers;
        if (entry.canonicalUrlPath) canonicalUrlPath = entry.canonicalUrlPath;
        if (entry.updated) updated = entry.updated;
        if (entry.created) created = entry.created;
      }
    }

    if (iconRes.status === "fulfilled" && iconRes.value.ok) {
      const iconEntry = iconRes.value.data?.data?.[0];
      if (iconEntry?.imageUrl) {
        iconUrl = iconEntry.imageUrl;
      }
    }

    return {
      placeId: numericPlaceId,
      universeId,
      name: gameName,
      description,
      creator: {
        name: creatorName || "Roblox",
        type: creatorType || "User",
      },
      creatorName,
      creatorType,
      playing,
      visits,
      maxPlayers,
      iconUrl,
      updated,
      created,
      canonicalUrlPath,
      robloxUrl: `https://www.roblox.com/games/${numericPlaceId}`,
    };
  } catch (err) {
    console.warn(
      `[Roblox] Failed to fetch game details for ${placeId}: ${err.message}`,
    );
    return null;
  }
}

/**
 * Resolves an array of placeIds and batch-fetches comprehensive details and icons
 * from Roblox API in chunks of up to 100 universeIds per request.
 *
 * @param {(number|string)[]} placeIds
 * @returns {Promise<Map<number, Object>>} Map of placeId -> Roblox game details
 */
export async function fetchRobloxGamesBatch(placeIds) {
  const result = new Map();
  const validIds = Array.from(
    new Set(
      placeIds
        .map((id) => (typeof id === "number" ? id : Number(id)))
        .filter((id) => !isNaN(id) && id > 0),
    ),
  );

  if (validIds.length === 0) return result;

  // 1. Resolve placeIds to universeIds sequentially through the polite universe throttler
  const placeToUniverse = new Map();
  const universeToPlace = new Map();

  for (let i = 0; i < validIds.length; i++) {
    const pid = validIds[i];
    const uid = await resolvePlaceToUniverse(pid);
    if (uid) {
      placeToUniverse.set(pid, uid);
      universeToPlace.set(uid, pid);
    }
    if ((i + 1) % 25 === 0 || i + 1 === validIds.length) {
      console.log(
        `-> Universe resolution progress: ${i + 1}/${validIds.length} place IDs resolved...`,
      );
    }
  }

  const universeIds = Array.from(universeToPlace.keys());
  if (universeIds.length === 0) return result;

  // 2. Fetch game details and icons in chunks of 100 universeIds
  const BATCH_SIZE = 100;
  const headers = {
    "User-Agent": USER_AGENTS.roblox,
  };
  if (process.env.ROBLOX_API_KEY) {
    headers["x-api-key"] = process.env.ROBLOX_API_KEY;
  }

  for (let i = 0; i < universeIds.length; i += BATCH_SIZE) {
    const uidsChunk = universeIds.slice(i, i + BATCH_SIZE);
    try {
      const [gamesRes, iconsRes] = await Promise.allSettled([
        fetchWithRetry(API_URLS.roblox.gameDetails(uidsChunk), { headers }),
        fetchWithRetry(API_URLS.roblox.gameIcons(uidsChunk), { headers }),
      ]);

      const iconsMap = new Map();
      if (iconsRes.status === "fulfilled" && iconsRes.value.ok) {
        const iconEntries = iconsRes.value.data?.data || [];
        for (const icon of iconEntries) {
          if (icon.imageUrl && icon.targetId) {
            iconsMap.set(icon.targetId, icon.imageUrl);
          }
        }
      }

      if (gamesRes.status === "fulfilled" && gamesRes.value.ok) {
        const gameEntries = gamesRes.value.data?.data || [];
        for (const entry of gameEntries) {
          const uid = entry.id;
          const pid = entry.rootPlaceId || universeToPlace.get(uid);
          if (!pid) continue;

          result.set(pid, {
            placeId: pid,
            universeId: uid,
            name: entry.name || "Roblox Game",
            description: entry.description || "",
            creator: {
              name: entry.creator?.name || "Roblox",
              type: entry.creator?.type || "User",
            },
            creatorName: entry.creator?.name || "Roblox",
            creatorType: entry.creator?.type || "User",
            playing: typeof entry.playing === "number" ? entry.playing : 0,
            visits: typeof entry.visits === "number" ? entry.visits : 0,
            maxPlayers:
              typeof entry.maxPlayers === "number" ? entry.maxPlayers : 0,
            iconUrl: iconsMap.get(uid) || "",
            updated: entry.updated || null,
            created: entry.created || null,
            canonicalUrlPath: entry.canonicalUrlPath || "",
            robloxUrl: `https://www.roblox.com/games/${pid}`,
          });
        }
      }
    } catch (err) {
      console.warn(
        `[Roblox] Failed to batch fetch game details chunk: ${err.message}`,
      );
    }

    if (i + BATCH_SIZE < universeIds.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return result;
}
