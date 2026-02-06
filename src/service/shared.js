/**
 * Service layer common module - Re-exports for backward compatibility
 *
 * This file now re-exports from the new modular structure.
 * New code should import directly from the specific modules:
 *
 * - File locking: ../utils/file-lock.js
 * - LRU Cache: ../utils/lru-cache.js
 * - Storage encryption: ../utils/storage-encryption.js
 * - JSON file ops: ../utils/json-file.js
 * - Data dir constants: ../utils/data-dir.js
 * - Sleep utilities: ../utils/sleep.js
 * - Error reporter: ../utils/error-reporter.js
 */

// Import error reporter system for use in createErrorResponseFromCode
import { ErrorCodes as ImportedErrorCodes, createErrorResponse, createSuccessResponse, ErrorSeverity, ErrorCategory } from '../utils/error-reporter.js';

// Re-export from data-dir.js
export {
  DATA_DIR,
  PID_FILE,
  MSG_FILE,
  CMD_FILE,
  RESULT_FILE,
  HEALTH_FILE,
  LOCK_FILE,
  GROUPS_FILE,
  STORAGE_KEY_FILE,
  OFFLINE_QUEUE_FILE,
  RELAY_STATS_FILE,
  GROUP_HISTORY_DIR,
  CONFIG,
  ErrorCode,
  ensureDataDir,
  ensureDataDirAsync,
  generateId,
} from '../utils/data-dir.js';

// Re-export from file-lock.js
export {
  acquireLock,
  acquireLockAsync,
  releaseLock,
  isLockStale,
  withLock,
} from '../utils/file-lock.js';

// Re-export from lru-cache.js
export { LRUCache } from '../utils/lru-cache.js';

// Re-export from storage-encryption.js
export {
  encryptForStorage,
  decryptFromStorage,
  getStorageKey,
  rotateStorageKey,
  shouldRotateKey,
} from '../utils/storage-encryption.js';

// Re-export from json-file.js (both sync and async)
export {
  readJson,
  writeJson,
  readJsonLines,
  appendJsonLine,
  atomicWriteFileSync,
  safeUnlink,
  readJsonAsync,
  writeJsonAsync,
  readJsonLinesAsync,
  appendJsonLineAsync,
  atomicWriteFile,
  safeUnlinkAsync,
  fileExistsAsync,
  getStatsAsync,
} from '../utils/json-file.js';

// Re-export from sleep.js
export {
  sleep,
  sleepSync,
} from '../utils/sleep.js';

// Re-export the enhanced error system
export { ImportedErrorCodes as ErrorCodes, createErrorResponse, createSuccessResponse, ErrorSeverity, ErrorCategory };

/**
 * Create a standardized error response
 * @param {string} codeKey - Error code key (from ErrorCode enum)
 * @param {string} [error] - Optional error message override
 * @param {Object} [details] - Optional additional details
 * @returns {Object} Standardized error response
 */
export function createErrorResponseFromCode(codeKey, error = null, details = {}) {
  const errorDef = ImportedErrorCodes[codeKey];
  if (!errorDef) {
    // Fallback for unknown codes
    return {
      ok: false,
      code: 901,
      codeKey: 'INTERNAL_ERROR',
      error: error || 'Unknown error',
      severity: 'critical',
      category: 'internal',
      retryable: false,
      timestamp: Date.now(),
      ...details
    };
  }

  return {
    ok: false,
    code: errorDef.code,
    codeKey,
    error: error || errorDef.message,
    suggestion: errorDef.suggestion,
    severity: errorDef.severity,
    category: errorDef.category,
    retryable: errorDef.retryable,
    timestamp: Date.now(),
    ...details
  };
}

// ============ Additional async utilities not in other modules ============

/**
 * Execute operation with lock (async version)
 * @param {Function} fn - Async function to execute
 * @param {number} timeout - Lock timeout
 * @returns {Promise<*>} Function return value
 */
export async function withLockAsync(fn, timeout = 1000) {
  const { acquireLockAsync, releaseLock } = await import('../utils/file-lock.js');
  if (!await acquireLockAsync(timeout)) {
    throw new Error('Failed to acquire lock');
  }
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}
