# Roblox Dataset API (`roblox-API`)

A static, publicly accessible JSON dataset providing Roblox experiences, scripts, executors, and leaderboard records. All data is served directly through GitHub Raw with zero rate limits, no authentication required, and zero server infrastructure needed.

---

## 🌐 Base URLs

| Service | Base URL | Description |
| :--- | :--- | :--- |
| **GitHub Raw (Data)** | `https://raw.githubusercontent.com/tzukizy/roblox-API/main/data` | Static JSON files containing all games, scripts, and executor data. |
| **Image CDN** | `https://cdn.kocakz.me/images/` | High-performance CDN serving compressed WebP images. |

---

## 🖼️ Working with Images (With CDN vs Without CDN)

All image fields across the dataset (game thumbnails, script thumbnails, user avatars, executor logos) are structured as dedicated objects rather than flat strings:

```json
{
  "url": "https://cdn.kocakz.me/images/a1b2c3d4e5f6.webp",
  "original": "https://tr.rbxcdn.com/180DAY-be85b5af1040324de15123ab4208cf84/150/150/Image/Png/noFilter"
}
```

Script thumbnails additionally provide a `scriptblox` direct URL:
```json
{
  "url": "https://cdn.kocakz.me/images/f9e8d7c6b5a4.webp",
  "original": "https://scriptblox.com/images/sb/-1-1790125848725.png",
  "scriptblox": "https://scriptblox.com/images/script/-1-1790125848725.png"
}
```

### Option 1: Using the CDN (Recommended)
Use `.url` to load optimized, cached WebP images served from our CDN:
```javascript
const imageUrl = script.thumbnail.url;
```

### Option 2: Without CDN (`w/o CDN`)
If you prefer not to depend on our CDN or want direct access to the original source images, use `.original` (or `.scriptblox` for script images):
```javascript
// Direct origin without routing through the CDN:
const imageUrl = script.thumbnail.original || script.thumbnail.url;

// Or for script thumbnails specifically:
const directScriptImage = script.thumbnail.scriptblox || script.thumbnail.original;
```

---

## 📑 Endpoints & File Directory

Fetch any dataset by appending its path to the GitHub Raw base URL:

$$\text{Endpoint URL} = \text{https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/} + \text{path}$$

### 🎮 Games Directory (`/game`)
| Path | Description |
| :--- | :--- |
| `game/games.json` | First page of games catalog (24 games, sorted descending by active players). |
| `game/games/{page}.json` | Paginated catalog (`1.json`, `2.json`, ... covering 7,600+ games). |
| `game/{id}.json` | Individual game metadata by numeric Roblox Place ID (e.g. `189707.json`). |
| `game/{id}/{page}.json` | Paginated scripts belonging to a specific game (20 scripts per page). |
| `game/universal.json` | Universal catalog entity for multi-game scripts and admin panels. |
| `game/universal/{page}.json` | Paginated universal scripts (`1.json`, `2.json`, ...). |

### 📜 Scripts Directory (`/script` & `/home`)
| Path | Description |
| :--- | :--- |
| `home/trending.json` | Featured trending games list. |
| `home/topscript.json` | Top executed scripts list. |
| `home/latest.json` | Page 1 summary of latest published scripts. |
| `home/latest/{page}.json` | Paginated latest scripts (`1.json` up to `3600+.json`, 20 per page). |
| `keyless/scripts.json` | Overview of scripts that do not require an execution key. |
| `keyless/pages/{page}.json`| Paginated keyless scripts (`1.json`, `2.json`, ...). |
| `script/{hash}.json` | Detailed script file (full Lua script code, verified author, changelog, comments). |

> **Note on Script Filenames**: Detailed scripts under `script/` are stored using the SHA-256 hash of their slug:
> $$\text{filename} = \text{sha256}(\text{slug}) + \text{".json"}$$

### ⚡ Executors (`/executor`)
| Path | Description |
| :--- | :--- |
| `executor/executors.json` | Complete list of all Roblox executors with sUNC scores and status. |
| `executor/{name}.json` | Individual executor specification by name/slug. |

### 📊 Trending & Leaderboards (`/trending`)
| Path | Description |
| :--- | :--- |
| `trending/day.json` | Daily top scripts and creator rankings. |
| `trending/week.json` | Weekly top scripts and creator rankings. |
| `trending/month.json` | Monthly top scripts and creator rankings. |
| `trending/all.json` | All-time top scripts and creator rankings. |

---

## 💻 Quick Code Examples

### JavaScript / TypeScript
```javascript
const RAW_BASE = "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data";

// 1. Fetch games directory (page 1)
async function getGames(page = 1) {
  const res = await fetch(`${RAW_BASE}/game/games/${page}.json`);
  const data = await res.json();
  return data.games;
}

// 2. Fetch script details using slug
async function getScriptBySlug(slug) {
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256").update(slug).digest("hex");
  const res = await fetch(`${RAW_BASE}/script/${hash}.json`);
  return await res.json();
}
```

### Python
```python
import hashlib
import requests

RAW_BASE = "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data"

# Fetch latest scripts
response = requests.get(f"{RAW_BASE}/home/latest/1.json")
scripts = response.json()["scripts"]

for item in scripts:
    title = item["title"]
    # With CDN:
    cdn_thumb = item["thumbnail"]["url"]
    # Without CDN:
    direct_thumb = item["thumbnail"].get("original") or cdn_thumb
    print(f"{title} -> {direct_thumb}")
```

### cURL
```bash
# Fetch game metadata for Natural Disaster Survival (189707)
curl -s "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/game/189707.json"

# Fetch all executors
curl -s "https://raw.githubusercontent.com/tzukizy/roblox-API/main/data/executor/executors.json"
```

---

## 📖 Complete JSON Schema Specification

For full payload examples, property types, and field definitions across all objects (Games, Scripts, Comments, Executors, Manifest), please see:

👉 **[docs/structure.md](docs/structure.md)**

---

## 📄 License

MIT License
