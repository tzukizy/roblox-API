# Roblox Dataset API (`roblox-API`)

A static, publicly accessible JSON dataset providing Roblox experiences, scripts, executors, and leaderboard records. All data can be fetched directly from GitHub Raw or via fast Git CDN providers with zero rate limits, no API keys, and no server setup needed.

---

## 🌐 Base URLs

You can consume any file in this repository either directly (without a CDN) or through public Git CDNs for edge caching:

| Provider | Access Mode | Base URL |
| :--- | :--- | :--- |
| **GitHub Raw** | **Direct (w/o CDN)** | `https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/` |
| **jsDelivr** | **CDN** | `https://cdn.jsdelivr.net/gh/tzukizy/roblox-API@main/data/` |
| **Statically** | **CDN** | `https://cdn.statically.io/gh/tzukizy/roblox-API@main/data/` |
| **GitHack** | **CDN** | `https://raw.githack.com/tzukizy/roblox-API/main/data/` |

---

## 🖼️ Image Structure & Usage

All images across the dataset (game thumbnails, script thumbnails, user avatars, executor logos) are structured as objects providing both CDN-hosted and original source URLs:

### Standard Image Format (Games, Avatars, Logos)
```json
{
  "url": "string (url)",
  "original": "string (url) | null"
}
```

### Script Image Format (Script Thumbnails)
```json
{
  "url": "string (url)",
  "original": "string (url) | null",
  "scriptblox": "string (url) | null"
}
```

### How to Consume Images

- **Using CDN Image**:
  ```javascript
  const imageUrl = item.thumbnail.url;
  ```

- **Without CDN (Direct Origin Image)**:
  ```javascript
  // Fall back to url if original is null (e.g. default placeholder)
  const imageUrl = item.thumbnail.original || item.thumbnail.url;

  // Or for script thumbnails:
  const scriptImageUrl = item.thumbnail.scriptblox || item.thumbnail.original;
  ```

---

## 📑 Endpoints & File Directory

Fetch any dataset by appending its path to your chosen Base URL:

$$\text{Request URL} = \text{<Base URL>} + \text{<path>}$$

### 🎮 Games (`/game`)
| Path | Description |
| :--- | :--- |
| `game/games.json` | First page of games catalog (24 games, sorted descending by active players). |
| `game/games/{page}.json` | Paginated catalog (`1.json`, `2.json`, ...). |
| `game/{id}.json` | Individual game metadata by numeric place ID. |
| `game/{id}/{page}.json` | Paginated scripts belonging to a specific game. |
| `game/universal.json` | Universal catalog entity for multi-game scripts and admin panels. |
| `game/universal/{page}.json` | Paginated universal scripts (`1.json`, `2.json`, ...). |

### 📜 Scripts (`/script` & `/home`)
| Path | Description |
| :--- | :--- |
| `home/trending.json` | Featured trending games list. |
| `home/topscript.json` | Top executed scripts list. |
| `home/latest.json` | Page 1 summary of latest published scripts. |
| `home/latest/{page}.json` | Paginated latest scripts (`1.json`, `2.json`, ...). |
| `keyless/scripts.json` | Overview of scripts that do not require an execution key. |
| `keyless/pages/{page}.json`| Paginated keyless scripts (`1.json`, `2.json`, ...). |
| `verified/scripts.json` | Overview of verified community scripts. |
| `verified/pages/{page}.json`| Paginated verified scripts (`1.json`, `2.json`, ...). |
| `unpatched/scripts.json` | Overview of unpatched/working scripts (`patched: 0`). |
| `unpatched/pages/{page}.json`| Paginated unpatched scripts (`1.json`, `2.json`, ...). |
| `script/{hash}.json` | Detailed script file (full Lua code, author profile, changelog, comments). |

> **Note on Script Filenames**: Detailed scripts under `script/` are indexed by the SHA-256 hash of their slug:
> $$\text{filename} = \text{sha256}(\text{slug}) + \text{".json"}$$

### ⚡ Executors (`/executor`)
| Path | Description |
| :--- | :--- |
| `executor/executors.json` | Complete list of executors with sUNC scores and status. |
| `executor/{name}.json` | Individual executor specifications by slug. |

### 📊 Trending & Leaderboards (`/trending`)
| Path | Description |
| :--- | :--- |
| `trending/day.json` | Daily leaderboard. |
| `trending/week.json` | Weekly leaderboard. |
| `trending/month.json` | Monthly leaderboard. |
| `trending/all.json` | All-time leaderboard. |

---

## 💻 Quick Code Examples

### JavaScript / TypeScript
```javascript
// Example using jsDelivr CDN
const BASE_URL = "https://cdn.jsdelivr.net/gh/tzukizy/roblox-API@main/data";

// 1. Fetch paginated games catalog
async function getGames(page = 1) {
  const res = await fetch(`${BASE_URL}/game/games/${page}.json`);
  const data = await res.json();
  return data.games;
}

// 2. Fetch specific script details by slug
async function getScriptBySlug(slug) {
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256").update(slug).digest("hex");
  const res = await fetch(`${BASE_URL}/script/${hash}.json`);
  return await res.json();
}
```

### Python
```python
import hashlib
import requests

# Example without CDN (Direct GitHub Raw)
BASE_URL = "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data"

# Fetch latest scripts
res = requests.get(f"{BASE_URL}/home/latest/1.json")
scripts = res.json()["scripts"]

for item in scripts:
    title = item["title"]
    # With CDN:
    cdn_thumb = item["thumbnail"]["url"]
    # Without CDN:
    direct_thumb = item["thumbnail"].get("original") or cdn_thumb
    print(f"{title}: {direct_thumb}")
```

### cURL
```bash
# Fetch games catalog (w/o CDN via GitHub Raw)
curl -s "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/game/games.json"

# Fetch games catalog (with CDN via jsDelivr)
curl -s "https://cdn.jsdelivr.net/gh/tzukizy/roblox-API@main/data/game/games.json"
```

---

## 📖 Complete JSON Schema Specification

For detailed field definitions, TypeScript types, and enums (`"free" | "paid"`, `"User" | "Group"`, etc.) across all models, see:

👉 **[docs/structure.md](docs/structure.md)**

---

## 📄 License

MIT License
