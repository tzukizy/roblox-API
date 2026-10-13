import fs from "node:fs";
import path from "node:path";
import { CDN_CONFIG, PATHS, USER_AGENTS } from "../config.js";
import { resolveScriptImageUrl, normalizeRobloxThumb } from "./helpers.js";

// In-memory persistent cache: cacheKey (e.g. "raw::https://..." or "script::https://...") -> full CDN URL
const cdnCache = new Map();
let cacheLoaded = false;
let saveScheduled = false;

/**
 * Loads cached CDN image mappings from .cache/cdn-images.json.
 */
export function loadCdnCache() {
  if (cacheLoaded) return cdnCache.size;
  cacheLoaded = true;

  try {
    if (fs.existsSync(PATHS.cdnCache)) {
      const raw = fs.readFileSync(PATHS.cdnCache, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key === "string" && typeof value === "string") {
            cdnCache.set(key, value);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[CDN Cache] Failed to load cache from ${PATHS.cdnCache}: ${err.message}`);
  }

  return cdnCache.size;
}

/**
 * Persists cached CDN image mappings to disk.
 */
export function saveCdnCache() {
  try {
    const dir = path.dirname(PATHS.cdnCache);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(cdnCache.entries());
    const tempPath = `${PATHS.cdnCache}.tmp-${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tempPath, PATHS.cdnCache);
  } catch (err) {
    console.warn(`[CDN Cache] Failed to save cache: ${err.message}`);
  }
}

/**
 * Schedules a debounced disk save of the CDN cache.
 */
function scheduleCacheSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  setTimeout(() => {
    saveScheduled = false;
    saveCdnCache();
  }, 1000).unref?.();
}

if (typeof process !== "undefined") {
  process.on("beforeExit", () => {
    saveCdnCache();
  });
}

/**
 * Probes a remote image URL using HTTP HEAD to verify reachability.
 *
 * @param {string} url
 * @param {number} [timeoutMs=3500]
 * @returns {Promise<boolean>}
 */
export async function isUrlReachable(url, timeoutMs = 3500) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed || !trimmed.startsWith("http")) return false;

  try {
    const res = await fetch(trimmed, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENTS.browser },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) return true;

    // Fallback: If 405 Method Not Allowed, try GET with range header
    if (res.status === 405) {
      const getRes = await fetch(trimmed, {
        method: "GET",
        headers: {
          Range: "bytes=0-0",
          "User-Agent": USER_AGENTS.browser,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return getRes.ok || getRes.status === 206;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves an image through the KocakZ CDN.
 * 1. Checks memory & disk cache.
 * 2. Ingests via POST /api/image on cache miss.
 * 3. Returns full public CDN URL (https://cdn.kocakz.me/images/[hash].webp).
 *
 * @param {string} rawUrl
 * @param {Object} [options]
 * @param {boolean} [options.process=false]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<string|null>}
 */
export async function resolveCdnImage(rawUrl, { process = false, timeoutMs = 15000 } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  loadCdnCache();

  let targetUrl = rawUrl.trim();
  if (targetUrl.startsWith("//")) {
    targetUrl = `https:${targetUrl}`;
  } else if (targetUrl.startsWith("/")) {
    targetUrl = resolveScriptImageUrl(targetUrl);
  }

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return null;
  }

  // Normalize Roblox thumbs to 150/150 for consistency
  if (targetUrl.includes("tr.rbxcdn.com")) {
    targetUrl = normalizeRobloxThumb(targetUrl);
  }

  const cacheKey = `${process ? "script" : "raw"}::${targetUrl}`;
  if (cdnCache.has(cacheKey)) {
    return cdnCache.get(cacheKey);
  }

  const baseUrl = CDN_CONFIG.baseUrl;
  const apiKey = CDN_CONFIG.apiKey;

  try {
    const res = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { key: apiKey } : {}),
      },
      body: JSON.stringify({
        url: targetUrl,
        process: Boolean(process),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    if (!json?.success) {
      return null;
    }

    const filename = json.data?.image?.filename;
    let fullCdnUrl = "";

    if (filename) {
      fullCdnUrl = `${baseUrl}/images/${filename}`;
    } else if (json.data?.image?.url) {
      fullCdnUrl = json.data.image.url;
    } else if (json.data?.url) {
      fullCdnUrl = json.data.url;
    }

    if (fullCdnUrl) {
      cdnCache.set(cacheKey, fullCdnUrl);
      scheduleCacheSave();
      return fullCdnUrl;
    }
  } catch (err) {
    // Network or processing error
  }

  return null;
}

/**
 * Resolves a game thumbnail from an ordered list of candidate URLs.
 * Checks reachability via HTTP HEAD.
 * Uploads the first reachable candidate with process: false.
 * Returns https://cdn.kocakz.me/images/[hash].webp or falls back to no-game.webp.
 *
 * @param {string[]|string} candidateUrls
 * @returns {Promise<string>}
 */
export async function resolveGameThumbnail(candidateUrls) {
  loadCdnCache();

  const candidates = (Array.isArray(candidateUrls) ? candidateUrls : [candidateUrls])
    .filter((u) => u && typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => {
      if (!u) return false;
      if (
        u.includes("no-game") ||
        u.includes("no-script") ||
        u.includes("no-profile") ||
        u.includes("user-default")
      ) {
        return false;
      }
      if (u === "/brand/kocakz-logo.png" || u.endsWith("/brand/kocakz-logo.png")) return false;
      return true;
    });

  // 1. Fast path: check if any candidate is already in cache
  for (const candidate of candidates) {
    let normalized = candidate;
    if (normalized.includes("tr.rbxcdn.com")) {
      normalized = normalizeRobloxThumb(normalized);
    }
    const cacheKey = `raw::${normalized}`;
    if (cdnCache.has(cacheKey)) {
      return cdnCache.get(cacheKey);
    }
  }

  // 2. Probe candidates in priority order using HTTP HEAD
  for (const candidate of candidates) {
    let target = candidate;
    if (target.includes("tr.rbxcdn.com")) {
      target = normalizeRobloxThumb(target);
    }

    const reachable = await isUrlReachable(target);
    if (reachable) {
      const cdnUrl = await resolveCdnImage(target, { process: false });
      if (cdnUrl) {
        return cdnUrl;
      }
    }
  }

  // 3. Fallback when all candidates error
  return CDN_CONFIG.fallbacks.game;
}

/**
 * Resolves a script thumbnail.
 * If url includes "no-script" (any extension) or is missing, returns CDN fallback.
 * Otherwise uploads with process: true.
 *
 * @param {string|null} imageUrl
 * @returns {Promise<string>}
 */
export async function resolveScriptThumbnail(imageUrl) {
  loadCdnCache();

  if (!imageUrl || typeof imageUrl !== "string") {
    return CDN_CONFIG.fallbacks.script;
  }

  const trimmed = imageUrl.trim();
  if (
    !trimmed ||
    trimmed.includes("no-script") ||
    trimmed.includes("/brand/kocakz-logo.png")
  ) {
    return CDN_CONFIG.fallbacks.script;
  }

  const absoluteUrl = resolveScriptImageUrl(trimmed);
  const cacheKey = `script::${absoluteUrl}`;
  if (cdnCache.has(cacheKey)) {
    return cdnCache.get(cacheKey);
  }

  const cdnUrl = await resolveCdnImage(absoluteUrl, { process: true });
  return cdnUrl || CDN_CONFIG.fallbacks.script;
}

/**
 * Resolves an avatar image.
 * If url includes "user-default" (any extension: .png, .webp) or "no-profile" or is missing,
 * returns CDN fallback (https://cdn.kocakz.me/images/no-profile.webp).
 * Otherwise uploads with process: false (160x160 WebP 90).
 *
 * @param {string|null} avatarUrl
 * @returns {Promise<string>}
 */
export async function resolveAvatarThumbnail(avatarUrl) {
  loadCdnCache();

  if (!avatarUrl || typeof avatarUrl !== "string") {
    return CDN_CONFIG.fallbacks.profile;
  }

  const trimmed = avatarUrl.trim();
  if (
    !trimmed ||
    trimmed.includes("user-default") ||
    trimmed.includes("no-profile") ||
    trimmed.includes("/brand/kocakz-logo.png")
  ) {
    return CDN_CONFIG.fallbacks.profile;
  }

  const absoluteUrl = resolveScriptImageUrl(trimmed);
  const cacheKey = `raw::${absoluteUrl}`;
  if (cdnCache.has(cacheKey)) {
    return cdnCache.get(cacheKey);
  }

  const cdnUrl = await resolveCdnImage(absoluteUrl, { process: false });
  return cdnUrl || CDN_CONFIG.fallbacks.profile;
}
