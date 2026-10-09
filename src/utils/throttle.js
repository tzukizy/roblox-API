/**
 * Rate-limiting queue to ensure polite request pacing.
 * @param {number} minIntervalMs - Minimum delay between requests in milliseconds
 */
export function createThrottler(minIntervalMs = 250) {
  let lastCallTimestamp = 0;
  let queueTail = Promise.resolve();

  return async function schedule(fn) {
    const currentTail = queueTail;
    let resolveNext = () => {};
    queueTail = new Promise((resolve) => {
      resolveNext = resolve;
    });

    await currentTail;

    const now = Date.now();
    const elapsed = now - lastCallTimestamp;
    if (elapsed < minIntervalMs) {
      await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
    }
    lastCallTimestamp = Date.now();

    try {
      return await fn();
    } finally {
      resolveNext();
    }
  };
}
