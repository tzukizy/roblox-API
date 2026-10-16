import path from "node:path";
import { fileURLToPath } from "node:url";

import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.resolve(ROOT_DIR, "data");
export const CACHE_DIR = path.resolve(ROOT_DIR, ".cache");

// Automatically load .env if present
try {
  const envPath = path.resolve(ROOT_DIR, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (_) {}

export const PATHS = {
  data: DATA_DIR,
  cache: CACHE_DIR,
  cdnCache: path.resolve(CACHE_DIR, "cdn-images.json"),
  home: path.resolve(DATA_DIR, "home"),
  homeLatest: path.resolve(DATA_DIR, "home", "latest"),
  script: path.resolve(DATA_DIR, "script"),
  game: path.resolve(DATA_DIR, "game"),
  gamePages: path.resolve(DATA_DIR, "game", "games"),
  gameUniversal: path.resolve(DATA_DIR, "game", "universal"),
  trending: path.resolve(DATA_DIR, "trending"),
  keyless: path.resolve(DATA_DIR, "keyless"),
  keylessPages: path.resolve(DATA_DIR, "keyless", "pages"),
  universal: path.resolve(DATA_DIR, "universal"),
  executor: path.resolve(DATA_DIR, "executor"),
};

export const CDN_CONFIG = {
  baseUrl: (process.env.CDN_URL || "https://cdn.kocakz.me").replace(/\/+$/, ""),
  mediaUrl: (process.env.MEDIA_URL || "https://media.kocakz.me").replace(/\/+$/, ""),
  apiKey: process.env.CDN_API_KEY || "",
  fallbacks: {
    game: `${(process.env.MEDIA_URL || "https://media.kocakz.me").replace(/\/+$/, "")}/no-game.webp`,
    script: `${(process.env.MEDIA_URL || "https://media.kocakz.me").replace(/\/+$/, "")}/no-script.webp`,
    profile: `${(process.env.MEDIA_URL || "https://media.kocakz.me").replace(/\/+$/, "")}/no-profile.webp`,
  },
};

export const API_URLS = {
  rolimons: {
    gamelist: "https://api.rolimons.com/games/v1/gamelist",
  },
  roblox: {
    placeUniverse: (placeId) =>
      `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
    gameDetails: (universeIds) =>
      `https://games.roblox.com/v1/games?universeIds=${Array.isArray(universeIds) ? universeIds.join(",") : universeIds}`,
    placeIcons: (placeIds) =>
      `https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${Array.isArray(placeIds) ? placeIds.join(",") : placeIds}&size=128x128&format=Png&isCircular=false`,
    gameIcons: (universeIds) =>
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${Array.isArray(universeIds) ? universeIds.join(",") : universeIds}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`,
  },
  scriptblox: {
    base: "https://scriptblox.com/api",
  },
};

export const USER_AGENTS = {
  browser:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  roblox: "Roblox/WinInet (KocakZ-RobloxResolver/1.0)",
  scriptblox: "KocakZ-ScriptDirectory/1.0 (Scraper; +https://kocakz.me)",
};

export const SCRAPE_LIMITS = {
  trendingGames: 48,
  topGamesWithRobloxDetails: 240,
  catalogGames: Number(process.env.MAX_CATALOG_GAMES) || Infinity, // Uncapped: all 7,000+ games from Rolimons
  gamePageSize: 24, // Exactly 24 games per page (matching WebAuth)
  // Sitemaps discover ~73,700 scripts (3,686 pages). Uncapped by default unless MAX_PAGES is explicitly set.
  latestScriptPages: process.env.MAX_PAGES
    ? Number(process.env.MAX_PAGES)
    : Infinity,
  // Uncapped by default: fetches all available pages reported by upstream API
  keylessScriptPages: process.env.MAX_KEYLESS_PAGES
    ? Number(process.env.MAX_KEYLESS_PAGES)
    : Infinity,
  universalScriptPages: process.env.MAX_UNIVERSAL_PAGES
    ? Number(process.env.MAX_UNIVERSAL_PAGES)
    : Infinity,
  maxCommentPages: process.env.MAX_COMMENT_PAGES
    ? Number(process.env.MAX_COMMENT_PAGES)
    : Infinity,
};

export const RATE_LIMITS = {
  robloxChunkSize: 50, // Batch limit for Roblox thumbnails API
  requestTimeoutMs: 12000,
};
