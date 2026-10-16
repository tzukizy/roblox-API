import fs from "node:fs";
import { CDN_CONFIG, PATHS } from "../config.js";

/**
 * Migrates cached image URLs in .cache/cdn-images.json from
 * legacy cdn.kocakz.me/images/ to media.kocakz.me/
 */
export function migrateCacheFile(cacheFilePath = PATHS.cdnCache) {
  if (!fs.existsSync(cacheFilePath)) {
    console.log(`[Migrate Cache] Cache file not found at ${cacheFilePath}. Nothing to migrate.`);
    return { total: 0, migrated: 0 };
  }

  let cache;
  try {
    const raw = fs.readFileSync(cacheFilePath, "utf-8");
    cache = JSON.parse(raw);
  } catch (err) {
    console.error(`[Migrate Cache] Failed to parse cache file: ${err.message}`);
    return { total: 0, migrated: 0, error: err.message };
  }

  if (!cache || typeof cache !== "object") {
    console.log(`[Migrate Cache] Cache file is not a valid object.`);
    return { total: 0, migrated: 0 };
  }

  const mediaUrl = CDN_CONFIG.mediaUrl || "https://media.kocakz.me";
  let migratedCount = 0;
  const totalCount = Object.keys(cache).length;
  const updatedCache = {};

  for (const [key, val] of Object.entries(cache)) {
    if (typeof val === "string") {
      let updatedVal = val;
      if (
        updatedVal.includes("cdn.kocakz.me") ||
        updatedVal.includes("media.kocakz.me/images/")
      ) {
        updatedVal = updatedVal
          .replace(/^https?:\/\/cdn\.kocakz\.me\/images\//, `${mediaUrl}/`)
          .replace(/^https?:\/\/cdn\.kocakz\.me\//, `${mediaUrl}/`)
          .replace(/^https?:\/\/media\.kocakz\.me\/images\//, `${mediaUrl}/`);
        migratedCount++;
      }
      updatedCache[key] = updatedVal;
    } else {
      updatedCache[key] = val;
    }
  }

  if (migratedCount > 0) {
    fs.writeFileSync(cacheFilePath, JSON.stringify(updatedCache, null, 2), "utf-8");
    console.log(`[Migrate Cache] Successfully migrated ${migratedCount} of ${totalCount} entries to ${mediaUrl}/`);
  } else {
    console.log(`[Migrate Cache] All ${totalCount} entries are already using media.kocakz.me/`);
  }

  return { total: totalCount, migrated: migratedCount };
}

// Execute directly if run as main script
const isMain = process.argv[1] && process.argv[1].endsWith("migrate-cache.js");
if (isMain) {
  migrateCacheFile();
}
