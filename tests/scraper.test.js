import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getScriptGameSlug,
  cleanGameTitle,
  resolveScriptImageUrl,
  buildGameThumbnails,
  normalizeRobloxThumb,
  formatGamePathAndSlug,
  buildUnifiedGame,
  toSafeFilename,
  slugToHash,
  paginateGames,
} from "../src/utils/helpers.js";
import {
  resolveGameThumbnail,
  resolveScriptThumbnail,
  resolveAvatarThumbnail,
  resolveCdnImage,
  loadCdnCache,
  saveCdnCache,
} from "../src/utils/cdn.js";
import { CDN_CONFIG, ROOT_DIR } from "../src/config.js";
import { scrapeRolimonsGameList } from "../src/scrapers/rolimons.js";
import {
  fetchRobloxPlaceIcons,
  fetchRobloxGamesBatch,
  resolvePlaceToUniverse,
  savePlaceToUniverseCache,
  loadPlaceToUniverseCache,
} from "../src/scrapers/roblox.js";
import {
  fetchScripts,
  fetchScriptDetails,
  fetchGameSummary,
  fetchExecutors,
  fetchLeaderboard,
  scrapeScriptBloxScriptSitemaps,
  fetchScriptSupportedGames,
  enrichRawScriptPlaceIds,
  fetchAllComments,
  fetchScriptChangelog,
} from "../src/scrapers/scriptblox.js";

test("Image priority strictly enforces: roblox api > rolimons > scriptblox > fallback", () => {
  const robloxIcon = "https://tr.rbxcdn.com/roblox-icon.png";
  const scriptbloxImg = "/images/scriptblox-cover.png";
  const rolimonsThumb = "https://assets.rolimons.com/Image/Webp/rolimons.webp";
  const fallback = "/brand/kocakz-logo.png";

  // Case 1: All sources present -> Roblox API must be #1, Rolimons #2, ScriptBlox #3
  const res1 = buildGameThumbnails({
    robloxThumb: robloxIcon,
    scriptbloxThumb: scriptbloxImg,
    rolimonsThumb,
    fallback,
  });
  assert.equal(res1[0], robloxIcon, "Roblox icon must be highest priority");
  assert.equal(
    res1[1],
    "https://assets.rolimons.com/Image/Png/rolimons.webp",
  );
  assert.equal(
    res1[2],
    "https://scriptblox.com/images/scriptblox-cover.png",
  );
  assert.equal(res1[res1.length - 1], fallback);

  // Case 2: Roblox missing -> Rolimons must be #1
  const res2 = buildGameThumbnails({
    robloxThumb: null,
    scriptbloxThumb: scriptbloxImg,
    rolimonsThumb,
    fallback,
  });
  assert.equal(
    res2[0],
    "https://assets.rolimons.com/Image/Png/rolimons.webp",
  );

  // Case 3: Roblox and Rolimons missing -> ScriptBlox must be #1
  const res3 = buildGameThumbnails({
    robloxThumb: null,
    scriptbloxThumb: scriptbloxImg,
    rolimonsThumb: null,
    fallback,
  });
  assert.equal(
    res3[0],
    "https://scriptblox.com/images/scriptblox-cover.png",
  );

  // Case 4: All missing -> Fallback must be #1
  const res4 = buildGameThumbnails({
    robloxThumb: null,
    scriptbloxThumb: null,
    rolimonsThumb: null,
    fallback,
  });
  assert.deepEqual(res4, [fallback]);
});

test("slugToHash converts slug into deterministic 64-character SHA-256 hex string", () => {
  const slug =
    "UPD-Volleyball-Legends-Rift-*OP*-or-Auto-Hit-Auto-Serve-Hitbox-Spins-and-More-231298";
  const hash = slugToHash(slug);

  assert.equal(typeof hash, "string");
  assert.equal(
    hash.length,
    64,
    "SHA-256 hex string must be exactly 64 characters",
  );
  assert.match(
    hash,
    /^[0-9a-f]{64}$/,
    "Must only contain lowercase hex characters",
  );

  // Determinism check
  const hash2 = slugToHash(slug);
  assert.equal(hash, hash2, "Identical slugs must produce identical hashes");

  // Normalized check (URL encoded or with whitespace should hash identically)
  assert.equal(slugToHash("  " + slug + "  "), hash);
});

test("toSafeFilename encodes Windows illegal characters like * and trims trailing dots", () => {
  const problemSlug =
    "UPD-Volleyball-Legends-Rift-*OP*-or-Auto-Hit-Auto-Serve-Hitbox-Spins-and-More-231298";
  const safe = toSafeFilename(problemSlug);

  assert.ok(
    !safe.includes("*"),
    "Filename must never contain raw asterisk '*'",
  );
  assert.ok(safe.includes("%2AOP%2A"), "Asterisks must be converted to %2A");
  assert.ok(
    !/[\/\?<>\\:\*\|":]/.test(safe),
    "Filename must not contain any forbidden Windows/NTFS characters",
  );

  // Trailing dot check
  const withDot = toSafeFilename("some-script-title.");
  assert.equal(withDot, "some-script-title");
});

test("Helper getScriptGameSlug produces expected slug formats", () => {
  assert.equal(
    getScriptGameSlug(2753915549, "Blox Fruits"),
    "2753915549-blox-fruits",
  );
  assert.equal(
    getScriptGameSlug(189707, "Natural Disaster Survival"),
    "189707-natural-disaster-survival",
  );
  assert.equal(getScriptGameSlug(0, "universal"), "universal");
  assert.equal(getScriptGameSlug(undefined, "Universal Script"), "universal");
  assert.equal(
    getScriptGameSlug(9391468976, "[SKY ASSASSIN] Jujutsu Shenanigans"),
    "9391468976-jujutsu-shenanigans",
  );
  assert.equal(
    getScriptGameSlug(17625359962, "[🎃] RIVALS"),
    "17625359962-rivals",
  );
});

test("Helper cleanGameTitle removes empty brackets, event tags, and emojis", () => {
  assert.equal(cleanGameTitle("[🎃] RIVALS"), "RIVALS");
  assert.equal(cleanGameTitle("[] RIVALS"), "RIVALS");
  assert.equal(
    cleanGameTitle("[SKY ASSASSIN] Jujutsu Shenanigans"),
    "Jujutsu Shenanigans",
  );
  assert.equal(cleanGameTitle("[UPDATE 20] Blox Fruits"), "Blox Fruits");
  assert.equal(cleanGameTitle("[] Murder Mystery 2"), "Murder Mystery 2");
  assert.equal(cleanGameTitle("[🎃 HALLOWEEN] Adopt Me!"), "Adopt Me!");
  assert.equal(cleanGameTitle("Brookhaven 🏡RP"), "Brookhaven 🏡RP");
  assert.equal(cleanGameTitle("[SOLO]"), "SOLO");
  assert.equal(cleanGameTitle(""), "");
  assert.equal(cleanGameTitle(null), "");
});

test("Helper resolveScriptImageUrl handles various URL inputs", () => {
  assert.equal(
    resolveScriptImageUrl("/images/script/1.png"),
    "https://scriptblox.com/images/script/1.png",
  );
  assert.equal(
    resolveScriptImageUrl("https://tr.rbxcdn.com/abc"),
    "https://tr.rbxcdn.com/abc",
  );
  assert.equal(resolveScriptImageUrl(""), "/brand/kocakz-logo.png");
  assert.equal(resolveScriptImageUrl(null), "/brand/kocakz-logo.png");
});

test("scrapeRolimonsGameList returns sorted games array", async () => {
  const games = await scrapeRolimonsGameList();
  assert.ok(Array.isArray(games), "games must be an array");
  assert.ok(games.length > 100, "Rolimons must return at least 100 games");

  const first = games[0];
  assert.ok(typeof first.placeId === "number");
  assert.ok(first.placeId > 0);
  assert.ok(typeof first.name === "string" && first.name.length > 0);
  assert.ok(typeof first.totalPlayers === "number");
  assert.ok(
    first.totalPlayers >= games[1].totalPlayers,
    "Must be sorted descending by player count",
  );
  assert.ok(first.nameSlug.startsWith(`${first.placeId}-`));
});

test("fetchRobloxPlaceIcons batch fetches icons", async () => {
  const iconsMap = await fetchRobloxPlaceIcons([189707, 4924922222]);
  assert.ok(iconsMap instanceof Map);
  assert.ok(
    iconsMap.has(189707),
    "Should resolve icon for Natural Disaster Survival",
  );
  const icon = iconsMap.get(189707);
  assert.ok(typeof icon === "string");
  assert.match(icon, /^https:\/\//);
});

test("fetchRobloxGamesBatch resolves multiple games in batch including descriptions and visits", async () => {
  const batchMap = await fetchRobloxGamesBatch([15101393044, 2753915549]);
  assert.ok(batchMap instanceof Map);
  assert.ok(
    batchMap.has(15101393044),
    "Should contain Dress To Impress (15101393044)",
  );
  assert.ok(
    batchMap.has(2753915549),
    "Should contain Blox Fruits (2753915549)",
  );

  const dti = batchMap.get(15101393044);
  assert.equal(dti.placeId, 15101393044);
  assert.equal(dti.universeId, 5203828273);
  assert.ok(
    dti.description.length > 50,
    "Dress To Impress must have description",
  );
  assert.ok(dti.visits > 1000000, "Visits must be populated");
  assert.ok(dti.creator?.name, "Creator name must be populated");
});

test("fetchScripts fetches scripts from ScriptBlox", async () => {
  const res = await fetchScripts({ max: 5 });
  assert.ok(Array.isArray(res.scripts));
  assert.ok(res.scripts.length > 0);
  assert.ok(typeof res.totalPages === "number");
  const script = res.scripts[0];
  assert.ok(script._id);
  assert.ok(script.title);
});

test("fetchExecutors returns list of Roblox executors", async () => {
  const executors = await fetchExecutors();
  assert.ok(Array.isArray(executors));
  assert.ok(executors.length > 0);
  const first = executors[0];
  assert.ok(first.name);
});

test("fetchLeaderboard returns active leaderboard boards", async () => {
  const lb = await fetchLeaderboard("day");
  assert.ok(lb);
  assert.ok(lb.leaderboard);
  assert.ok(lb.leaderboard.boards?.scripts);
  assert.ok(lb.leaderboard.boards?.creators);
});

test("paginateGames sorts descending by totalPlayers and paginates exactly 24 games per page matching WebAuth", () => {
  // Generate 55 mock games with varying player counts
  const mockGames = Array.from({ length: 55 }, (_, i) => ({
    placeId: 1000 + i,
    name: `Game ${i}`,
    nameSlug: `${1000 + i}-game-${i}`,
    totalPlayers: (i * 37) % 500, // unsorted player counts
    thumbnailUrl: "https://tr.rbxcdn.com/icon.png",
    thumbnailSources: [
      "https://tr.rbxcdn.com/icon.png",
      "/brand/kocakz-logo.png",
    ],
    href: `/script/game/${1000 + i}-game-${i}`,
  }));

  const result = paginateGames(mockGames, 24);

  assert.equal(result.totalGames, 55);
  // Math.ceil(55 / 24) = 3 pages
  assert.equal(result.totalPages, 3);
  assert.equal(result.pages.length, 3);

  // Sorting verification: all games in result.sorted must be sorted descending by totalPlayers
  for (let i = 0; i < result.sorted.length - 1; i++) {
    assert.ok(
      result.sorted[i].totalPlayers >= result.sorted[i + 1].totalPlayers,
      `Game at index ${i} (${result.sorted[i].totalPlayers}) must be >= index ${i + 1} (${result.sorted[i + 1].totalPlayers})`,
    );
  }

  // Page 1 check (data/game/games.json and data/game/games/1.json)
  assert.equal(result.pages[0].currentPage, 1);
  assert.equal(result.pages[0].totalPages, 3);
  assert.equal(result.pages[0].totalGames, 55);
  assert.equal(result.pages[0].games.length, 24);
  assert.deepEqual(
    result.page1,
    result.pages[0],
    "page1 must exactly equal pages[0]",
  );

  // Page 2 check (data/game/games/2.json)
  assert.equal(result.pages[1].currentPage, 2);
  assert.equal(result.pages[1].totalPages, 3);
  assert.equal(result.pages[1].totalGames, 55);
  assert.equal(result.pages[1].games.length, 24);

  // Page 3 check (data/game/games/3.json) - remaining 7 games
  assert.equal(result.pages[2].currentPage, 3);
  assert.equal(result.pages[2].totalPages, 3);
  assert.equal(result.pages[2].totalGames, 55);
  assert.equal(result.pages[2].games.length, 7);

  // Verify non-overlapping game slices across all pages
  const combinedIds = result.pages.flatMap((p) =>
    p.games.map((g) => g.placeId),
  );
  assert.equal(combinedIds.length, 55);
  assert.equal(
    new Set(combinedIds).size,
    55,
    "All pages together must contain 55 unique games without overlap",
  );

  // WebAuth PaginatedGamesResult shape verification
  const firstGame = result.page1.games[0];
  assert.ok(typeof firstGame.placeId === "number");
  assert.ok(typeof firstGame.name === "string");
  assert.ok(typeof firstGame.nameSlug === "string");
  assert.ok(typeof firstGame.totalPlayers === "number");
  assert.ok(typeof firstGame.thumbnailUrl === "string");
  assert.ok(Array.isArray(firstGame.thumbnailSources));
  assert.ok(typeof firstGame.href === "string");
});

test("normalizeRobloxThumb resizes Roblox CDN thumbnails to 150/150", () => {
  const original =
    "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/480/270/Image/Png/noFilter";
  const normalized = normalizeRobloxThumb(original);
  assert.equal(
    normalized,
    "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/150/150/Image/Png/noFilter",
  );

  // Non-Roblox CDN URLs are left intact
  assert.equal(
    normalizeRobloxThumb("https://assets.rolimons.com/Image/Png/1.png"),
    "https://assets.rolimons.com/Image/Png/1.png",
  );
  assert.equal(
    normalizeRobloxThumb("/brand/kocakz-logo.png"),
    "/brand/kocakz-logo.png",
  );
});

test("buildGameThumbnails enforces exact order: [roblox, rolimons, scriptblox, fallback]", () => {
  const thumbs = buildGameThumbnails({
    robloxThumb: "https://tr.rbxcdn.com/abc/500/280/Image/Png/noFilter",
    rolimonsThumb: "https://assets.rolimons.com/Image/Webp/test.webp",
    scriptbloxThumb: "/images/scriptblox.png",
    fallback: "/brand/kocakz-logo.png",
  });

  assert.equal(thumbs.length, 4);
  assert.equal(
    thumbs[0],
    "https://tr.rbxcdn.com/abc/150/150/Image/Png/noFilter",
    "Roblox thumb must be first and resized to 150/150",
  );
  assert.equal(
    thumbs[1],
    "https://assets.rolimons.com/Image/Png/test.webp",
    "Rolimons PNG must be second",
  );
  assert.equal(
    thumbs[2],
    "https://scriptblox.com/images/scriptblox.png",
    "ScriptBlox must be third",
  );
  assert.equal(thumbs[3], "/brand/kocakz-logo.png", "Fallback must be fourth");
});

test("formatGamePathAndSlug resolves canonical path and slug", () => {
  // Case 1: ScriptBlox path provided
  const res1 = formatGamePathAndSlug({
    placeId: 189707,
    name: "Natural Disaster Survival",
    scriptbloxPath: "/game/189707-natural-disaster-survival",
  });
  assert.equal(res1.path, "/game/189707-natural-disaster-survival");
  assert.equal(res1.slug, "189707-natural-disaster-survival");

  // Case 2: Roblox canonicalUrlPath provided
  const res2 = formatGamePathAndSlug({
    placeId: 189707,
    name: "Natural Disaster Survival",
    canonicalUrlPath: "/games/189707/Natural-Disaster-Survival",
  });
  assert.equal(res2.path, "/game/189707-natural-disaster-survival");
  assert.equal(res2.slug, "189707-natural-disaster-survival");

  // Case 3: Fallback from name & ID
  const res3 = formatGamePathAndSlug({
    placeId: 2753915549,
    name: "Blox Fruits",
  });
  assert.equal(res3.path, "/game/2753915549-blox-fruits");
  assert.equal(res3.slug, "2753915549-blox-fruits");
});

test("buildUnifiedGame produces exact user-specified schema with single CDN thumbnail string", async () => {
  const unified = await buildUnifiedGame({
    rolimons: {
      placeId: 189707,
      name: "Natural Disaster Survival",
      totalPlayers: 5781,
      rolimonsThumb: "https://assets.rolimons.com/Image/Webp/189707.webp",
      robloxIcon: "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/150/150/Image/Png/noFilter",
    },
    roblox: {
      description: "Quickly, run around in circles! Your life depends on it!",
      visits: 4502938627,
      creator: { name: "Stickmasterluke", type: "User" },
      canonicalUrlPath: "/games/189707/Natural-Disaster-Survival",
      updated: "2026-09-17T16:05:51.936Z",
    },
    scriptblox: {
      game: { name: "Natural Disaster Survival", verified: true },
      path: "/game/189707-natural-disaster-survival",
      count: 229,
      freeCount: 229,
      keyCount: 29,
      verifiedCount: 7,
      updatedAt: "2026-10-08T07:02:04.664Z",
    },
  });

  assert.equal(unified.id, 189707);
  assert.equal(unified.name, "Natural Disaster Survival");
  assert.equal(
    unified.desc,
    "Quickly, run around in circles! Your life depends on it!",
  );
  assert.equal(unified.path, "/game/189707-natural-disaster-survival");
  assert.equal(unified.slug, "189707-natural-disaster-survival");
  assert.equal(typeof unified.thumbnail, "object");
  assert.match(unified.thumbnail.url, /^https:\/\/media\.kocakz\.me\/.+\.webp$/);
  assert.ok(unified.thumbnail.original);
  assert.equal(unified.playing, 5781);
  assert.equal(unified.visitor, 4502938627);
  assert.equal(unified.verified, true);
  assert.equal(unified.updatedAt, "2026-10-08T07:02:04.664Z");
  assert.deepEqual(unified.creator, { name: "Stickmasterluke", type: "User" });
  assert.deepEqual(unified.script, {
    count: 229,
    freeCount: 229,
    keyCount: 29,
    verifiedCount: 7,
  });
});

test("fetchGameSummary returns ScriptBlox game summary including count, freeCount, verifiedCount", async () => {
  const summary = await fetchGameSummary(189707);
  assert.ok(summary);
  assert.ok(summary.game);
  assert.equal(summary.game.gameId, 189707);
  assert.ok(typeof summary.count === "number");
  assert.ok(typeof summary.freeCount === "number");
  assert.ok(typeof summary.verifiedCount === "number");
  assert.ok(typeof summary.keyCount === "number");
});

test("fetchScriptDetails fetches complete script containing script code, features, owner, discord, keyLink", async () => {
  const listRes = await fetchScripts({ max: 1 });
  assert.ok(listRes.scripts.length > 0);
  const slug = listRes.scripts[0].slug;

  const full = await fetchScriptDetails(slug);
  assert.ok(full, "Detailed script must be returned");
  assert.equal(full.slug, slug);
  assert.ok(full._id);
  assert.ok(full.title);
  assert.ok(
    typeof full.script === "string",
    "Full script must contain the Lua code string",
  );
  assert.ok(full.owner, "Full script must contain owner object");
});

test("Universal acts like a game conforming to Unified Game Schema and pagination", async () => {
  const mockUniversalScripts = [
    { title: "Dex Explorer", scriptType: "free", key: false, verified: true },
    { title: "Infinite Yield", scriptType: "free", key: false, verified: true },
    { title: "Hydroxide", scriptType: "key", key: true, verified: false },
  ];

  const universalGame = await buildUnifiedGame({
    rolimons: { placeId: 0, name: "Universal Scripts", totalPlayers: 0 },
    roblox: {
      name: "Universal Scripts",
      description: "Universal Roblox scripts and admin command panels.",
      creator: { name: "Universal / Community", type: "Community" },
    },
    scriptblox: {
      game: { gameId: 0, name: "Universal Scripts", verified: true },
      path: "/game/universal",
      count: mockUniversalScripts.length,
      freeCount: 2,
      keyCount: 1,
      verifiedCount: 2,
    },
    thumbnail: CDN_CONFIG?.fallbacks?.game || "https://media.kocakz.me/no-game.webp",
  });

  assert.equal(universalGame.id, 0);
  assert.equal(universalGame.name, "Universal Scripts");
  assert.equal(universalGame.slug, "universal");
  assert.equal(universalGame.path, "/game/universal");
  assert.equal(typeof universalGame.thumbnail, "object");
  assert.equal(universalGame.thumbnail.url, "https://media.kocakz.me/no-game.webp");
  assert.equal(universalGame.script.count, 3);
  assert.equal(universalGame.script.freeCount, 2);
  assert.equal(universalGame.script.keyCount, 1);
  assert.equal(universalGame.script.verifiedCount, 2);

  // Pagination payload check
  const pagePayload = {
    ...universalGame,
    page: 1,
    next: null,
    total: 1,
    scripts: mockUniversalScripts,
  };
  assert.equal(pagePayload.page, 1);
  assert.equal(pagePayload.total, 1);
  assert.equal(pagePayload.scripts.length, 3);
});

test("fetchScriptSupportedGames resolves supported Roblox games for universal/hub scripts", async () => {
  // Test with YARHM universal script MongoDB ID: 661abe141431aff595533655
  const supported = await fetchScriptSupportedGames("661abe141431aff595533655");

  assert.ok(Array.isArray(supported), "Supported games must be an array");
  assert.ok(supported.length > 0, "YARHM hub must support at least 1 game");

  const ftf = supported.find(
    (g) => g.gameId === 893973440 || g.name?.includes("Facility"),
  );
  assert.ok(ftf, "Must contain Flee the Facility (893973440)");
  assert.equal(ftf.placeId, 893973440);
  assert.ok(ftf.name.length > 0);
  assert.ok(typeof ftf.imageUrl === "string");
});

test("enrichRawScriptPlaceIds normalizes hub scripts and resolves place IDs", () => {
  const mockScripts = [
    // Case 1: Universal flag
    { title: "Universal Fly", isUniversal: true, game: { gameId: 0 } },
    // Case 2: Hub script with gameId -1
    { title: "YARHM Hub", game: { gameId: -1, name: "Universal" } },
    // Case 3: Script with placeId in image URL
    {
      title: "NDS Auto Win",
      image: "https://scriptblox.com/images/script/189707-1644958680318.png",
      game: {},
    },
    // Case 4: Game script with default placeId fallback
    { title: "Blox Fruits Autofarm", game: {} },
  ];

  enrichRawScriptPlaceIds(mockScripts, 2753915549);

  // Case 1
  assert.equal(mockScripts[0].isUniversal, true);
  assert.equal(mockScripts[0].game.gameId, 0);
  assert.equal(mockScripts[0].game.placeId, 0);

  // Case 2 (Hub script)
  assert.equal(mockScripts[1].isUniversal, true);
  assert.equal(mockScripts[1].isHub, true);
  assert.equal(mockScripts[1].game.gameId, 0);
  assert.equal(mockScripts[1].game.placeId, 0);

  // Case 3 (From image)
  assert.equal(mockScripts[2].game.gameId, 189707);
  assert.equal(mockScripts[2].game.placeId, 189707);

  // Case 4 (From defaultPlaceId)
  assert.equal(mockScripts[3].game.gameId, 2753915549);
  assert.equal(mockScripts[3].game.placeId, 2753915549);
});

test("fetchScriptDetails always provides verified gameId so URLs always contain numeric ID", async () => {
  const listRes = await fetchScripts({ max: 5 });
  assert.ok(listRes.scripts.length > 0);

  for (const s of listRes.scripts) {
    const full = await fetchScriptDetails(s.slug || s._id);
    if (!full) continue;

    if (!full.isUniversal && full.game && full.game.gameId > 0) {
      const canonical = getScriptGameSlug(full.game.gameId, full.game.name);
      assert.ok(
        canonical.startsWith(`${full.game.gameId}-`),
        `Canonical slug ${canonical} must start with gameId ${full.game.gameId}`,
      );
    }
  }
});

test("fetchScriptDetails, fetchAllComments and fetchScriptChangelog provide offline rendering fields", async () => {
  const listRes = await fetchScripts({ max: 3 });
  assert.ok(listRes.scripts.length > 0);

  const sampleScript = listRes.scripts[0];
  const scriptId = sampleScript._id || sampleScript.slug;

  const [details, commentsRes, changelogRes] = await Promise.all([
    fetchScriptDetails(sampleScript.slug || sampleScript._id),
    fetchAllComments(scriptId, 1),
    fetchScriptChangelog(scriptId),
  ]);

  assert.ok(details, "fetchScriptDetails should return script data");
  assert.ok(Array.isArray(commentsRes.comments), "comments must be an array");
  assert.ok(Array.isArray(changelogRes), "changelog must be an array");
});

test("scrapeScriptBloxScriptSitemaps discovers script slugs across all sitemaps", async () => {
  const slugs = await scrapeScriptBloxScriptSitemaps();
  assert.ok(Array.isArray(slugs));
  assert.ok(
    slugs.length > 10000,
    `Expected > 10,000 scripts in sitemaps, got ${slugs.length}`,
  );
  assert.ok(typeof slugs[0] === "string");
});

test("place-to-universe cache persistence saves and restores mappings", async () => {
  // Resolve or insert test mapping
  const uid = await resolvePlaceToUniverse(189707); // Natural Disaster Survival
  assert.ok(typeof uid === "number" && uid > 0);

  savePlaceToUniverseCache();
  const loadedCount = loadPlaceToUniverseCache();
  assert.ok(loadedCount > 0, "Cache should load at least 1 entry from disk");

  // Fast path should return cached value instantly without network call
  const cachedUid = await resolvePlaceToUniverse(189707);
  assert.equal(cachedUid, uid);
});

test("resolveScriptThumbnail uses CDN fallback for /images/no-script.webp and uploads others with process: true", async () => {
  const fallback = await resolveScriptThumbnail("/images/no-script.webp");
  assert.equal(fallback.url, "https://media.kocakz.me/no-script.webp");
  assert.equal(fallback.original, null);
  assert.equal(fallback.scriptblox, null);

  const empty = await resolveScriptThumbnail("");
  assert.equal(empty.url, "https://media.kocakz.me/no-script.webp");

  const nullThumb = await resolveScriptThumbnail(null);
  assert.equal(nullThumb.url, "https://media.kocakz.me/no-script.webp");
});

test("resolveScriptThumbnail converts /images/sb/ to /images/script/ for scriptblox property", async () => {
  const res = await resolveScriptThumbnail("https://scriptblox.com/images/sb/-1-1790125848725.png");
  assert.equal(typeof res, "object");
  assert.equal(res.original, "https://scriptblox.com/images/sb/-1-1790125848725.png");
  assert.equal(res.scriptblox, "https://scriptblox.com/images/script/-1-1790125848725.png");
  assert.ok(typeof res.url === "string");
});

test("resolveAvatarThumbnail uses CDN fallback for /images/user-default.webp and uploads others with process: false", async () => {
  const fallback = await resolveAvatarThumbnail("/images/user-default.webp");
  assert.equal(fallback.url, "https://media.kocakz.me/no-profile.webp");
  assert.equal(fallback.original, null);

  const empty = await resolveAvatarThumbnail(null);
  assert.equal(empty.url, "https://media.kocakz.me/no-profile.webp");
});

test("resolveGameThumbnail checks candidate reachability via HEAD and falls back to no-game.webp when all fail", async () => {
  const allFail = await resolveGameThumbnail([
    "https://example.com/non-existent-image-12345.png",
    "https://example.com/another-broken-404.jpg",
  ]);
  assert.equal(allFail.url, "https://media.kocakz.me/no-game.webp");
  assert.equal(allFail.original, null);

  const emptyList = await resolveGameThumbnail([]);
  assert.equal(emptyList.url, "https://media.kocakz.me/no-game.webp");
});

test("resolveGameThumbnail uploads reachable URL and returns full CDN URL", async () => {
  const res = await resolveGameThumbnail([
    "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/150/150/Image/Png/noFilter",
  ]);
  assert.ok(typeof res === "object");
  assert.ok(typeof res.url === "string");
  assert.match(res.url, /^https:\/\/media\.kocakz\.me\/.+\.webp$/);
  assert.ok(typeof res.original === "string");
});

test("migrateCacheFile converts cdn.kocakz.me/images/ entries to media.kocakz.me/", async () => {
  const { migrateCacheFile } = await import("../src/utils/migrate-cache.js");
  const tempCachePath = path.resolve(ROOT_DIR, ".cache", "test-migrate.json");
  
  fs.writeFileSync(
    tempCachePath,
    JSON.stringify({
      "raw::https://example.com/thumb.png": "https://cdn.kocakz.me/images/12345.webp",
      "script::https://example.com/banner.png": "https://media.kocakz.me/67890.webp",
    }),
    "utf-8"
  );

  const res = migrateCacheFile(tempCachePath);
  assert.equal(res.total, 2);
  assert.equal(res.migrated, 1);

  const updated = JSON.parse(fs.readFileSync(tempCachePath, "utf-8"));
  assert.equal(updated["raw::https://example.com/thumb.png"], "https://media.kocakz.me/12345.webp");
  assert.equal(updated["script::https://example.com/banner.png"], "https://media.kocakz.me/67890.webp");

  fs.unlinkSync(tempCachePath);
});



