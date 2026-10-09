import { RATE_LIMITS } from "../config.js";

/**
 * Resilient HTTP fetcher with exponential backoff and error recovery.
 *
 * @param {string} url - Target URL
 * @param {RequestInit & { timeoutMs?: number }} options - Fetch options
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<{ ok: boolean, status: number, data: any, error?: string }>}
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const timeoutMs = options.timeoutMs || RATE_LIMITS.requestTimeoutMs;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      const headers = {
        Accept: "application/json, text/plain, */*",
        ...options.headers,
      };

      const res = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Handle rate limits or temporary server errors with backoff
      if ((res.status === 429 || res.status >= 500) && attempt <= maxRetries) {
        const retryAfter = res.headers.get("retry-after");
        const rateLimitReset = res.headers.get("x-ratelimit-reset");
        let backoffMs = 1000 * Math.pow(2, attempt - 1);

        if (rateLimitReset && !isNaN(Number(rateLimitReset))) {
          backoffMs = Math.max(1000, (Number(rateLimitReset) + 1) * 1000);
        } else if (retryAfter && !isNaN(Number(retryAfter))) {
          backoffMs = Math.max(1000, Number(retryAfter) * 1000);
        } else {
          backoffMs = Math.min(15000, backoffMs);
        }

        console.warn(
          `[HTTP ${res.status}] ${url} -> backing off for ${backoffMs}ms (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: `HTTP error ${res.status}: ${res.statusText}`,
        };
      }

      const contentType = res.headers.get("content-type") || "";
      let data = null;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      return {
        ok: true,
        status: res.status,
        data,
      };
    } catch (err) {
      const isLastAttempt = attempt > maxRetries;
      const isTimeout = err?.name === "TimeoutError";

      if (!isLastAttempt) {
        const backoffMs = Math.min(8000, 800 * Math.pow(2, attempt - 1));
        console.warn(
          `[Network Error] ${url}: ${err.message} -> retrying in ${backoffMs}ms`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        return {
          ok: false,
          status: isTimeout ? 504 : 500,
          error: err?.message || "Network request failed",
        };
      }
    }
  }

  return {
    ok: false,
    status: 500,
    error: "Max retries exceeded",
  };
}
