import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CDN_CONFIG } from "../config.js";
import { resolveGameThumbnail } from "./cdn.js";

/**
 * Normalizes a Roblox CDN image URL to 150x150 resolution.
 * @param {string} url
 * @returns {string}
 */
export function normalizeRobloxThumb(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  return trimmed.replace(
    /^(https:\/\/tr\.rbxcdn\.com\/[^/]+\/)\d+\/\d+(\/.*)$/,
    "$1150/150$2",
  );
}

/**
 * Builds game thumbnail array in exact order:
 * ["roblox api thumb", "rolimons api thumb", "scriptblox api thumb", "fallback"]
 * With Roblox CDN thumbnail resized to 150/150.
 *
 * @param {Object} params
 * @param {string|null} [params.robloxThumb]
 * @param {string|null} [params.rolimonsThumb]
 * @param {string|null} [params.scriptbloxThumb]
 * @param {string} [params.fallback]
 * @returns {string[]}
 */
export function buildGameThumbnails({
  robloxThumb,
  rolimonsThumb,
  scriptbloxThumb,
  fallback = CDN_CONFIG?.fallbacks?.game || "https://media.kocakz.me/no-game.webp",
} = {}) {
  const list = [];

  // 1. Roblox API thumbnail
  if (robloxThumb && typeof robloxThumb === "string" && robloxThumb.trim()) {
    list.push(normalizeRobloxThumb(robloxThumb));
  }

  // 2. Rolimons thumbnail
  if (
    rolimonsThumb &&
    typeof rolimonsThumb === "string" &&
    rolimonsThumb.trim()
  ) {
    const raw = rolimonsThumb.trim();
    const png = raw.includes("/Image/Webp/")
      ? raw.replace("/Image/Webp/", "/Image/Png/")
      : raw;
    list.push(png);
  }

  // 3. ScriptBlox thumbnail
  if (
    scriptbloxThumb &&
    typeof scriptbloxThumb === "string" &&
    scriptbloxThumb.trim()
  ) {
    const resolved = resolveScriptImageUrl(scriptbloxThumb.trim());
    if (
      resolved &&
      resolved !== "/brand/kocakz-logo.png" &&
      resolved !== "/images/no-script.webp"
    ) {
      list.push(normalizeRobloxThumb(resolved));
    }
  }

  // 4. Fallback
  if (fallback) {
    list.push(fallback);
  }

  return Array.from(new Set(list.filter(Boolean)));
}


/**
 * Formats game path and slug according to WebAuth and ScriptBlox conventions.
 *
 * @param {Object} params
 * @param {number|string} params.placeId
 * @param {string} params.name
 * @param {string} [params.scriptbloxPath]
 * @param {string} [params.canonicalUrlPath]
 * @returns {{ path: string, slug: string }}
 */
export function formatGamePathAndSlug({
  placeId,
  name,
  scriptbloxPath,
  canonicalUrlPath,
}) {
  let path = "";
  if (
    scriptbloxPath &&
    typeof scriptbloxPath === "string" &&
    scriptbloxPath.trim()
  ) {
    path = scriptbloxPath.trim();
  } else if (
    canonicalUrlPath &&
    typeof canonicalUrlPath === "string" &&
    canonicalUrlPath.trim()
  ) {
    path = canonicalUrlPath
      .trim()
      .replace(
        /^\/games\/(\d+)\/(.+)$/,
        (_, id, slug) => `/game/${id}-${slug.toLowerCase()}`,
      );
  } else {
    const fallbackSlug = getScriptGameSlug(placeId, name);
    path = `/game/${fallbackSlug}`;
  }

  const slug = path.split("/").filter(Boolean).pop() || `${placeId}`;
  return { path, slug };
}

/**
 * Constructs a fully unified Game entity combining Rolimons, Roblox, and ScriptBlox data.
 *
 * @param {Object} params
 * @param {Object} [params.rolimons]
 * @param {Object|null} [params.roblox]
 * @param {Object|null} [params.scriptblox]
 * @param {string|null} [params.thumbnail]
 * @param {string} [params.fallback]
 * @returns {Promise<Object>}
 */
export async function buildUnifiedGame({
  rolimons = {},
  roblox = null,
  scriptblox = null,
  thumbnail = null,
  fallback = null,
}) {
  const placeId = Number(
    rolimons.placeId || roblox?.placeId || scriptblox?.game?.gameId || 0,
  );
  const name =
    scriptblox?.game?.name ||
    roblox?.name ||
    rolimons?.name ||
    `Game #${placeId}`;
  const desc = roblox?.description || "";

  const { path, slug } = formatGamePathAndSlug({
    placeId,
    name,
    scriptbloxPath: scriptblox?.path,
    canonicalUrlPath: roblox?.canonicalUrlPath,
  });

  let resolvedThumbnail = thumbnail;
  if (
    !resolvedThumbnail ||
    typeof resolvedThumbnail !== "object" ||
    !resolvedThumbnail.url
  ) {
    if (typeof resolvedThumbnail === "string") {
      resolvedThumbnail = { url: resolvedThumbnail, original: null };
    } else {
      const candidateUrls = buildGameThumbnails({
        robloxThumb: roblox?.iconUrl || rolimons?.robloxIcon,
        rolimonsThumb: rolimons?.rolimonsThumb,
        scriptbloxThumb: scriptblox?.game?.imageUrl,
        fallback:
          fallback ||
          CDN_CONFIG?.fallbacks?.game ||
          "https://media.kocakz.me/no-game.webp",
      });
      resolvedThumbnail = await resolveGameThumbnail(candidateUrls);
    }
  }

  const playing =
    typeof rolimons?.totalPlayers === "number" && rolimons.totalPlayers >= 0
      ? rolimons.totalPlayers
      : typeof roblox?.playing === "number"
        ? roblox.playing
        : 0;

  const visitor = typeof roblox?.visits === "number" ? roblox.visits : 0;
  const verified = Boolean(scriptblox?.game?.verified);
  const updatedAt = scriptblox?.updatedAt || roblox?.updated || null;

  const creator = {
    name: roblox?.creator?.name || "Roblox",
    type: roblox?.creator?.type || "User",
  };

  const script = {
    count: scriptblox?.count || 0,
    freeCount: scriptblox?.freeCount || 0,
    keyCount: scriptblox?.keyCount || 0,
    verifiedCount: scriptblox?.verifiedCount || 0,
  };

  return {
    id: placeId,
    name,
    desc,
    path,
    slug,
    thumbnail: resolvedThumbnail,
    playing,
    visitor,
    verified,
    updatedAt,
    creator,
    script,
  };
}

/**
 * Builds canonical slug for a game matching WebAuth URL conventions.
 * Example: (2753915549, "Blox Fruits") -> "2753915549-blox-fruits"
 */
/**
 * Cleans a game name for human-readable SEO presentation by stripping
 * empty brackets, bracketed event prefixes, emojis, and seasonal tags.
 */
export function cleanGameTitle(gameName) {
  if (!gameName || typeof gameName !== "string") return "";
  const raw = gameName.trim();
  const stripped = raw
    .replace(/\[\s*\]/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/^[\s\-–—:|/]+|[\s\-–—:|/]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) {
    const fallback = raw.replace(/[\[\]\(\)]/g, "").trim();
    return fallback || raw;
  }

  return stripped;
}

export function getScriptGameSlug(gameId, gameName) {
  const rawName = (gameName || "").trim();
  const effectiveName = cleanGameTitle(rawName) || rawName;

  const cleanName = effectiveName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const isUniversalName =
    !cleanName ||
    cleanName === "universal" ||
    cleanName === "universal-script" ||
    cleanName === "script-hub" ||
    cleanName === "game";

  if (gameId && gameId > 0) {
    return `${gameId}${cleanName && !isUniversalName ? `-${cleanName}` : ""}`;
  }

  if (isUniversalName) {
    return "universal";
  }

  return cleanName;
}

/**
 * Normalizes script image URL to full absolute URL.
 */
export function resolveScriptImageUrl(url) {
  if (!url || typeof url !== "string") {
    return "/brand/kocakz-logo.png";
  }
  const trimmed = url.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("/brand/") ||
    trimmed.startsWith("/icons/") ||
    trimmed.startsWith("/images/blog/")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `https://scriptblox.com${trimmed}`;
  }
  return `https://scriptblox.com/${trimmed}`;
}

/**
 * Safely decodes and normalizes a slug.
 */
export function normalizeSlug(slugOrId) {
  if (!slugOrId || typeof slugOrId !== "string") return "";
  let current = slugOrId.trim();
  try {
    current = decodeURIComponent(current);
  } catch {}
  return current.trim();
}

/**
 * Converts a script slug into a deterministic fixed-length (64-char) SHA-256 hex string.
 * This guarantees 100% filesystem safety (only 0-9 and a-f), eliminates special character
 * issues (like *), and prevents MAX_PATH issues.
 *
 * @param {string} slug
 * @returns {string} 64-character lowercase hex string
 */
export function slugToHash(slug) {
  if (!slug || typeof slug !== "string") return "";
  const normalized = normalizeSlug(slug);
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Sanitizes a slug or identifier for safe file storage across all operating systems.
 *
 * Windows forbids characters: \ / : * ? " < > |
 * While encodeURIComponent encodes \ / : ? " < > |, it preserves `*`.
 * We encode `*` as `%2A` and trim forbidden trailing dots/spaces to ensure NTFS compatibility.
 *
 * @param {string} name
 * @returns {string}
 */
export function toSafeFilename(name) {
  if (!name || typeof name !== "string") return "";
  const normalized = normalizeSlug(name);
  if (!normalized) return "";

  let safe = encodeURIComponent(normalized);
  // encodeURIComponent keeps '*' which is illegal on Windows / git on Windows
  safe = safe.replace(/\*/g, "%2A");
  // Remove trailing dots or spaces which Windows filesystem strips or rejects
  safe = safe.replace(/[. ]+$/, "");

  // Prevent Windows MAX_PATH overflow if slug is excessively long
  if (safe.length > 160) {
    safe = safe.slice(0, 160);
  }

  return safe;
}

/**
 * Ensures directory exists recursively.
 */
export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Writes data as formatted JSON atomically.
 * Uses a short temporary filename in the target directory to avoid MAX_PATH issues.
 */
export async function writeJsonFile(filePath, data, pretty = false) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tempPath = path.join(
    dir,
    `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await fs.writeFile(tempPath, content, "utf-8");
  await fs.rename(tempPath, filePath);
}

/**
 * Paginates an array of games matching WebAuth PaginatedGamesResult.
 * Ensures games are sorted by totalPlayers descending (matching WebAuth).
 *
 * @param {Array} games
 * @param {number} [pageSize=24]
 * @returns {{
 *   sorted: Array,
 *   totalGames: number,
 *   totalPages: number,
 *   pages: Array<{ games: Array, totalGames: number, totalPages: number, currentPage: number }>,
 *   page1: { games: Array, totalGames: number, totalPages: number, currentPage: number }
 * }}
 */
export function paginateGames(games = [], pageSize = 24) {
  const sorted = [...games].sort((a, b) => {
    const playA = a.playing ?? a.totalPlayers ?? 0;
    const playB = b.playing ?? b.totalPlayers ?? 0;
    return playB - playA;
  });
  const totalGames = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalGames / pageSize));

  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    const offset = (p - 1) * pageSize;
    const pageSlice = sorted.slice(offset, offset + pageSize);
    pages.push({
      games: pageSlice,
      totalGames,
      totalPages,
      currentPage: p,
    });
  }

  return {
    sorted,
    totalGames,
    totalPages,
    pages,
    page1: pages[0] || {
      games: [],
      totalGames: 0,
      totalPages: 1,
      currentPage: 1,
    },
  };
}
