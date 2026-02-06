/**
 * @fileoverview Sleep utilities
 * Provides async and sync wait functions
 */

/**
 * Async wait
 * @param {number} ms - Wait time (milliseconds)
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sync wait (non-blocking, uses setImmediate)
 * @param {number} ms - Wait time
 */
export function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Use Atomics.wait if available, otherwise yield briefly
    try {
      const buffer = new SharedArrayBuffer(4);
      const view = new Int32Array(buffer);
      Atomics.wait(view, 0, 0, Math.min(ms, 10));
    } catch {
      // Fallback to empty loop, but each iteration is short
    }
  }
}
