# Roblox & ScriptBlox Scraper API (`roblox-API`)

An automated Node.js scraping pipeline and GitHub Actions workflow. Aggregates and enriches live game, exploit, and script data from **Rolimons**, **ScriptBlox**, and official **Roblox APIs**, publishing static JSON datasets directly into `./data/`.

These JSON files replace dynamic upstream requests across `WebAuth/src/app/script*` pages, completely eliminating 429 rate limit issues, timeouts, and bot-detection blocks. If an item is ever missing from GitHub data, your application can fall back to the live API.

---

## 🖼️ Game Image Priority Order & Normalization

When resolving images for games and experiences, the scraper strictly enforces this priority order:

1. **Roblox API**: Live Roblox Thumbnails API icon (`https://tr.rbxcdn.com/...`), with dimensions normalized to `150/150` via regex `.replace(/^(https:\/\/tr\.rbxcdn\.com\/[^/]+\/)\d+\/\d+(\/.*)$/, "$1150/150$2")`.
2. **Rolimons**: Rolimons game thumbnail (`.png`, then `.webp`).
3. **ScriptBlox**: Game thumbnail or script image from ScriptBlox CDN.
4. **Fallback**: `/brand/kocakz-logo.png`.

---

## 🎮 Unified Game Schema

Every game across `/game/games.json`, `/game/games/[page].json`, `/game/[id].json`, and `/home/trending.json` conforms to this exact schema:

```json
{
  "id": 189707,
  "name": "Natural Disaster Survival",
  "desc": "Quickly, run around in circles! Your life depends on it!",
  "path": "/game/189707-natural-disaster-survival",
  "slug": "189707-natural-disaster-survival",
  "thumbnail": [
    "https://tr.rbxcdn.com/180DAY-7ea7065a02f8cff80f8b0270a9ad2d3b/150/150/Image/Png/noFilter",
    "https://assets.rolimons.com/Image/Png/189707.png",
    "https://scriptblox.com/images/...",
    "/brand/kocakz-logo.png"
  ],
  "playing": 5781,
  "visitor": 4502938627,
  "verified": true,
  "updatedAt": "2026-10-08T07:02:04.664Z",
  "creator": {
    "name": "Stickmasterluke",
    "type": "User"
  },
  "script": {
    "count": 229,
    "freeCount": 229,
    "keyCount": 29,
    "verifiedCount": 7
  }
}
```

If a game has scripts (`script.count > 0`), paginated pages are generated under `/data/game/[id]/[page].json` adding:

```json
{
  "...": "...(all game metadata above)",
  "page": 1,
  "next": 2,
  "total": 12,
  "scripts": [
    /* 100% complete Script entities */
  ]
}
```

---

## 🔑 100% Complete Script Details via `https://scriptblox.com/api/script/[slug]`

Unlike the basic `/api/script/fetch` endpoint (which omits Lua code, features, owner profiles, and discord/key links), the scraper fetches each script using **`https://scriptblox.com/api/script/[slug]`** to capture the full script entity:

- `script.script`: Raw Lua code string for execution
- `features` & `tags`
- `owner`: Detailed creator profile with milestones
- `discord` & `keyLink`
- `likeCount` & `dislikeCount`
- `game.gameId` / `game.placeId`: Verified Roblox place ID

Scripts are stored under `/data/script/[hash].json` using a deterministic 64-character SHA-256 hash:

$$\text{filename} = \text{sha256}(\text{slug}) + \text{".json"}$$

---

## 🎯 Native Game ID Guarantee (Why WebAuth's Missing ID Bug is Solved)

In WebAuth, game URLs were previously generated as pure slugs without an ID (e.g. `/script/game/huss-valley` instead of `/script/game/107535308163741-huss-valley`).

This occurred because WebAuth previously called the upstream `/api/script/fetch` endpoint, which omits `game.gameId` in its lightweight list response. When WebAuth rendered script cards, `getScriptGameSlug(script.game?.gameId, script.game?.name)` received `undefined` for `gameId` and was forced to output a pure slug without an ID.

### How the Scraper Solves This at the Root

The scraper fetches full script details using `https://scriptblox.com/api/script/[slug]`. This endpoint **always includes the verified numeric `game.gameId`**:

- Every script in `/data/home/latest.json`, `/data/home/topscript.json`, `/data/trending/*.json`, and `/data/game/*` has `game.gameId` and `game.placeId` populated (`107535308163741` for Huss Valley, `16146832113` for Anime Vanguards, `0` for Universal).
- When WebAuth renders script cards from this data, `getScriptGameSlug(script.game.gameId, script.game.name)` always outputs the canonical URL:
  $$\text{/script/game/107535308163741-huss-valley}$$
- Pure slugs without an ID are **never generated anywhere on the website in the first place**, completely eliminating the need for runtime sitemap lookups or external slug maps.

---

## 🌐 Universal & Script Hubs (`gameId: -1` or `0`)

Scripts with `gameId: -1`, `gameId: 0`, or `isUniversal: true` (such as multi-game hubs like _YARHM_, _V.G Hub_, or admin command panels like _Infinite Yield_):

1. **Classified & Normalized**: Normalized with `isUniversal: true`, `isHub: true`, `game.gameId: 0`, and `game.placeId: 0`.
2. **Supported Games Resolution**: The scraper calls `https://scriptblox.com/api/script/games/[scriptId]` to resolve all Roblox games supported by the hub script.
3. **Cross-Indexed**:
   - The script is included in `/data/game/universal.json` and paginated in `/data/game/universal/[page].json` (aliased to `/data/game/0.json`).
   - The script is **cross-indexed** into each supported game's page (e.g. _Flee the Facility_ `893973440` and _Murder Mystery 2_ `91595887553937`), ensuring users viewing individual game pages also discover supported hub scripts.

---

## 📁 Data Directory Structure (`./data`)

```text
data/
├── manifest.json                  # Metadata, duration, total counts, timestamp
│
├── home/                          # Home "/script"
│   ├── trending.json              # Top trending games (array of UnifiedGame)
│   ├── topscript.json             # Top executed scripts (complete Script entities)
│   ├── latest.json                # Latest scripts summary (page 1)
│   └── latest/                    # Paginated latest scripts (up to 3,686 pages from sitemaps)
│       ├── 1.json
│       ├── 2.json
│       └── ...[1-3686].json       # Split 20 scripts per page discovering all 73,700+ scripts
│
├── script/                        # Script "/script/:slug"
│   └── [hash].json                # Fixed 64-char hex hash file per script (full Lua code, changelog, comments, author)
│
├── game/                          # Games "/script/game" & Game "/script/game/:id+gameSlug"
│   ├── games.json                 # Page 1 of games directory (24 games, sorted descending by active players)
│   ├── games/                     # Paginated game directory (all 7,600+ games, 24 games per page)
│   │   ├── 1.json                 # Page 1 (identical to games.json)
│   │   ├── 2.json                 # Page 2
│   │   └── ...[1-320+].json       # All pages covering all 7,600+ experiences from Rolimons
│   ├── [id].json                  # Complete UnifiedGame metadata object
│   ├── [id]/                      # Paginated scripts for games where script.count > 0 (includes hub scripts)
│   │   ├── 1.json                 # UnifiedGame + page: 1, next: 2, total: N, scripts: [...]
│   │   └── ...[page].json
│   ├── universal.json             # Universal Scripts game metadata entity (acts like a game)
│   ├── universal/                 # Paginated universal scripts (/script/game/universal)
│   │   ├── 1.json                 # UnifiedGame + page: 1, next: 2, total: N, scripts: [...]
│   │   └── ...[page].json
│   ├── 0.json                     # Alias to universal.json
│   └── 0/                         # Alias to universal/
│
├── trending/                      # Leaderboards "/script/trending" (gameId & placeId fixed)
│   ├── index.json                 # Overview
│   ├── day.json                   # Today's top scripts & creators
│   ├── week.json                  # Weekly leaderboard
│   ├── month.json                 # Monthly leaderboard
│   └── all.json                   # All-time leaderboard
│
├── keyless/                       # Keyless "/script/keyless"
│   ├── scripts.json               # Aggregated keyless scripts
│   └── pages/[page].json          # Paginated keyless scripts
│
├── universal/                     # Legacy universal scripts path
│   └── scripts.json               # Aggregated universal scripts
│
└── executor/                      # Executors "/script/executor"
    ├── executors.json             # All 31 executors with sUNC and WEAO status
    └── [name].json                # Per-executor detailed specs
```

---

## 🎮 How WebAuth Loads Paginated Games (`/script/game`)

```typescript
import { fetchPaginatedGames, PaginatedGamesResult } from "@/lib/rolimons";

const DATA_BASE_URL =
  "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data";

export async function getPaginatedGames(
  page = 1,
  pageSize = 24,
): Promise<PaginatedGamesResult> {
  const url =
    page === 1
      ? `${DATA_BASE_URL}/game/games.json`
      : `${DATA_BASE_URL}/game/games/${page}.json`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(
      `[GitHub Data] Failed to fetch page ${page}, using API fallback:`,
      err,
    );
  }

  // Fallback to live Rolimons + Roblox API
  return await fetchPaginatedGames(page, pageSize);
}
```

---

## 🚀 How It Replaces `WebAuth/src/app/script*`

| WebAuth Page / Route          | Original Function                         | Scraped JSON Source                                              | Fallback Behavior                                  |
| :---------------------------- | :---------------------------------------- | :--------------------------------------------------------------- | :------------------------------------------------- |
| **`/script` (Home)**          | `fetchTrendingGames(8)`                   | `data/home/trending.json`                                        | Call `fetchTrendingGames(8)`                       |
| **`/script` (Home)**          | `fetchTopExecutedScripts(8)`              | `data/home/topscript.json`                                       | Call `fetchTopExecutedScripts(8)`                  |
| **`/script` (Home)**          | `fetchScripts(options)`                   | `data/home/latest.json` or `data/home/latest/[page].json`        | Call `fetchScripts(options)`                       |
| **`/script/[slug]`**          | `fetchScriptDetailed(slug)`               | `data/script/[hash].json`                                        | Call `fetchScriptDetailed(slug)`                   |
| **`/script/game`**            | `fetchPaginatedGames(page, 24)`           | `data/game/games.json` (page 1) or `data/game/games/[page].json` | Call `fetchPaginatedGames(page, 24)`               |
| **`/script/game/:id+slug`**   | `fetchRobloxGameDetails` + `fetchScripts` | `data/game/[id].json`                                            | Call `fetchGameSummary` + `fetchRobloxGameDetails` |
| **`/script/game/universal`**  | `fetchScripts({ universal: 1 })`          | `data/game/universal.json` or `data/game/universal/[page].json`  | Call `fetchScripts({ universal: 1 })`              |
| **`/script/trending`**        | `fetchLeaderboard(period)`                | `data/trending/[period].json`                                    | Call `fetchLeaderboard(period)`                    |
| **`/script/keyless`**         | `fetchScripts({ keyless: 1 })`            | `data/keyless/scripts.json`                                      | Call `fetchScripts({ keyless: 1 })`                |
| **`/script/executor`**        | `fetchExecutors()`                        | `data/executor/executors.json`                                   | Call `fetchExecutors()`                            |
| **`/script/executor/[name]`** | `fetchExecutor(name)`                     | `data/executor/[name].json`                                      | Call `fetchExecutor(name)`                         |

---

## 🤖 GitHub Actions Workflow

Configured in `.github/workflows/scrape.yml`:

- **Schedule**: Automatically runs every 3 days (`0 0 */3 * *`).
- **Manual Trigger**: Can be run anytime via the **Run workflow** button on GitHub.
- **Auto-commit**: Pushes `./data/` updates back to the repo with `[skip ci]`.

---

## 🛠️ Local Commands

```powershell
# Run unit and integration tests (fast, consumes zero scrape quota)
npm test

# Run limited test scraper (2 pages scripts, 48 games, 5 Roblox details)
npm run scrape-test

# Run complete scraper locally (discovers all 73,700+ scripts, all 14,000+ games)
npm run scrape

# Optional: Run with custom environment limits
$env:MAX_PAGES = "5"; $env:MAX_CATALOG_GAMES = "48"; npm run scrape
```

---

## 📄 License

MIT License
