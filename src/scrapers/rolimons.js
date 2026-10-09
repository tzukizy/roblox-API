import { API_URLS, USER_AGENTS } from "../config.js";
import { fetchWithRetry } from "../utils/http.js";
import { getScriptGameSlug } from "../utils/helpers.js";

/**
 * @typedef {Object} RolimonsGameItem
 * @property {number} placeId
 * @property {string} name
 * @property {string} nameSlug
 * @property {number} totalPlayers
 * @property {string} rolimonsThumb
 */

/**
 * Scrapes Rolimons live game list.
 *
 * @returns {Promise<RolimonsGameItem[]>}
 */
export async function scrapeRolimonsGameList() {
  console.log("-> Fetching Rolimons game list...");
  const res = await fetchWithRetry(API_URLS.rolimons.gamelist, {
    headers: {
      "User-Agent": USER_AGENTS.browser,
      Referer: "https://www.rolimons.com/",
    },
  });

  if (!res.ok || !res.data?.games) {
    throw new Error(
      `Failed to fetch Rolimons gamelist: ${res.error || "No data"}`,
    );
  }

  const rawEntries = Object.entries(res.data.games);
  console.log(`-> Rolimons returned ${rawEntries.length} games. Sorting...`);

  // Sort games by active players descending
  rawEntries.sort((a, b) => (b[1][1] || 0) - (a[1][1] || 0));

  const games = rawEntries.map(([id, [name, totalPlayers, rolimonsThumb]]) => {
    const placeId = Number(id);
    return {
      placeId,
      name,
      nameSlug: getScriptGameSlug(placeId, name),
      totalPlayers: typeof totalPlayers === "number" ? totalPlayers : 0,
      rolimonsThumb: rolimonsThumb || "",
    };
  });

  return games;
}
