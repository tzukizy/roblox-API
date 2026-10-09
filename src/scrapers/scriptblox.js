import crypto from "node:crypto";
import { API_URLS, USER_AGENTS } from "../config.js";
import { fetchWithRetry } from "../utils/http.js";
import { normalizeSlug } from "../utils/helpers.js";

/**
 * Generates HMAC authentication cookie for ScriptBlox sitemaps.
 * Secret: "ScR1ptBlx"
 * Cookie format: __scriptblox_validation=?token{timestamp}-{base64_hmac}; __scriptblox_ua_={encoded_ua}
 */
export function generateScriptbloxValidationCookie() {
  const secret = "ScR1ptBlx";
  const userAgent = USER_AGENTS.browser;
  const message = encodeURIComponent(userAgent);
  const time = Math.floor(Date.now() / 1000);
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(message + time)
    .digest("base64");
  const token = `${time}-${encodeURIComponent(hmac)}`;
  return {
    cookie: `__scriptblox_validation=?token${token}; __scriptblox_ua_=${message}`,
    userAgent,
  };
}

/**
 * Scrapes ScriptBlox sitemap-games.xml (9,900+ games) and builds a master
 * index mapping pure slugs and canonical slugs to numeric Roblox place IDs.
 *
 * @returns {Promise<{
 *   games: Array<{ placeId: number, slug: string, pureSlug: string }>,
 *   slugToPlaceId: Map<string, number>,
 *   placeIdToSlug: Map<number, string>
 * }>}
 */
export async function scrapeScriptBloxGameSitemap() {
  const { cookie, userAgent } = generateScriptbloxValidationCookie();
  const url = "https://scriptblox.com/sitemap-games.xml";

  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": userAgent,
      Cookie: cookie,
      Accept: "application/xml, text/xml, */*",
    },
  });

  const slugToPlaceId = new Map();
  const placeIdToSlug = new Map();
  const games = [];

  if (!res.ok || !res.data) {
    console.warn(
      `[ScriptBlox] Failed to fetch sitemap-games.xml: HTTP ${res.status}`,
    );
    return { games, slugToPlaceId, placeIdToSlug };
  }

  const xmlText =
    typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  const locRegex = /<loc>https:\/\/scriptblox\.com\/game\/([^<]+)<\/loc>/g;

  let match;
  while ((match = locRegex.exec(xmlText)) !== null) {
    const rawSegment = match[1].trim();
    if (!rawSegment) continue;

    if (rawSegment.toLowerCase() === "universal") {
      slugToPlaceId.set("universal", 0);
      placeIdToSlug.set(0, "universal");
      games.push({ placeId: 0, slug: "universal", pureSlug: "universal" });
      continue;
    }

    const idMatch = rawSegment.match(/^(\d+)(?:-(.*))?$/);
    if (idMatch) {
      const placeId = Number(idMatch[1]);
      const pureSlug = idMatch[2] ? idMatch[2].toLowerCase().trim() : "";
      const canonicalSlug = rawSegment.toLowerCase().trim();

      if (placeId > 0) {
        games.push({ placeId, slug: canonicalSlug, pureSlug });
        placeIdToSlug.set(placeId, canonicalSlug);
        slugToPlaceId.set(canonicalSlug, placeId);
        slugToPlaceId.set(String(placeId), placeId);
        if (pureSlug && !slugToPlaceId.has(pureSlug)) {
          slugToPlaceId.set(pureSlug, placeId);
        }
      }
    } else {
      slugToPlaceId.set(rawSegment.toLowerCase().trim(), 0);
    }
  }

  return { games, slugToPlaceId, placeIdToSlug };
}

/**
 * Scrapes all script sitemaps (sitemap-0.xml through sitemap-8.xml) from ScriptBlox.
 * Returns an array of ~73,700 script slugs ordered from newest to oldest.
 *
 * @returns {Promise<string[]>}
 */
export async function scrapeScriptBloxScriptSitemaps() {
  const { cookie, userAgent } = generateScriptbloxValidationCookie();
  const indexUrl = "https://scriptblox.com/sitemap.xml";

  console.log("-> Fetching ScriptBlox sitemap index...");
  const indexRes = await fetchWithRetry(indexUrl, {
    headers: {
      "User-Agent": userAgent,
      Cookie: cookie,
      Accept: "application/xml, text/xml, */*",
    },
  });

  if (!indexRes.ok || !indexRes.data) {
    console.warn(
      `[ScriptBlox] Could not fetch sitemap.xml: HTTP ${indexRes.status}`,
    );
    return [];
  }

  const indexXml =
    typeof indexRes.data === "string"
      ? indexRes.data
      : JSON.stringify(indexRes.data);
  const sitemapUrls = (
    indexXml.match(
      /<loc>https:\/\/scriptblox\.com\/sitemap-\d+\.xml<\/loc>/g,
    ) || []
  ).map((x) => x.replace(/<\/?loc>/g, ""));

  console.log(
    `-> Found ${sitemapUrls.length} script sitemaps. Downloading script lists...`,
  );

  const allSlugs = [];
  // Fetch sitemaps concurrently
  const sitemapResults = await Promise.all(
    sitemapUrls.map(async (url) => {
      try {
        const res = await fetchWithRetry(url, {
          headers: {
            "User-Agent": userAgent,
            Cookie: cookie,
            Accept: "application/xml, text/xml, */*",
          },
        });
        if (res.ok && res.data) {
          const xml =
            typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          const matches =
            xml.match(
              /<loc>https:\/\/scriptblox\.com\/script\/([^<]+)<\/loc>/g,
            ) || [];
          return matches.map((m) =>
            m
              .replace(/<\/?loc>https:\/\/scriptblox\.com\/script\//g, "")
              .replace("</loc>", "")
              .trim(),
          );
        }
      } catch (err) {
        console.warn(`[ScriptBlox] Failed to parse ${url}: ${err.message}`);
      }
      return [];
    }),
  );

  for (const list of sitemapResults) {
    allSlugs.push(...list);
  }

  // The sitemaps are ordered oldest (sitemap-0) to newest (sitemap-8).
  // Reverse so newest scripts come first, matching 'latest' sorting!
  allSlugs.reverse();

  console.log(
    `✓ Discovered ${allSlugs.length} total scripts across ScriptBlox sitemaps.`,
  );
  return allSlugs;
}

/**
 * Direct request to ScriptBlox API with validation cookies
 *
 * @param {string} endpoint
 * @param {RequestInit} options
 * @returns {Promise<{ ok: boolean, status: number, data: any, error?: string }>}
 */
async function callScriptBlox(endpoint, options = {}) {
  const { cookie, userAgent } = generateScriptbloxValidationCookie();
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_URLS.scriptblox.base}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  return fetchWithRetry(url, {
    ...options,
    headers: {
      "User-Agent": userAgent,
      Cookie: cookie,
      Accept: "application/json",
      ...options.headers,
    },
  });
}

/**
 * Enriches scripts that lack game.gameId by inspecting the thumbnail URL pattern
 * e.g. /images/script/189707-1644958680318.png -> placeId 189707
 * Classifies gameId <= 0 as Universal/Hub scripts.
 */
export function enrichRawScriptPlaceIds(scripts, defaultPlaceId) {
  const numericPlaceId = defaultPlaceId ? Number(defaultPlaceId) : undefined;

  for (const s of scripts) {
    if (!s) continue;

    // Detect Universal or Hub scripts
    if (
      s.isUniversal ||
      s.isHub ||
      s.game?.gameId === -1 ||
      s.game?.gameId === 0
    ) {
      s.isUniversal = true;
      s.isHub = Boolean(s.isHub || s.game?.gameId === -1);
      if (s.game) {
        s.game.gameId = 0;
        s.game.placeId = 0;
      }
      continue;
    }

    if (s.game && (!s.game.gameId || s.game.gameId <= 0)) {
      let resolvedId = null;
      if (s.image) {
        const match = s.image.match(/\/images\/script\/(\d+)-/);
        if (match) {
          const pid = parseInt(match[1], 10);
          if (pid > 0) resolvedId = pid;
        }
      }
      if (
        !resolvedId &&
        numericPlaceId &&
        !isNaN(numericPlaceId) &&
        numericPlaceId > 0
      ) {
        resolvedId = numericPlaceId;
      }

      if (resolvedId) {
        s.game.gameId = resolvedId;
        s.game.placeId = resolvedId;
      }
    } else if (s.game?.gameId > 0) {
      s.game.placeId = s.game.gameId;
    }
  }
}

/**
 * Fetches scripts with filter and pagination options.
 *
 * @param {Object} options
 * @returns {Promise<{ totalPages: number, nextPage?: number, max: number, scripts: Array }>}
 */
export async function fetchScripts(options = {}) {
  const params = new URLSearchParams();
  if (options.page && options.page > 1)
    params.set("page", String(options.page));
  if (options.max)
    params.set("max", String(Math.min(20, Math.max(1, options.max))));
  if (options.mode) params.set("mode", options.mode);
  if (options.patched !== undefined)
    params.set("patched", options.patched ? "1" : "0");
  if (options.key !== undefined) params.set("key", options.key ? "1" : "0");
  if (options.keyless !== undefined)
    params.set("keyless", options.keyless ? "1" : "0");
  if (options.universal !== undefined)
    params.set("universal", options.universal ? "1" : "0");
  if (options.verified !== undefined)
    params.set("verified", options.verified ? "1" : "0");
  if (options.sortBy) params.set("sortBy", options.sortBy);
  if (options.order) params.set("order", options.order);
  if (options.owner) params.set("owner", options.owner);
  if (options.placeId) params.set("placeId", String(options.placeId));
  if (options.exclude) params.set("exclude", options.exclude);

  const qs = params.toString();
  const endpoint = `/script/fetch${qs ? `?${qs}` : ""}`;

  const res = await callScriptBlox(endpoint);
  if (!res.ok || !res.data?.result) {
    return {
      totalPages: 1,
      max: options.max || 20,
      scripts: [],
    };
  }

  const rawScripts = res.data.result.scripts || [];
  enrichRawScriptPlaceIds(rawScripts, options.placeId);

  return {
    totalPages: res.data.result.totalPages || 1,
    nextPage: res.data.result.nextPage,
    max: res.data.result.max || 20,
    scripts: rawScripts,
  };
}

/**
 * Fetches ScriptBlox leaderboard data.
 *
 * @param {"day"|"week"|"month"|"all"} period
 * @returns {Promise<Object|null>}
 */
export async function fetchLeaderboard(period = "day") {
  const validPeriods = new Set(["day", "week", "month", "all"]);
  const safePeriod = validPeriods.has(period) ? period : "day";
  const res = await callScriptBlox(`/leaderboard?period=${safePeriod}`);
  if (res.ok && res.data) {
    return res.data;
  }
  return null;
}

/**
 * Fetches verified executor directory list from ScriptBlox.
 *
 * @returns {Promise<Array>}
 */
export async function fetchExecutors() {
  const res = await callScriptBlox("/executor/list");
  if (res.ok && Array.isArray(res.data)) {
    return res.data;
  }
  return [];
}

/**
 * Fetches full detail for a specific script.
 *
 * @param {string} slugOrId
 * @returns {Promise<Object|null>}
 */
export async function fetchScriptDetails(slugOrId) {
  if (!slugOrId) return null;
  const clean = encodeURIComponent(normalizeSlug(slugOrId));
  const res = await callScriptBlox(`/script/${clean}`);
  if (res.ok && res.data?.script) {
    return res.data.script;
  }
  return null;
}

/**
 * Fetches all comments for a script across pages.
 * Note: Must use MongoDB ObjectId `script._id` for comment endpoint.
 *
 * @param {string} scriptId
 * @param {number} maxPages
 * @returns {Promise<{ totalPages: number, comments: Array, totalCount: number }>}
 */
export async function fetchAllComments(scriptId, maxPages = 5) {
  if (!scriptId) return { totalPages: 1, comments: [], totalCount: 0 };
  const clean = encodeURIComponent(normalizeSlug(scriptId));

  const firstPage = await callScriptBlox(`/comment/${clean}?page=1`);
  const totalPages = firstPage.data?.result?.totalPages || 1;
  const initialComments = firstPage.data?.result?.comments || [];

  if (totalPages <= 1 || maxPages <= 1) {
    return {
      totalPages,
      comments: initialComments,
      totalCount: initialComments.length,
    };
  }

  const pagesToFetch = Math.min(totalPages, maxPages);
  const remainingPages = Array.from(
    { length: pagesToFetch - 1 },
    (_, i) => i + 2,
  );

  const results = await Promise.all(
    remainingPages.map(async (p) => {
      try {
        const res = await callScriptBlox(`/comment/${clean}?page=${p}`);
        return res.data?.result?.comments || [];
      } catch {
        return [];
      }
    }),
  );

  const allComments = [...initialComments, ...results.flat()];
  return {
    totalPages,
    comments: allComments,
    totalCount: allComments.length,
  };
}

/**
 * Fetches changelog history for a script.
 *
 * @param {string} scriptId
 * @returns {Promise<Array>}
 */
export async function fetchScriptChangelog(scriptId) {
  if (!scriptId) return [];
  const clean = encodeURIComponent(normalizeSlug(scriptId));
  const res = await callScriptBlox(`/script/changelog/${clean}`);
  return Array.isArray(res.data?.history) ? res.data.history : [];
}

/**
 * Fetches supported games list for a universal script.
 *
 * @param {string} scriptId
 * @returns {Promise<Array>}
 */
export async function fetchScriptSupportedGames(scriptId) {
  if (!scriptId) return [];
  const clean = encodeURIComponent(normalizeSlug(scriptId));
  const res = await callScriptBlox(`/script/games/${clean}`);
  if (res.ok && Array.isArray(res.data?.games)) {
    return res.data.games.map((g) => {
      const pid = Number(g.gameId || g.placeId || 0);
      return {
        _id: g._id || undefined,
        gameId: pid,
        placeId: pid,
        name: g.name || "Roblox Game",
        imageUrl: g.imageUrl || "",
      };
    });
  }
  return [];
}

/**
 * Fetches game summary by placeId or game slug.
 *
 * @param {string|number} placeIdOrSlug
 * @returns {Promise<Object|null>}
 */
export async function fetchGameSummary(placeIdOrSlug) {
  if (!placeIdOrSlug) return null;
  const clean = encodeURIComponent(normalizeSlug(String(placeIdOrSlug)));
  const res = await callScriptBlox(`/game/${clean}`);
  return res.ok && res.data ? res.data : null;
}

/**
 * Fetches scripts for a specific placeId with pagination.
 *
 * @param {string|number} placeId
 * @param {number} [page=1]
 * @param {number} [max=20]
 * @returns {Promise<{ totalPages: number, nextPage?: number, max: number, scripts: Array }>}
 */
export async function fetchGameScripts(placeId, page = 1, max = 20) {
  return fetchScripts({ placeId: String(placeId), page, max });
}
