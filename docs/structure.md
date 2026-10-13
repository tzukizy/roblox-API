# JSON Structure & Data Schema Documentation

This document describes the complete JSON structure and schema specifications for all datasets available in the `roblox-API` repository.

All files are statically served from the GitHub Raw repository under the `/data/` directory:
```text
https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/<path>
```

---

## 🖼️ Image Object Schema

All images across games, scripts, profiles, and executors are stored as structured objects rather than raw strings. This gives consumers complete flexibility to load images through our optimized CDN or directly from original source URLs.

### Standard Image Object
Used for **Game Thumbnails**, **User Profiles / Avatars**, and **Executor Logos**:
```json
{
  "url": "https://cdn.kocakz.me/images/a1b2c3d4e5f6.webp",
  "original": "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/150/150/Image/Png/noFilter"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` | High-performance, compressed WebP image hosted on the CDN. |
| `original` | `string \| null` | Direct origin URL before CDN processing. `null` if fallback placeholder. |

### Script Image Object
Used specifically for **Script Thumbnails** (`thumbnail` and `image`):
```json
{
  "url": "https://cdn.kocakz.me/images/f9e8d7c6b5a4.webp",
  "original": "https://scriptblox.com/images/sb/-1-1790125848725.png",
  "scriptblox": "https://scriptblox.com/images/script/-1-1790125848725.png"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` | High-performance, compressed WebP image hosted on the CDN. |
| `original` | `string \| null` | Raw source URL uploaded to the CDN. |
| `scriptblox` | `string \| null` | Direct script image URL with `/images/sb/` replaced by `/images/script/`. |

---

## 📁 Directory Structure Overview

```text
data/
├── manifest.json                  # Pipeline metadata, stats, and endpoint structure
│
├── home/
│   ├── trending.json              # Top trending games (array of Game objects)
│   ├── topscript.json             # Top executed scripts (array of Script objects)
│   ├── latest.json                # Latest scripts summary (Page 1)
│   └── latest/                    # Paginated latest scripts
│       ├── 1.json
│       ├── 2.json
│       └── [page].json            # 20 scripts per page
│
├── script/
│   └── [hash].json                # Full script details (filename is SHA-256 of the slug)
│
├── game/
│   ├── games.json                 # Directory page 1 (24 games, sorted descending by players)
│   ├── games/
│   │   ├── 1.json
│   │   └── [page].json            # Paginated game catalog (24 games per page)
│   ├── [id].json                  # Individual game metadata by Roblox place ID
│   ├── [id]/
│   │   ├── 1.json
│   │   └── [page].json            # Paginated scripts for a specific game (20 per page)
│   ├── universal.json             # Universal / multi-game script catalog entity
│   ├── universal/
│   │   └── [page].json            # Paginated universal scripts (20 per page)
│   ├── 0.json                     # Alias to universal.json
│   └── 0/                         # Alias to universal/
│
├── trending/
│   ├── index.json                 # Trending overview
│   ├── day.json                   # Daily leaderboard
│   ├── week.json                  # Weekly leaderboard
│   ├── month.json                 # Monthly leaderboard
│   └── all.json                   # All-time leaderboard
│
├── keyless/
│   ├── scripts.json               # Keyless scripts summary
│   └── pages/[page].json          # Paginated keyless scripts (20 per page)
│
├── universal/
│   └── scripts.json               # Aggregated universal scripts summary
│
└── executor/
    ├── executors.json             # Complete list of executors
    └── [name].json                # Per-executor detailed specs
```

---

## 🎮 Game Schemas

### 1. Unified Game Entity (`data/game/[id].json`, `data/game/universal.json`)
```json
{
  "id": 189707,
  "name": "Natural Disaster Survival",
  "desc": "Quickly, run around in circles! Your life depends on it!",
  "path": "/game/189707-natural-disaster-survival",
  "slug": "189707-natural-disaster-survival",
  "thumbnail": {
    "url": "https://cdn.kocakz.me/images/a1b2c3d4e5f6.webp",
    "original": "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/150/150/Image/Png/noFilter"
  },
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

### 2. Paginated Games Directory (`data/game/games.json`, `data/game/games/[page].json`)
```json
{
  "games": [
    /* Array of Unified Game Entities (24 per page) */
  ],
  "total": 7600,
  "currentPage": 1,
  "totalPages": 320,
  "hasNextPage": true,
  "hasPrevPage": false,
  "nextPage": 2,
  "prevPage": null
}
```

### 3. Paginated Scripts for a Game (`data/game/[id]/[page].json`)
```json
{
  "id": 189707,
  "name": "Natural Disaster Survival",
  "desc": "Quickly, run around in circles! Your life depends on it!",
  "path": "/game/189707-natural-disaster-survival",
  "slug": "189707-natural-disaster-survival",
  "thumbnail": {
    "url": "https://cdn.kocakz.me/images/a1b2c3d4e5f6.webp",
    "original": "https://tr.rbxcdn.com/..."
  },
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
  },
  "page": 1,
  "next": 2,
  "total": 12,
  "scripts": [
    /* Array of complete Script Entities (up to 20 per page) */
  ]
}
```

---

## 📜 Script Schemas

### 1. Detailed Script Entity (`data/script/[hash].json`)
Each file is stored under `data/script/<hash>.json`, where `<hash>` is the SHA-256 hash of the script's `slug`.

```json
{
  "_id": "661abe141431aff595533655",
  "title": "Natural Disaster Survival Autofarm",
  "slug": "natural-disaster-survival-autofarm",
  "game": {
    "name": "Natural Disaster Survival",
    "gameId": 189707,
    "placeId": 189707,
    "imageUrl": {
      "url": "https://cdn.kocakz.me/images/e5f6a1b2c3d4.webp",
      "original": "https://tr.rbxcdn.com/..."
    }
  },
  "script": "loadstring(game:HttpGet('https://example.com/script.lua'))()",
  "scriptType": "free",
  "key": false,
  "keyLink": "",
  "verified": true,
  "views": 15420,
  "likeCount": 352,
  "dislikeCount": 12,
  "thumbnail": {
    "url": "https://cdn.kocakz.me/images/f9e8d7c6b5a4.webp",
    "original": "https://scriptblox.com/images/sb/-1-1790125848725.png",
    "scriptblox": "https://scriptblox.com/images/script/-1-1790125848725.png"
  },
  "image": {
    "url": "https://cdn.kocakz.me/images/f9e8d7c6b5a4.webp",
    "original": "https://scriptblox.com/images/sb/-1-1790125848725.png",
    "scriptblox": "https://scriptblox.com/images/script/-1-1790125848725.png"
  },
  "owner": {
    "_id": "642a8b9f1234567890abcdef",
    "username": "ScriptDeveloper",
    "profile": {
      "url": "https://cdn.kocakz.me/images/1234abcd5678.webp",
      "original": "https://..."
    },
    "profilePicture": {
      "url": "https://cdn.kocakz.me/images/1234abcd5678.webp",
      "original": "https://..."
    },
    "verified": true
  },
  "features": ["Auto Farm", "Teleport", "Item ESP"],
  "tags": ["survival", "autofarm", "esp"],
  "isUniversal": false,
  "isHub": false,
  "supportedGames": [],
  "comments": [
    {
      "_id": "c101",
      "text": "Works perfectly on Solara!",
      "commentBy": {
        "username": "Tester123",
        "profile": {
          "url": "https://cdn.kocakz.me/images/avatar99.webp",
          "original": "https://..."
        }
      },
      "createdAt": "2026-09-15T12:00:00.000Z"
    }
  ],
  "changelog": [
    {
      "version": "1.2.0",
      "description": "Added new teleport locations",
      "updatedAt": "2026-09-10T08:00:00.000Z"
    }
  ],
  "createdAt": "2026-04-13T16:50:28.000Z",
  "updatedAt": "2026-09-20T10:15:00.000Z"
}
```

### 2. Paginated Script List (`data/home/latest/[page].json`, `data/keyless/pages/[page].json`)
```json
{
  "page": 1,
  "totalPages": 3686,
  "scripts": [
    /* Array of Script Entities (20 per page) */
  ]
}
```

---

## ⚡ Executor Schemas

### 1. Executors List (`data/executor/executors.json`) & Spec (`data/executor/[name].json`)
```json
{
  "name": "Wave",
  "slug": "wave",
  "title": "Wave Executor",
  "description": "Fast and powerful Windows script executor.",
  "logo": {
    "url": "https://cdn.kocakz.me/images/wave_logo.webp",
    "original": "https://example.com/wave-icon.png"
  },
  "thumbnail": {
    "url": "https://cdn.kocakz.me/images/wave_banner.webp",
    "original": "https://example.com/wave-banner.png",
    "scriptblox": "https://example.com/wave-banner.png"
  },
  "status": "Updated",
  "sunc": 98,
  "weao": "Working",
  "downloadUrl": "https://example.com/download",
  "platform": "Windows"
}
```

---

## 📊 Trending & Leaderboard Schemas

### Leaderboard Entity (`data/trending/[period].json`)
Periods: `day`, `week`, `month`, `all`.

```json
{
  "period": "day",
  "leaderboard": {
    "boards": {
      "scripts": {
        "executes": [
          /* Array of Script Entities ranked by execution count */
        ]
      },
      "creators": {
        "likes": [
          {
            "username": "TopCreator",
            "likes": 1420,
            "profile": {
              "url": "https://cdn.kocakz.me/images/creator1.webp",
              "original": "https://..."
            }
          }
        ]
      }
    }
  }
}
```

---

## 📋 Manifest Schema (`data/manifest.json`)
```json
{
  "updatedAt": "2026-10-14T02:50:00.000Z",
  "durationSeconds": 182,
  "stats": {
    "gamesScraped": 7733,
    "gamePagesCreated": 323,
    "gameDetailsCreated": 7733,
    "gameScriptPagesCreated": 1450,
    "scriptsScraped": 73933,
    "individualScriptsSaved": 73933,
    "executorsScraped": 31,
    "leaderboardsScraped": 4,
    "latestPagesScraped": 3697
  },
  "structure": {
    "home": {
      "trending": "data/home/trending.json",
      "topscript": "data/home/topscript.json",
      "latest": "data/home/latest.json",
      "latestPages": "data/home/latest/{page}.json"
    },
    "script": {
      "detail": "data/script/{hash}.json"
    },
    "game": {
      "games": "data/game/games.json",
      "pages": "data/game/games/{page}.json",
      "detail": "data/game/{id}.json",
      "scripts": "data/game/{id}/{page}.json",
      "universal": "data/game/universal.json",
      "universalPages": "data/game/universal/{page}.json"
    },
    "trending": {
      "day": "data/trending/day.json",
      "week": "data/trending/week.json",
      "month": "data/trending/month.json",
      "all": "data/trending/all.json"
    },
    "keyless": {
      "scripts": "data/keyless/scripts.json",
      "pages": "data/keyless/pages/{page}.json"
    },
    "universal": {
      "scripts": "data/universal/scripts.json"
    },
    "executor": {
      "executors": "data/executor/executors.json",
      "spec": "data/executor/{name}.json"
    }
  }
}
```
