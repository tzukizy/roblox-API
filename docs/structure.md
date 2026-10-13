# JSON Structure & Data Schema Documentation

This document describes the JSON schema and type definitions for all datasets available in `roblox-API`.

All files can be fetched directly without a CDN or via public Git CDN providers:
- **Direct GitHub Raw (w/o CDN)**: `https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/<path>`
- **jsDelivr CDN**: `https://cdn.jsdelivr.net/gh/tzukizy/roblox-API@main/data/<path>`
- **Statically CDN**: `https://cdn.statically.io/gh/tzukizy/roblox-API@main/data/<path>`
- **GitHack CDN**: `https://raw.githack.com/tzukizy/roblox-API/main/data/<path>`

---

## 🖼️ Image Object Types

All images in the dataset are structured objects:

### Standard Image Object
Used for **Game Thumbnails**, **User Profiles / Avatars**, and **Executor Logos**:
```json
{
  "url": "string (url)",
  "original": "string (url) | null"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` | CDN-hosted image URL. |
| `original` | `string \| null` | Original image URL before CDN processing (`null` if fallback placeholder). |

### Script Image Object
Used for **Script Thumbnails** (`thumbnail` and `image`):
```json
{
  "url": "string (url)",
  "original": "string (url) | null",
  "scriptblox": "string (url) | null"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` | CDN-hosted image URL. |
| `original` | `string \| null` | Original image URL. |
| `scriptblox` | `string \| null` | Direct script image URL. |

---

## 📁 Directory Structure Overview

```text
data/
├── manifest.json                  # Metadata, duration, and directory stats
│
├── home/
│   ├── trending.json              # Featured trending games (Array of Game objects)
│   ├── topscript.json             # Top executed scripts (Array of Script objects)
│   ├── latest.json                # Latest scripts summary (Page 1)
│   └── latest/                    # Paginated latest scripts (20 per page)
│       ├── 1.json
│       ├── 2.json
│       └── [page].json
│
├── script/
│   └── [hash].json                # Detailed script file (filename = sha256(slug) + ".json")
│
├── game/
│   ├── games.json                 # Directory page 1 (24 games per page)
│   ├── games/
│   │   ├── 1.json
│   │   └── [page].json            # Paginated game directory
│   ├── [id].json                  # Individual game metadata by place ID
│   ├── [id]/
│   │   ├── 1.json
│   │   └── [page].json            # Paginated scripts belonging to a specific game
│   ├── universal.json             # Universal / multi-game script catalog entity
│   ├── universal/
│   │   └── [page].json            # Paginated universal scripts
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
│   └── scripts.json               # Universal scripts summary
│
└── executor/
    ├── executors.json             # Complete list of executors
    └── [name].json                # Individual executor specification
```

---

## 🎮 Game Schemas

### 1. Unified Game Entity (`data/game/[id].json`, `data/game/universal.json`)
```json
{
  "id": "number",
  "name": "string",
  "desc": "string",
  "path": "string",
  "slug": "string",
  "thumbnail": {
    "url": "string (url)",
    "original": "string (url) | null"
  },
  "playing": "number",
  "visitor": "number",
  "verified": "boolean",
  "updatedAt": "string (ISO 8601)",
  "creator": {
    "name": "string",
    "type": "\"User\" | \"Group\" | \"Community\""
  },
  "script": {
    "count": "number",
    "freeCount": "number",
    "keyCount": "number",
    "verifiedCount": "number"
  }
}
```

### 2. Paginated Games Catalog (`data/game/games.json`, `data/game/games/[page].json`)
```json
{
  "games": [
    /* Array of Unified Game Entities */
  ],
  "total": "number",
  "currentPage": "number",
  "totalPages": "number",
  "hasNextPage": "boolean",
  "hasPrevPage": "boolean",
  "nextPage": "number | null",
  "prevPage": "number | null"
}
```

### 3. Paginated Scripts within a Game (`data/game/[id]/[page].json`)
```json
{
  "id": "number",
  "name": "string",
  "desc": "string",
  "path": "string",
  "slug": "string",
  "thumbnail": {
    "url": "string (url)",
    "original": "string (url) | null"
  },
  "playing": "number",
  "visitor": "number",
  "verified": "boolean",
  "updatedAt": "string (ISO 8601)",
  "creator": {
    "name": "string",
    "type": "\"User\" | \"Group\" | \"Community\""
  },
  "script": {
    "count": "number",
    "freeCount": "number",
    "keyCount": "number",
    "verifiedCount": "number"
  },
  "page": "number",
  "next": "number | null",
  "total": "number",
  "scripts": [
    /* Array of Script Entities */
  ]
}
```

---

## 📜 Script Schemas

### 1. Detailed Script Entity (`data/script/[hash].json`)
```json
{
  "_id": "string",
  "title": "string",
  "slug": "string",
  "game": {
    "name": "string",
    "gameId": "number",
    "placeId": "number",
    "imageUrl": {
      "url": "string (url)",
      "original": "string (url) | null"
    }
  },
  "script": "string",
  "scriptType": "\"free\" | \"paid\"",
  "key": "boolean",
  "keyLink": "string (url) | null",
  "verified": "boolean",
  "views": "number",
  "likeCount": "number",
  "dislikeCount": "number",
  "thumbnail": {
    "url": "string (url)",
    "original": "string (url) | null",
    "scriptblox": "string (url) | null"
  },
  "image": {
    "url": "string (url)",
    "original": "string (url) | null",
    "scriptblox": "string (url) | null"
  },
  "owner": {
    "_id": "string",
    "username": "string",
    "profile": {
      "url": "string (url)",
      "original": "string (url) | null"
    },
    "profilePicture": {
      "url": "string (url)",
      "original": "string (url) | null"
    },
    "verified": "boolean"
  },
  "features": ["string"],
  "tags": ["string"],
  "isUniversal": "boolean",
  "isHub": "boolean",
  "supportedGames": [
    {
      "gameId": "number",
      "placeId": "number",
      "name": "string",
      "imageUrl": {
        "url": "string (url)",
        "original": "string (url) | null"
      }
    }
  ],
  "comments": [
    {
      "_id": "string",
      "text": "string",
      "commentBy": {
        "username": "string",
        "profile": {
          "url": "string (url)",
          "original": "string (url) | null"
        }
      },
      "createdAt": "string (ISO 8601)"
    }
  ],
  "changelog": [
    {
      "version": "string",
      "description": "string",
      "updatedAt": "string (ISO 8601)"
    }
  ],
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

### 2. Paginated Script List (`data/home/latest/[page].json`, `data/keyless/pages/[page].json`)
```json
{
  "page": "number",
  "totalPages": "number",
  "scripts": [
    /* Array of Script Entities */
  ]
}
```

---

## ⚡ Executor Schemas

### 1. Executor Entity (`data/executor/executors.json`, `data/executor/[name].json`)
```json
{
  "name": "string",
  "slug": "string",
  "title": "string",
  "description": "string",
  "logo": {
    "url": "string (url)",
    "original": "string (url) | null"
  },
  "thumbnail": {
    "url": "string (url)",
    "original": "string (url) | null",
    "scriptblox": "string (url) | null"
  },
  "status": "\"Updated\" | \"Updating\" | \"Patched\"",
  "sunc": "number",
  "weao": "string",
  "downloadUrl": "string (url)",
  "platform": "\"Windows\" | \"Android\" | \"iOS\" | \"Mac\""
}
```

---

## 📊 Trending & Leaderboard Schemas

### Leaderboard Entity (`data/trending/[period].json`)
`[period]` can be `"day"`, `"week"`, `"month"`, or `"all"`.

```json
{
  "period": "\"day\" | \"week\" | \"month\" | \"all\"",
  "leaderboard": {
    "boards": {
      "scripts": {
        "executes": [
          /* Array of Script Entities */
        ]
      },
      "creators": {
        "likes": [
          {
            "username": "string",
            "likes": "number",
            "profile": {
              "url": "string (url)",
              "original": "string (url) | null"
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
  "updatedAt": "string (ISO 8601)",
  "durationSeconds": "number",
  "stats": {
    "gamesScraped": "number",
    "gamePagesCreated": "number",
    "gameDetailsCreated": "number",
    "gameScriptPagesCreated": "number",
    "scriptsScraped": "number",
    "individualScriptsSaved": "number",
    "executorsScraped": "number",
    "leaderboardsScraped": "number",
    "latestPagesScraped": "number"
  },
  "structure": {
    "home": {
      "trending": "string",
      "topscript": "string",
      "latest": "string",
      "latestPages": "string"
    },
    "script": {
      "detail": "string"
    },
    "game": {
      "games": "string",
      "pages": "string",
      "detail": "string",
      "scripts": "string",
      "universal": "string",
      "universalPages": "string"
    },
    "trending": {
      "day": "string",
      "week": "string",
      "month": "string",
      "all": "string"
    },
    "keyless": {
      "scripts": "string",
      "pages": "string"
    },
    "universal": {
      "scripts": "string"
    },
    "executor": {
      "executors": "string",
      "spec": "string"
    }
  }
}
```
