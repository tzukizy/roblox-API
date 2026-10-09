/**
 * Test scrape runner with limited pages and catalog size.
 * Safe for quick local testing without consuming excessive API rate limits.
 */
process.env.MAX_PAGES = process.env.MAX_PAGES || "2";
process.env.MAX_CATALOG_GAMES = process.env.MAX_CATALOG_GAMES || "48";
process.env.MAX_KEYLESS_PAGES = process.env.MAX_KEYLESS_PAGES || "1";
process.env.MAX_UNIVERSAL_PAGES = process.env.MAX_UNIVERSAL_PAGES || "1";
process.env.MAX_ROBLOX_DETAILS = process.env.MAX_ROBLOX_DETAILS || "50";
process.env.MAX_GAME_SCRIPT_PAGES = process.env.MAX_GAME_SCRIPT_PAGES || "1";

// Dynamically import index.js after env variables are set so config.js picks them up
const { runScraper } = await import("./index.js");

// Explicitly execute runScraper
runScraper().catch((err) => {
  console.error("Fatal scraping error:", err);
  process.exit(1);
});
