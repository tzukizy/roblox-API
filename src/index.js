import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS, SCRAPE_LIMITS, CDN_CONFIG } from "./config.js";
import {
  ensureDir,
  writeJsonFile,
  buildUnifiedGame,
  toSafeFilename,
  slugToHash,
  paginateGames,
  getScriptGameSlug,
  cleanGameTitle,
} from "./utils/helpers.js";
import {
  resolveScriptThumbnail,
  resolveAvatarThumbnail,
  resolveGameThumbnail,
  saveCdnCache,
} from "./utils/cdn.js";
import { scrapeRolimonsGameList } from "./scrapers/rolimons.js";
import {
  fetchRobloxPlaceIcons,
  fetchRobloxGamesBatch,
  savePlaceToUniverseCache,
} from "./scrapers/roblox.js";
import {
  fetchScripts,
  fetchScriptDetails,
  fetchGameSummary,
  fetchGameScripts,
  fetchLeaderboard,
  fetchExecutors,
  fetchAllComments,
  fetchScriptChangelog,
  fetchScriptSupportedGames,
  scrapeScriptBloxScriptSitemaps,
} from "./scrapers/scriptblox.js";

/**
 * Main scraping pipeline
 *
 * Output layout:
 * - Home: /data/home/trending.json, /data/home/topscript.json, /data/home/latest.json, /data/home/latest/[page].json
 * - Scripts: /data/script/[hash].json
 * - Games: /data/game/games.json, /data/game/games/[page].json
 * - Game Details: /data/game/[id].json, /data/game/[id]/[page].json
 * - Trending: /data/trending/[period].json
 * - Keyless: /data/keyless/scripts.json, /data/keyless/pages/[page].json
 * - Verified: /data/verified/scripts.json, /data/verified/pages/[page].json
 * - Unpatched: /data/unpatched/scripts.json, /data/unpatched/pages/[page].json
 * - Universal: /data/universal/scripts.json
 * - Executors: /data/executor/executors.json, /data/executor/[name].json
 */
export async function runScraper() {
  const startTime = Date.now();
  console.log("==================================================");
  console.log("Starting Complete Roblox & ScriptBlox Data Scraper");
  console.log(`Execution started at: ${new Date().toISOString()}`);
  console.log(
    `Max script pages target: ${
      Number.isFinite(SCRAPE_LIMITS.latestScriptPages)
        ? SCRAPE_LIMITS.latestScriptPages
        : "All (~3,686 pages from sitemaps)"
    }`,
  );
  console.log("==================================================\n");

  // Ensure all output directories exist
  await Promise.all([
    ensureDir(PATHS.data),
    ensureDir(PATHS.home),
    ensureDir(PATHS.homeLatest),
    ensureDir(PATHS.script),
    ensureDir(PATHS.game),
    ensureDir(PATHS.gamePages),
    ensureDir(PATHS.gameUniversal),
    ensureDir(PATHS.trending),
    ensureDir(PATHS.keyless),
    ensureDir(PATHS.keylessPages),
    ensureDir(PATHS.verified),
    ensureDir(PATHS.verifiedPages),
    ensureDir(PATHS.unpatched),
    ensureDir(PATHS.unpatchedPages),
    ensureDir(PATHS.universal),
    ensureDir(PATHS.executor),
  ]);

  const stats = {
    gamesScraped: 0,
    gamePagesCreated: 0,
    gameDetailsCreated: 0,
    gameScriptPagesCreated: 0,
    scriptsScraped: 0,
    individualScriptsSaved: 0,
    executorsScraped: 0,
    leaderboardsScraped: 0,
    latestPagesScraped: 0,
  };

  // ----------------------------------------------------
  // 1. ROLIMONS + ROBLOX ICONS
  // ----------------------------------------------------
  console.log(
    "[1/6] Scraping Rolimons Game Catalog & Batching Roblox Place Icons...",
  );
  const rawRolimonsGames = await scrapeRolimonsGameList();
  const catalogSlice = Number.isFinite(SCRAPE_LIMITS.catalogGames)
    ? rawRolimonsGames.slice(0, SCRAPE_LIMITS.catalogGames)
    : rawRolimonsGames;

  // Build name index for matching trending game names: cleanName -> placeId
  const rolimonsNameIndex = new Map();
  const rolimonsMap = new Map();
  for (const g of rawRolimonsGames) {
    rolimonsMap.set(g.placeId, g);
    const clean = g.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (clean) rolimonsNameIndex.set(clean, g.placeId);
  }

  // Batch fetch Roblox live icons for all catalog games (paced safely under 60 req/min)
  const allCatalogPlaceIds = catalogSlice.map((g) => g.placeId);
  console.log(
    `-> Batch fetching Roblox place icons for ${allCatalogPlaceIds.length} catalog games (paced safely)...`,
  );
  const rolimonsPlaceIcons = await fetchRobloxPlaceIcons(allCatalogPlaceIds);

  // In-memory script details deduplication cache to prevent redundant HTTP calls
  const scriptDetailsCache = new Map();

  async function getCompleteScript(scriptSummary) {
    if (!scriptSummary) return null;
    const slug = scriptSummary.slug || scriptSummary._id;
    if (!slug) return scriptSummary;

    if (scriptDetailsCache.has(slug)) {
      return scriptDetailsCache.get(slug);
    }

    try {
      const detailed = await fetchScriptDetails(slug);
      if (!detailed) {
        throw new Error(`fetchScriptDetails returned null for ${slug}`);
      }
      const base = { ...scriptSummary, ...detailed };

      // Detect Universal or Hub scripts (gameId <= 0 or isUniversal/isHub)
      const isHubOrUniversal =
        base.isUniversal ||
        base.isHub ||
        base.game?.gameId === -1 ||
        base.game?.gameId === 0 ||
        scriptSummary.isUniversal ||
        scriptSummary.isHub ||
        scriptSummary.game?.gameId === -1 ||
        scriptSummary.game?.gameId === 0;

      let supportedGames = [];
      let finalPlaceId = 0;
      let changelog = [];
      let comments = [];

      // Fetch changelog & comments for script offline render
      const scriptId = base._id || scriptSummary._id;
      if (scriptId) {
        try {
          const [clRes, comRes] = await Promise.all([
            fetchScriptChangelog(scriptId).catch(() => []),
            fetchAllComments(scriptId, SCRAPE_LIMITS.maxCommentPages).catch(
              () => ({ comments: [] }),
            ),
          ]);
          changelog = clRes || [];
          comments = comRes?.comments || [];
        } catch {
          // Non-fatal if changelog or comments fail
        }
      }

      if (isHubOrUniversal) {
        finalPlaceId = 0;
        base.isUniversal = true;
        if (scriptId) {
          supportedGames = await fetchScriptSupportedGames(scriptId);
        }
        base.isHub = Boolean(
          base.isHub ||
          base.game?.gameId === -1 ||
          scriptSummary.game?.gameId === -1 ||
          (supportedGames && supportedGames.length > 0),
        );
        base.supportedGames = supportedGames;
      } else {
        // Resolve placeId for game-specific scripts
        // fetchScriptDetails returns detailed.game.gameId directly from ScriptBlox!
        let pid = base.game?.gameId || base.game?.placeId;

        // Fallback 1: Script image thumbnail regex /images/script/(\d+)-
        if ((!pid || pid <= 0) && base.image) {
          const match = base.image.match(/\/images\/script\/(\d+)-/);
          if (match) pid = Number(match[1]);
        }

        // Fallback 2: Check rolimonsNameIndex
        if (!pid || pid <= 0) {
          const gameName = base.game?.name || scriptSummary.game?.name;
          if (gameName) {
            const clean = gameName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
            if (clean && rolimonsNameIndex.has(clean)) {
              pid = rolimonsNameIndex.get(clean);
            }
          }
        }

        finalPlaceId = pid && pid > 0 ? pid : 0;
        if (finalPlaceId === 0) {
          base.isUniversal = true;
        }
      }

      // 1. Resolve script thumbnail through CDN (process: true)
      // Returns { url, original, scriptblox }
      const cdnThumbnail = await resolveScriptThumbnail(
        base.thumbnail || base.image,
      );

      // 2. Resolve owner avatar through CDN (process: false)
      // Returns { url, original }
      let resolvedOwner = base.owner ? { ...base.owner } : null;
      if (resolvedOwner) {
        const resolvedProfile = await resolveAvatarThumbnail(
          resolvedOwner.profile || resolvedOwner.profilePicture,
        );
        resolvedOwner.profile = resolvedProfile;
        resolvedOwner.profilePicture = resolvedProfile;
      }

      // 3. Resolve game image if present (process: false)
      let resolvedGameImage = base.game?.imageUrl || base.game?.thumbnail || "";
      if (resolvedGameImage) {
        resolvedGameImage = await resolveGameThumbnail(resolvedGameImage);
      }

      // 4. Resolve supported games images if present
      const rawSupported = base.supportedGames || supportedGames || [];
      const resolvedSupportedGames = Array.isArray(rawSupported)
        ? await Promise.all(
            rawSupported.map(async (sg) => {
              const sgImg = sg.imageUrl || sg.thumbnail;
              if (sgImg) {
                const thumbObj = await resolveGameThumbnail(sgImg);
                return {
                  ...sg,
                  imageUrl: thumbObj,
                  thumbnail: thumbObj,
                };
              }
              return sg;
            }),
          )
        : rawSupported;

      // 5. Resolve comment avatars
      const rawComments =
        Array.isArray(base.comments) && base.comments.length > 0
          ? base.comments
          : comments;
      const resolvedComments = Array.isArray(rawComments)
        ? await Promise.all(
            rawComments.map(async (c) => {
              if (c.commentBy?.profilePicture || c.commentBy?.profile) {
                const rawPic = c.commentBy.profile || c.commentBy.profilePicture;
                const avatarObj = await resolveAvatarThumbnail(rawPic);
                return {
                  ...c,
                  commentBy: {
                    ...c.commentBy,
                    profile: avatarObj,
                    profilePicture: avatarObj,
                  },
                };
              }
              return c;
            }),
          )
        : rawComments;

      const resolvedGameName =
        base.game?.name ||
        (finalPlaceId === 0
          ? "Universal Scripts"
          : `Game #${finalPlaceId}`);
      const resolvedGameSlug =
        finalPlaceId === 0
          ? "universal"
          : getScriptGameSlug(finalPlaceId, resolvedGameName);

      const fullScript = {
          _id: scriptSummary._id || detailed?._id,
          title: scriptSummary.title || detailed?.title,
          game: {
            ...(scriptSummary.game || {}),
            ...(detailed?.game || {}),
            name: resolvedGameName,
            slug: resolvedGameSlug,
            path: `/game/${resolvedGameSlug}`,
            imageUrl: resolvedGameImage,
            thumbnail: resolvedGameImage,
            gameId: finalPlaceId,
            placeId: finalPlaceId,
          },
          slug: scriptSummary.slug || detailed?.slug,
          verified: Boolean(base.verified),
          key: Boolean(base.key),
          keyless: base.keyless === true || base.key === false,
          views: Number(base.views || 0),
          executes: Number(base.executes || 0),
          scriptType: base.scriptType || "free",
          isUniversal: Boolean(base.isUniversal),
          isPatched: Boolean(base.isPatched),
          visibility: base.visibility || "public",
          indexUnlisted: Boolean(base.indexUnlisted),
          image: cdnThumbnail,
          thumbnail: cdnThumbnail,
          likeCount: Number(base.likeCount || 0),
          dislikeCount: Number(base.dislikeCount || 0),
          createdAt: base.createdAt || new Date().toISOString(),
          updatedAt: base.updatedAt || base.createdAt,
          lastBump: base.lastBump || base.updatedAt || base.createdAt,
          script: base.script || "",
          features: base.features || "",
          tags: Array.isArray(base.tags) ? base.tags : [],
          discord: base.discord || "",
          keyLink: base.keyLink || "",
          owner: resolvedOwner,
          reviewed: base.reviewed || null,
          liked: Boolean(base.liked),
          disliked: Boolean(base.disliked),
          cstatus: base.cstatus || null,
          isHub: Boolean(base.isHub),
          supportedGames: resolvedSupportedGames,
          changelog:
            Array.isArray(base.changelog) && base.changelog.length > 0
              ? base.changelog
              : changelog,
          comments: resolvedComments,
        };

        scriptDetailsCache.set(slug, fullScript);
        return fullScript;
      } catch (err) {
        console.warn(
          `[ScriptBlox] Could not fetch detailed script for ${slug}: ${err.message}`,
        );
      }

      const fallbackThumb = await resolveScriptThumbnail(
        scriptSummary.thumbnail || scriptSummary.image,
      );
      let fallbackOwner = scriptSummary.owner
        ? { ...scriptSummary.owner }
        : null;
      if (fallbackOwner) {
        const fallbackAvatar = await resolveAvatarThumbnail(
          fallbackOwner.profile || fallbackOwner.profilePicture,
        );
        fallbackOwner.profile = fallbackAvatar;
        fallbackOwner.profilePicture = fallbackAvatar;
      }
      let fallbackGame = scriptSummary.game ? { ...scriptSummary.game } : null;
      if (fallbackGame) {
        const fbPlaceId = Number(
          fallbackGame.gameId || fallbackGame.placeId || 0,
        );
        const fbName =
          fallbackGame.name ||
          (fbPlaceId === 0 ? "Universal Scripts" : `Game #${fbPlaceId}`);
        const fbSlug =
          fbPlaceId === 0 ? "universal" : getScriptGameSlug(fbPlaceId, fbName);
        fallbackGame = {
          ...fallbackGame,
          name: fbName,
          slug: fbSlug,
          path: `/game/${fbSlug}`,
          gameId: fbPlaceId,
          placeId: fbPlaceId,
        };
      }
      const fallbackSummary = {
        ...scriptSummary,
        thumbnail: fallbackThumb,
        image: fallbackThumb,
        owner: fallbackOwner,
        game: fallbackGame,
      };
      scriptDetailsCache.set(slug, fallbackSummary);
      return fallbackSummary;
  }

  // ----------------------------------------------------
  // 2. SCRIPTS SCRAPING (Sitemaps Discovery -> 20/page)
  // ----------------------------------------------------
  console.log("\n[2/6] Scraping Complete Scripts Directory via Sitemaps...");

  // Discover all script slugs across ScriptBlox sitemaps (~73,700 scripts)
  let scriptSlugs = await scrapeScriptBloxScriptSitemaps();

  // Fallback to fetchScripts if sitemaps fail to load
  if (!scriptSlugs || scriptSlugs.length === 0) {
    console.warn(
      "-> Sitemaps returned 0 scripts, falling back to API pagination...",
    );
    const page1Res = await fetchScripts({ page: 1, max: 20 });
    const upstreamPages = Math.min(
      SCRAPE_LIMITS.latestScriptPages,
      page1Res.totalPages || 1,
    );
    scriptSlugs = [];
    for (let p = 1; p <= upstreamPages; p++) {
      const pRes = await fetchScripts({ page: p, max: 20 });
      for (const s of pRes.scripts || []) {
        if (s.slug || s._id) scriptSlugs.push(s.slug || s._id);
      }
    }
  }

  const allScrapedScripts = [];
  const scriptsMap = new Map(); // slug -> full script object
  const scriptsByPlaceId = new Map(); // placeId -> Array of full scripts

  // Divide discovered scripts into pages of 20
  const SCRIPTS_PER_PAGE = 20;
  const totalDiscoveredPages = Math.ceil(scriptSlugs.length / SCRIPTS_PER_PAGE);
  const targetTotalPages = Math.min(
    SCRAPE_LIMITS.latestScriptPages,
    totalDiscoveredPages,
  );

  console.log(
    `-> Total scripts discovered: ${scriptSlugs.length} across ${totalDiscoveredPages} pages.`,
  );
  console.log(
    `-> Scraping target: ${targetTotalPages} pages (${targetTotalPages * SCRIPTS_PER_PAGE} scripts max)...`,
  );

  for (let page = 1; page <= targetTotalPages; page++) {
    const pageOffset = (page - 1) * SCRIPTS_PER_PAGE;
    const pageSlugs = scriptSlugs.slice(
      pageOffset,
      pageOffset + SCRIPTS_PER_PAGE,
    );

    if (pageSlugs.length === 0) break;

    // Concurrently fetch complete script details for all 20 scripts on this page
    const fullCurrentScripts = await Promise.all(
      pageSlugs.map(async (slug) => {
        return getCompleteScript({ slug });
      }),
    );

    for (const full of fullCurrentScripts) {
      if (!full) continue;
      const slug = full.slug || full._id;
      if (slug && !scriptsMap.has(slug)) {
        scriptsMap.set(slug, full);
      }
      allScrapedScripts.push(full);

      // Group by placeId if game is associated
      const placeId = full.game?.gameId || full.game?.placeId;
      if (placeId && placeId > 0 && !full.isUniversal) {
        if (!scriptsByPlaceId.has(placeId)) {
          scriptsByPlaceId.set(placeId, []);
        }
        scriptsByPlaceId.get(placeId).push(full);
      }

      // If hub script has supported games, cross-link it under each supported game's placeId
      if (full.supportedGames && full.supportedGames.length > 0) {
        for (const sg of full.supportedGames) {
          const gId = sg.gameId || sg.placeId;
          if (gId && gId > 0) {
            if (!scriptsByPlaceId.has(gId)) {
              scriptsByPlaceId.set(gId, []);
            }
            const gameScripts = scriptsByPlaceId.get(gId);
            const exists = gameScripts.some(
              (x) =>
                (x.slug && x.slug === full.slug) ||
                (x._id && x._id === full._id),
            );
            if (!exists) {
              gameScripts.push(full);
            }
          }
        }
      }
    }

    // Save individual page: /data/home/latest/[page].json with complete script data
    await writeJsonFile(path.join(PATHS.homeLatest, `${page}.json`), {
      page,
      totalPages: targetTotalPages,
      count: fullCurrentScripts.length,
      scripts: fullCurrentScripts,
    });
    stats.latestPagesScraped++;

    if (page % 25 === 0 || page === targetTotalPages) {
      console.log(
        `-> Progress: Scraped page ${page}/${targetTotalPages} (${allScrapedScripts.length} scripts so far)...`,
      );
    }
  }

  // Save /data/home/latest.json
  await writeJsonFile(path.join(PATHS.home, "latest.json"), {
    totalPages: targetTotalPages,
    totalScriptsScraped: allScrapedScripts.length,
    page: 1,
    scripts: allScrapedScripts.slice(0, 20),
  });

  // Top executed scripts for /data/home/topscript.json
  console.log("-> Generating /data/home/topscript.json...");
  const mostViewedRes = await fetchScripts({
    sortBy: "views",
    order: "desc",
    max: 20,
  });
  const topScriptsRaw = mostViewedRes.scripts || [];
  const topScripts = [];
  for (const s of topScriptsRaw.slice(0, 15)) {
    const full = await getCompleteScript(s);
    topScripts.push(full);
  }
  topScripts.sort((a, b) => (b.executes || 0) - (a.executes || 0));
  await writeJsonFile(
    path.join(PATHS.home, "topscript.json"),
    topScripts.slice(0, 12),
  );

  // Write each script once to /data/script/[hash].json using deterministic fixed-length SHA-256 hash of slug
  console.log(
    `-> Writing ${scriptsMap.size} unique complete script files into /data/script/...`,
  );
  const scriptEntries = Array.from(scriptsMap.entries());
  const SCRIPT_BATCH_SIZE = 40;
  for (let i = 0; i < scriptEntries.length; i += SCRIPT_BATCH_SIZE) {
    const batch = scriptEntries.slice(i, i + SCRIPT_BATCH_SIZE);
    await Promise.all(
      batch.map(async ([slug, script]) => {
        const hash = slugToHash(slug);
        if (!hash) return;
        await writeJsonFile(path.join(PATHS.script, `${hash}.json`), script);
        stats.individualScriptsSaved++;
      }),
    );
  }
  stats.scriptsScraped = allScrapedScripts.length;
  console.log(
    `✓ Saved ${stats.latestPagesScraped} latest pages and ${stats.individualScriptsSaved} /data/script/ files.`,
  );

  // ----------------------------------------------------
  // 3. UNIFIED GAMES CATALOG & GAME DETAILS
  // ----------------------------------------------------
  console.log(
    "\n[3/6] Generating Unified Games Catalog & Details (/game/games.json, /game/[id].json, /game/[id]/[page].json)...",
  );

  // Gather ALL place IDs from:
  // a) Rolimons catalog
  // b) Every placeId found across all scraped scripts
  const allGamePlaceIds = new Set();
  for (const g of catalogSlice) allGamePlaceIds.add(g.placeId);
  for (const placeId of scriptsByPlaceId.keys()) allGamePlaceIds.add(placeId);

  const placeIdList = Array.from(allGamePlaceIds).filter((id) => id && id > 0);
  console.log(
    `-> Total unique place IDs to build details for: ${placeIdList.length}...`,
  );

  // Batch fetch Roblox place icons for any newly discovered placeIds from scripts
  const uncachedPlaceIds = placeIdList.filter(
    (id) => !rolimonsPlaceIcons.has(id),
  );
  if (uncachedPlaceIds.length > 0) {
    console.log(
      `-> Batch fetching Roblox place icons for ${uncachedPlaceIds.length} script-discovered games...`,
    );
    const extraIcons = await fetchRobloxPlaceIcons(uncachedPlaceIds);
    for (const [id, url] of extraIcons.entries()) {
      rolimonsPlaceIcons.set(id, url);
    }
  }

  // Pre-fetch ScriptBlox summary and Roblox details for games with scripts + top active games
  const placeIdsNeedingRoblox = new Set();
  const maxLiveDetails =
    Number(process.env.MAX_ROBLOX_DETAILS) ||
    SCRAPE_LIMITS.topGamesWithRobloxDetails ||
    240;

  // 1. Top active games from Rolimons
  for (let i = 0; i < Math.min(placeIdList.length, maxLiveDetails); i++) {
    placeIdsNeedingRoblox.add(placeIdList[i]);
  }
  // 2. ALL games that have scripts (users will view these game pages!)
  for (const [pid, scripts] of scriptsByPlaceId.entries()) {
    if (scripts && scripts.length > 0) {
      placeIdsNeedingRoblox.add(pid);
    }
  }
  // 3. Or all games if env flag set
  if (process.env.FETCH_ALL_ROBLOX_DETAILS === "true") {
    for (const pid of placeIdList) placeIdsNeedingRoblox.add(pid);
  }

  console.log(
    `-> Batch fetching Roblox game details for ${placeIdsNeedingRoblox.size} games...`,
  );
  const robloxDetailsMap = await fetchRobloxGamesBatch(
    Array.from(placeIdsNeedingRoblox),
  );
  savePlaceToUniverseCache();

  const unifiedGames = [];
  const BATCH_SIZE = 40;
  for (let i = 0; i < placeIdList.length; i += BATCH_SIZE) {
    const chunk = placeIdList.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (placeId, offset) => {
        const overallIndex = i + offset;
        const rolimonInfo = rolimonsMap.get(placeId);
        const localScripts = scriptsByPlaceId.get(placeId) || [];
        let robloxDetails = robloxDetailsMap.get(placeId) || null;

        // Check if we should fetch ScriptBlox game summary
        let scriptbloxSummary = null;
        if (localScripts.length > 0 || overallIndex < 100) {
          scriptbloxSummary = await fetchGameSummary(placeId);
        }

        // Build the UnifiedGame object
        const unifiedGame = await buildUnifiedGame({
          rolimons: {
            placeId,
            name: rolimonInfo?.name,
            totalPlayers: rolimonInfo?.totalPlayers,
            rolimonsThumb: rolimonInfo?.rolimonsThumb,
            robloxIcon: rolimonsPlaceIcons.get(placeId),
          },
          roblox: robloxDetails,
          scriptblox:
            scriptbloxSummary ||
            (localScripts.length > 0
              ? {
                  count: localScripts.length,
                  freeCount: localScripts.filter(
                    (s) => s.scriptType === "free" || !s.key,
                  ).length,
                  keyCount: localScripts.filter((s) => s.key).length,
                  verifiedCount: localScripts.filter((s) => s.verified).length,
                }
              : null),
        });

        // If local scripts exist and scriptbloxSummary had 0 count, update count
        if (localScripts.length > unifiedGame.script.count) {
          unifiedGame.script.count = localScripts.length;
        }

        unifiedGames.push(unifiedGame);

        // Write /data/game/[id].json (the game detail file)
        await writeJsonFile(
          path.join(PATHS.game, `${placeId}.json`),
          unifiedGame,
        );
        stats.gameDetailsCreated++;

        // If game has scripts (script.count > 0), create /data/game/[id]/[page].json
        if (unifiedGame.script.count > 0 || localScripts.length > 0) {
          const gameDir = path.join(PATHS.game, String(placeId));
          await ensureDir(gameDir);

          const totalScriptCount = Math.max(
            unifiedGame.script.count,
            localScripts.length,
          );
          const totalScriptPages = Math.max(
            1,
            Math.ceil(totalScriptCount / 20),
          );

          for (let p = 1; p <= totalScriptPages; p++) {
            const pageOffset = (p - 1) * 20;
            let pageScripts = localScripts.slice(pageOffset, pageOffset + 20);

            // If we don't have enough local scripts and it's within the first few pages, fetch from ScriptBlox
            const maxGamePagesToFetch =
              Number(process.env.MAX_GAME_SCRIPT_PAGES) || 2;
            if (pageScripts.length === 0 && p <= maxGamePagesToFetch) {
              const fetchRes = await fetchGameScripts(placeId, p, 20);
              const fetchedRaw = fetchRes.scripts || [];
              pageScripts = [];
              for (const s of fetchedRaw) {
                const full = await getCompleteScript(s);
                pageScripts.push(full);
              }
            }

            const gamePagePayload = {
              ...unifiedGame,
              page: p,
              next: p < totalScriptPages ? p + 1 : null,
              total: totalScriptPages,
              scripts: pageScripts,
            };

            await writeJsonFile(
              path.join(gameDir, `${p}.json`),
              gamePagePayload,
            );
            stats.gameScriptPagesCreated++;
          }
        }
      }),
    );

    if (
      (i + BATCH_SIZE) % 1000 < BATCH_SIZE ||
      i + BATCH_SIZE >= placeIdList.length
    ) {
      console.log(
        `-> Progress: Generated ${Math.min(i + BATCH_SIZE, placeIdList.length)}/${placeIdList.length} game detail files...`,
      );
    }
  }

  // Sort unifiedGames descending by active players (playing)
  unifiedGames.sort((a, b) => (b.playing || 0) - (a.playing || 0));

  // Top trending games (e.g. top 48) for /data/home/trending.json
  const trendingGames = unifiedGames.slice(0, SCRAPE_LIMITS.trendingGames);
  await writeJsonFile(path.join(PATHS.home, "trending.json"), trendingGames);

  // Paginated games directory (24 games each page matching WebAuth)
  const { totalPages, pages, page1 } = paginateGames(
    unifiedGames,
    SCRAPE_LIMITS.gamePageSize,
  );

  // Write each individual page to /data/game/games/[page].json
  for (const pagePayload of pages) {
    await writeJsonFile(
      path.join(PATHS.gamePages, `${pagePayload.currentPage}.json`),
      pagePayload,
    );
  }

  // /data/game/games.json loads page 1 (matches WebAuth PaginatedGamesResult)
  await writeJsonFile(path.join(PATHS.game, "games.json"), page1);

  stats.gamesScraped = unifiedGames.length;
  stats.gamePagesCreated = totalPages;
  console.log(
    `✓ Saved /data/home/trending.json (${trendingGames.length}), /data/game/games.json (page 1), and ${totalPages} pages in /data/game/games/[page].json.`,
  );

  // ----------------------------------------------------
  // 4. KEYLESS, VERIFIED, UNPATCHED & UNIVERSAL SCRIPTS
  // ----------------------------------------------------
  console.log(
    "\n[4/6] Scraping Keyless, Verified, Unpatched & Universal Scripts...",
  );

  // Keyless scripts
  const keylessScripts = [];
  let targetKeylessPages = SCRAPE_LIMITS.keylessScriptPages;
  for (let p = 1; p <= targetKeylessPages; p++) {
    const kRes = await fetchScripts({ page: p, keyless: 1, max: 20 });
    const pageScriptsRaw = kRes.scripts || [];
    if (pageScriptsRaw.length === 0) break;
    if (p === 1 && kRes.totalPages) {
      targetKeylessPages = Math.min(
        SCRAPE_LIMITS.keylessScriptPages,
        kRes.totalPages,
      );
    }
    const pageScripts = await Promise.all(
      pageScriptsRaw.map((s) => getCompleteScript(s)),
    );
    keylessScripts.push(...pageScripts);
    await writeJsonFile(path.join(PATHS.keylessPages, `${p}.json`), {
      page: p,
      totalPages: kRes.totalPages || targetKeylessPages,
      scripts: pageScripts,
    });
  }
  // Save /data/keyless/scripts.json with page 1 summary slice (20 scripts)
  await writeJsonFile(path.join(PATHS.keyless, "scripts.json"), {
    page: 1,
    totalPages: targetKeylessPages,
    totalCount: keylessScripts.length,
    count: Math.min(20, keylessScripts.length),
    scripts: keylessScripts.slice(0, 20),
  });

  // Verified scripts
  const verifiedScripts = [];
  let targetVerifiedPages = SCRAPE_LIMITS.verifiedScriptPages;
  for (let p = 1; p <= targetVerifiedPages; p++) {
    const vRes = await fetchScripts({ page: p, verified: 1, max: 20 });
    const pageScriptsRaw = vRes.scripts || [];
    if (pageScriptsRaw.length === 0) break;
    if (p === 1 && vRes.totalPages) {
      targetVerifiedPages = Math.min(
        SCRAPE_LIMITS.verifiedScriptPages,
        vRes.totalPages,
      );
    }
    const pageScripts = await Promise.all(
      pageScriptsRaw.map((s) => getCompleteScript(s)),
    );
    verifiedScripts.push(...pageScripts);
    await writeJsonFile(path.join(PATHS.verifiedPages, `${p}.json`), {
      page: p,
      totalPages: vRes.totalPages || targetVerifiedPages,
      scripts: pageScripts,
    });
  }
  // Save /data/verified/scripts.json with page 1 summary slice (20 scripts)
  await writeJsonFile(path.join(PATHS.verified, "scripts.json"), {
    page: 1,
    totalPages: targetVerifiedPages,
    totalCount: verifiedScripts.length,
    count: Math.min(20, verifiedScripts.length),
    scripts: verifiedScripts.slice(0, 20),
  });

  // Unpatched scripts (patched: 0)
  const unpatchedScripts = [];
  let targetUnpatchedPages = SCRAPE_LIMITS.unpatchedScriptPages;
  for (let p = 1; p <= targetUnpatchedPages; p++) {
    const uRes = await fetchScripts({ page: p, patched: 0, max: 20 });
    const pageScriptsRaw = uRes.scripts || [];
    if (pageScriptsRaw.length === 0) break;
    if (p === 1 && uRes.totalPages) {
      targetUnpatchedPages = Math.min(
        SCRAPE_LIMITS.unpatchedScriptPages,
        uRes.totalPages,
      );
    }
    const pageScripts = await Promise.all(
      pageScriptsRaw.map((s) => getCompleteScript(s)),
    );
    unpatchedScripts.push(...pageScripts);
    await writeJsonFile(path.join(PATHS.unpatchedPages, `${p}.json`), {
      page: p,
      totalPages: uRes.totalPages || targetUnpatchedPages,
      scripts: pageScripts,
    });
  }
  // Save /data/unpatched/scripts.json with page 1 summary slice (20 scripts)
  await writeJsonFile(path.join(PATHS.unpatched, "scripts.json"), {
    page: 1,
    totalPages: targetUnpatchedPages,
    totalCount: unpatchedScripts.length,
    count: Math.min(20, unpatchedScripts.length),
    scripts: unpatchedScripts.slice(0, 20),
  });

  // Universal scripts
  const universalScripts = [];
  let targetUniversalPages = SCRAPE_LIMITS.universalScriptPages;
  for (let p = 1; p <= targetUniversalPages; p++) {
    const uRes = await fetchScripts({ page: p, universal: 1, max: 20 });
    const uScriptsRaw = uRes.scripts || [];
    if (uScriptsRaw.length === 0) break;
    if (p === 1 && uRes.totalPages) {
      targetUniversalPages = Math.min(
        SCRAPE_LIMITS.universalScriptPages,
        uRes.totalPages,
      );
    }
    const pageScripts = await Promise.all(
      uScriptsRaw.map((s) => getCompleteScript(s)),
    );
    universalScripts.push(...pageScripts);
  }

  // Also include any universal/hub scripts discovered during latest script scraping
  for (const s of allScrapedScripts) {
    if (s.isUniversal || s.isHub) {
      const exists = universalScripts.some(
        (u) => (u.slug && u.slug === s.slug) || (u._id && u._id === s._id),
      );
      if (!exists) {
        universalScripts.push(s);
      }
    }
  }

  // Save /data/universal/scripts.json with page 1 summary slice (20 scripts)
  await writeJsonFile(path.join(PATHS.universal, "scripts.json"), {
    page: 1,
    totalCount: universalScripts.length,
    count: Math.min(20, universalScripts.length),
    scripts: universalScripts.slice(0, 20),
  });

  // Construct Universal as a Game entity conforming to Unified Game Schema
  const universalGame = await buildUnifiedGame({
    rolimons: {
      placeId: 0,
      name: "Universal Scripts",
      totalPlayers: 0,
    },
    roblox: {
      name: "Universal Scripts",
      description:
        "Universal Roblox scripts, admin command panels, and game-agnostic utilities engineered to work across any Roblox experience.",
      creator: {
        name: "Universal / Community",
        type: "Community",
      },
      playing: 0,
      visits: 0,
    },
    scriptblox: {
      game: {
        gameId: 0,
        name: "Universal Scripts",
        verified: true,
      },
      path: "/game/universal",
      updatedAt:
        universalScripts[0]?.updatedAt ||
        universalScripts[0]?.createdAt ||
        new Date().toISOString(),
      count: universalScripts.length,
      freeCount: universalScripts.filter(
        (s) => s.scriptType === "free" || !s.key,
      ).length,
      keyCount: universalScripts.filter((s) => s.key).length,
      verifiedCount: universalScripts.filter((s) => s.verified).length,
    },
    thumbnail: CDN_CONFIG.fallbacks.game,
  });

  // Write /data/game/universal.json (acts like a game)
  await writeJsonFile(path.join(PATHS.game, "universal.json"), universalGame);
  // Also alias /data/game/0.json
  await writeJsonFile(path.join(PATHS.game, "0.json"), universalGame);
  stats.gameDetailsCreated += 2;

  // Paginate /data/game/universal/[page].json (and /data/game/0/[page].json)
  const gameUniversalDir = PATHS.gameUniversal;
  const gameZeroDir = path.join(PATHS.game, "0");
  await ensureDir(gameUniversalDir);
  await ensureDir(gameZeroDir);

  const universalPageSize = 20;
  const totalUniversalPages = Math.max(
    1,
    Math.ceil(universalScripts.length / universalPageSize),
  );

  for (let p = 1; p <= totalUniversalPages; p++) {
    const pageOffset = (p - 1) * universalPageSize;
    const pageScripts = universalScripts.slice(
      pageOffset,
      pageOffset + universalPageSize,
    );
    const universalPagePayload = {
      ...universalGame,
      page: p,
      next: p < totalUniversalPages ? p + 1 : null,
      total: totalUniversalPages,
      scripts: pageScripts,
    };
    await writeJsonFile(
      path.join(gameUniversalDir, `${p}.json`),
      universalPagePayload,
    );
    await writeJsonFile(
      path.join(gameZeroDir, `${p}.json`),
      universalPagePayload,
    );
    stats.gameScriptPagesCreated += 2;
  }

  console.log(
    `✓ Saved /data/keyless/scripts.json (${keylessScripts.length}), /data/verified/scripts.json (${verifiedScripts.length}), /data/unpatched/scripts.json (${unpatchedScripts.length}), /data/universal/scripts.json (${universalScripts.length}), /data/game/universal.json and ${totalUniversalPages} pages in /data/game/universal/[page].json.`,
  );

  // ----------------------------------------------------
  // 5. TRENDING LEADERBOARDS (Fixing gameId & placeId)
  // ----------------------------------------------------
  console.log(
    "\n[5/6] Scraping Leaderboards & Fixing Missing gameId/placeId...",
  );

  const periods = ["day", "week", "month", "all"];
  const leaderboardSummaries = {};

  for (const period of periods) {
    const lbData = await fetchLeaderboard(period);
    if (lbData) {
      const scriptsBoard = lbData.leaderboard?.boards?.scripts?.executes;
      if (Array.isArray(scriptsBoard)) {
        for (const item of scriptsBoard) {
          // Fetch complete script data via slug
          const full = await getCompleteScript(item);

          // Resolve game placeId
          let resolvedPlaceId = full?.game?.gameId || full?.game?.placeId;

          if (!resolvedPlaceId && !item.isUniversal && item.game?.name) {
            const clean = item.game.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
            resolvedPlaceId = rolimonsNameIndex.get(clean);
          }

          if (!resolvedPlaceId && !item.isUniversal && item.image) {
            const match = item.image.match(/\/images\/script\/(\d+)-/);
            if (match) resolvedPlaceId = Number(match[1]);
          }

          if (item.isUniversal || full?.isUniversal || resolvedPlaceId === 0) {
            resolvedPlaceId = 0;
          }

          const finalPlaceId =
            resolvedPlaceId !== undefined ? resolvedPlaceId : 0;

          // Fix the missing gameId and placeId on the game object
          item.game = {
            ...(item.game || {}),
            name:
              item.game?.name ||
              full?.game?.name ||
              (finalPlaceId === 0
                ? "Universal Scripts"
                : `Game #${finalPlaceId}`),
            imageUrl: item.game?.imageUrl || full?.game?.imageUrl || "",
            gameId: finalPlaceId,
            placeId: finalPlaceId,
          };
          item.isUniversal = Boolean(
            item.isUniversal || full?.isUniversal || finalPlaceId === 0,
          );
          item.isHub = Boolean(item.isHub || full?.isHub);
          if (full?.supportedGames) item.supportedGames = full.supportedGames;

          // Enrich with full script properties if available
          if (full?.image) item.image = full.image;
          if (full?.script) item.script = full.script;
          if (full?.features) item.features = full.features;
          if (full?.tags) item.tags = full.tags;
          if (full?.discord) item.discord = full.discord;
          if (full?.keyLink) item.keyLink = full.keyLink;
          if (full?.owner)
            item.owner = { ...(item.owner || {}), ...(full.owner || {}) };
        }
      }

      // Resolve creator profile pictures through CDN
      const creatorsBoard = lbData.leaderboard?.boards?.creators?.executes;
      if (Array.isArray(creatorsBoard)) {
        for (const creator of creatorsBoard) {
          if (creator.profilePicture || creator.profile) {
            const rawPic = creator.profile || creator.profilePicture;
            const avatarObj = await resolveAvatarThumbnail(rawPic);
            creator.profile = avatarObj;
            creator.profilePicture = avatarObj;
          }
        }
      }

      await writeJsonFile(path.join(PATHS.trending, `${period}.json`), lbData);
      leaderboardSummaries[period] = {
        computedAt: lbData.leaderboard?.computedAt,
        since: lbData.leaderboard?.since,
        scriptsCount:
          lbData.leaderboard?.boards?.scripts?.executes?.length || 0,
        creatorsCount:
          lbData.leaderboard?.boards?.creators?.executes?.length || 0,
      };
      stats.leaderboardsScraped++;
    }
  }
  await writeJsonFile(
    path.join(PATHS.trending, "index.json"),
    leaderboardSummaries,
  );

  // Executors
  const rawExecutors = await fetchExecutors();
  const executors = await Promise.all(
    rawExecutors.map(async (item) => {
      const copy = { ...item };
      if (copy.thumbnail) {
        copy.thumbnail = await resolveScriptThumbnail(copy.thumbnail);
      }
      if (copy.logo) {
        copy.logo = await resolveAvatarThumbnail(copy.logo);
      }
      return copy;
    }),
  );
  await writeJsonFile(path.join(PATHS.executor, "executors.json"), executors);
  for (const item of executors) {
    const rawSlug = (item.slug || item.name || item.id || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const safeSlug = toSafeFilename(rawSlug);
    if (safeSlug) {
      await writeJsonFile(path.join(PATHS.executor, `${safeSlug}.json`), item);
    }
  }
  stats.executorsScraped = executors.length;
  console.log(
    `✓ Saved leaderboards in /data/trending/ and ${executors.length} executors in /data/executor/.`,
  );

  // ----------------------------------------------------
  // 6. MANIFEST & SUMMARY
  // ----------------------------------------------------
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const manifest = {
    updatedAt: new Date().toISOString(),
    durationSeconds: durationSec,
    stats,
    structure: {
      home: {
        trending: "data/home/trending.json",
        topscript: "data/home/topscript.json",
        latest: "data/home/latest.json",
        latestPages: "data/home/latest/{page}.json",
      },
      script: {
        detail: "data/script/{hash}.json",
      },
      game: {
        games: "data/game/games.json",
        pages: "data/game/games/{page}.json",
        detail: "data/game/{id}.json",
        scripts: "data/game/{id}/{page}.json",
        universal: "data/game/universal.json",
        universalPages: "data/game/universal/{page}.json",
      },
      trending: {
        day: "data/trending/day.json",
        week: "data/trending/week.json",
        month: "data/trending/month.json",
        all: "data/trending/all.json",
      },
      keyless: {
        scripts: "data/keyless/scripts.json",
        pages: "data/keyless/pages/{page}.json",
      },
      verified: {
        scripts: "data/verified/scripts.json",
        pages: "data/verified/pages/{page}.json",
      },
      unpatched: {
        scripts: "data/unpatched/scripts.json",
        pages: "data/unpatched/pages/{page}.json",
      },
      universal: {
        scripts: "data/universal/scripts.json",
      },
      executor: {
        executors: "data/executor/executors.json",
        spec: "data/executor/{name}.json",
      },
    },
  };

  await writeJsonFile(path.join(PATHS.data, "manifest.json"), manifest);
  savePlaceToUniverseCache();
  saveCdnCache();

  console.log("\n==================================================");
  console.log("Data Pipeline Complete!");
  console.log(`Duration: ${durationSec}s`);
  console.log(`Games Scraped: ${stats.gamesScraped}`);
  console.log(
    `Game Pages Created (/data/game/games/[page].json): ${stats.gamePagesCreated}`,
  );
  console.log(
    `Complete Game Details (/data/game/[id].json): ${stats.gameDetailsCreated}`,
  );
  console.log(
    `Game Script Pages Created (/data/game/[id]/[page].json): ${stats.gameScriptPagesCreated}`,
  );
  console.log(`Scripts Scraped: ${stats.scriptsScraped}`);
  console.log(
    `Individual Complete Script Files (/data/script/[hash].json): ${stats.individualScriptsSaved}`,
  );
  console.log(`Executors Scraped: ${stats.executorsScraped}`);
  console.log(`Leaderboards Scraped: ${stats.leaderboardsScraped}`);
  console.log("==================================================");
}

// Execute if run directly from CLI
const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) ===
    path.resolve(process.argv[1]);

if (isDirectRun) {
  runScraper().catch((err) => {
    console.error("Fatal scraping error:", err);
    process.exit(1);
  });
}
