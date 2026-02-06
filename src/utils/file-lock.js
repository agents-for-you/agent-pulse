/**
 * @fileoverview File locking utilities
 * Provides atomic file lock acquisition using mkdir for lock safety
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDataDir } from './data-dir.js';
import { sleep, sleepSync } from './sleep.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lock file path
export const LOCK_FILE = path.join(__dirname, '../../.data/.lock');

/**
 * Check if a lock is stale (process dead or PID file missing)
 * @private
 * @param {string} lockDir - Lock directory path
 * @returns {boolean} True if lock is stale
 */
function _isLockStale(lockDir) {
  try {
    const pidPath = path.join(lockDir, 'pid');
    const lockPid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
    // Check if process is still alive
    process.kill(lockPid, 0);
    return false; // Process is alive
  } catch (err) {
    // Process is dead or PID file missing/corrupt
    return true;
  }
}

/**
 * Simple file lock - acquire lock (sync version)
 * Uses atomic mkdir for lock acquisition to prevent TOCTOU race condition
 * @param {number} timeout - Timeout ms
 * @returns {boolean} Whether acquired successfully
 */
export function acquireLock(timeout = 1000) {
  ensureDataDir();
  const start = Date.now();
  const pollInterval = 10; // Poll interval
  const lockDir = LOCK_FILE + '.d'; // Use directory as lock (more atomic)

  while (Date.now() - start < timeout) {
    try {
      // Use mkdir with O_EXCL flag for truly atomic lock acquisition
      // This avoids TOCTOU race condition present in writeFile+readFile pattern
      fs.mkdirSync(lockDir, { mode: 0o700, recursive: false });
      // Write our PID to a file inside the lock directory
      fs.writeFileSync(path.join(lockDir, 'pid'), process.pid.toString());
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock directory exists, check if stale
        const isStale = _isLockStale(lockDir);

        if (isStale) {
          // Lock is stale, try to remove and immediately retry
          try {
            // Use recursive:true to properly remove the directory
            fs.rmSync(lockDir, { recursive: true, force: false });
            // Immediately retry acquiring after successful removal
            continue;
          } catch (removeErr) {
            if (removeErr.code === 'ENOENT') {
              // Directory was removed by another process, try to acquire
              continue;
            }
            // Failed to remove (EACCES, EBUSY, etc.), another process may have it
          }
        }
        // Lock is held by another process, wait
      }
      // Use non-blocking wait
      sleepSync(pollInterval);
    }
  }
  return false;
}

/**
 * Async acquire file lock
 * Uses atomic mkdir for lock acquisition to prevent TOCTOU race condition
 * @param {number} timeout - Timeout ms
 * @returns {Promise<boolean>} Whether acquired successfully
 */
export async function acquireLockAsync(timeout = 1000) {
  ensureDataDir();
  const start = Date.now();
  const pollInterval = 10;
  const lockDir = LOCK_FILE + '.d';

  while (Date.now() - start < timeout) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700, recursive: false });
      fs.writeFileSync(path.join(lockDir, 'pid'), process.pid.toString());
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        const isStale = _isLockStale(lockDir);

        if (isStale) {
          try {
            fs.rmSync(lockDir, { recursive: true, force: false });
            continue;
          } catch (removeErr) {
            if (removeErr.code === 'ENOENT') {
              continue;
            }
          }
        }
      }
      await sleep(pollInterval);
    }
  }
  return false;
}

/**
 * Release file lock
 */
export function releaseLock() {
  const lockDir = LOCK_FILE + '.d';
  try {
    // Verify we own the lock before releasing
    const pidPath = path.join(lockDir, 'pid');
    const lockPid = fs.readFileSync(pidPath, 'utf8').trim();
    if (parseInt(lockPid) === process.pid) {
      // Use rmSync with recursive:true to properly remove the directory
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch {}
}

/**
 * Check if a lock is stale (exported version)
 * @param {string} [lockDir] - Lock directory path (defaults to LOCK_FILE + '.d')
 * @returns {boolean} True if lock is stale
 */
export function isLockStale(lockDir = LOCK_FILE + '.d') {
  return _isLockStale(lockDir);
}

/**
 * Execute operation with lock
 * @param {Function} fn - Function to execute
 * @param {number} timeout - Lock timeout
 * @returns {*} Function return value
 */
export function withLock(fn, timeout = 1000) {
  if (!acquireLock(timeout)) {
    throw new Error('Failed to acquire lock');
  }
  try {
    return fn();
  } finally {
    releaseLock();
  }
}
