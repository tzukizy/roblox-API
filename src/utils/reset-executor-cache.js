import fs from "node:fs";
import { PATHS } from "../config.js";

/**
 * Resets / removes cached executor thumbnail entries from .cache/cdn-images.json
 * so that subsequent scrape runs generate fresh executor thumbnails using the
 * 16:9 banner canvas, centered logo, background color sampling, watermark, and metadata.
 *
 * @param {string} [cacheFilePath=PATHS.cdnCache]
 * @returns {{ total: number, removed: number, remaining: number, error?: string }}
 */
export function resetExecutorCache(cacheFilePath = PATHS.cdnCache) {
  if (!fs.existsSync(cacheFilePath)) {
    console.log(
      `[Reset Executor Cache] Cache file not found at ${cacheFilePath}. Nothing to clear.`,
    );
    return { total: 0, removed: 0, remaining: 0 };
  }

  let cache;
  try {
    const raw = fs.readFileSync(cacheFilePath, "utf-8");
    cache = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[Reset Executor Cache] Failed to parse cache file: ${err.message}`,
    );
    return { total: 0, removed: 0, remaining: 0, error: err.message };
  }

  if (!cache || typeof cache !== "object") {
    console.log(`[Reset Executor Cache] Cache file is not a valid JSON object.`);
    return { total: 0, removed: 0, remaining: 0 };
  }

  const totalCount = Object.keys(cache).length;
  const updatedCache = {};
  let removedCount = 0;

  for (const [key, val] of Object.entries(cache)) {
    const isExecutorEntry =
      typeof key === "string" &&
      (key.startsWith("executor::") ||
        key.includes("/exec/") ||
        key.includes("/images/exec/") ||
        key.includes("cdn.weao.gg"));

    if (isExecutorEntry) {
      removedCount++;
    } else {
      updatedCache[key] = val;
    }
  }

  try {
    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify(updatedCache, null, 2),
      "utf-8",
    );
    console.log(
      `[Reset Executor Cache] Successfully purged ${removedCount} executor thumbnail entries. Retained ${
        Object.keys(updatedCache).length
      } of ${totalCount} entries.`,
    );
  } catch (err) {
    console.error(
      `[Reset Executor Cache] Failed to write updated cache file: ${err.message}`,
    );
    return { total: totalCount, removed: removedCount, remaining: totalCount, error: err.message };
  }

  return {
    total: totalCount,
    removed: removedCount,
    remaining: Object.keys(updatedCache).length,
  };
}

const isMain =
  process.argv[1] && process.argv[1].endsWith("reset-executor-cache.js");
if (isMain) {
  resetExecutorCache();
}
