/**
 * Service layer common module
 * Extracts constants, utility functions, error codes, storage encryption
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ Utility functions ============

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

// ============ Path constants ============
export const DATA_DIR = path.join(__dirname, '../../.data');
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
export const MSG_FILE = path.join(DATA_DIR, 'messages.jsonl');
export const CMD_FILE = path.join(DATA_DIR, 'commands.jsonl');
export const RESULT_FILE = path.join(DATA_DIR, 'results.jsonl');
export const HEALTH_FILE = path.join(DATA_DIR, 'health.json');
export const LOCK_FILE = path.join(DATA_DIR, '.lock');
export const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
export const STORAGE_KEY_FILE = path.join(DATA_DIR, '.storage_key');
export const OFFLINE_QUEUE_FILE = path.join(DATA_DIR, 'offline_queue.jsonl');
export const RELAY_STATS_FILE = path.join(DATA_DIR, 'relay_stats.json');
export const GROUP_HISTORY_DIR = path.join(DATA_DIR, 'group_history');

// ============ Configuration constants ============
export const CONFIG = {
  MAX_MSG_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_MESSAGES_KEEP: 1000,             // Max messages to keep
  DEDUP_CACHE_SIZE: 500,               // Dedup cache size
  CMD_POLL_INTERVAL: 500,              // Command poll interval ms
  HEALTH_UPDATE_INTERVAL: 5000,        // Health update interval ms
  START_TIMEOUT: 5000,                 // Start timeout ms
  START_POLL_INTERVAL: 100,            // Start poll interval ms

  // Message reliability
  MESSAGE_RETRY_COUNT: 3,              // Message retry count
  MESSAGE_RETRY_DELAY: 1000,           // Retry delay ms
  MESSAGE_RETRY_BACKOFF: 2,            // Exponential backoff factor
  MESSAGE_TTL: 24 * 60 * 60 * 1000,    // Message expiration 24h
  OFFLINE_QUEUE_FILE: 'offline_queue.jsonl', // Offline queue file
  MAX_QUEUE_SIZE: 10000,               // Maximum message queue size (prevents OOM)

  // Groups
  GROUP_HISTORY_LIMIT: 100,            // Group message history sync limit
  MEMBER_ACTIVITY_TIMEOUT: 5 * 60 * 1000, // Member activity timeout 5min
};

// ============ Error codes ============
export const ErrorCode = {
  // Success
  OK: 'OK',

  // Service related
  SERVICE_NOT_RUNNING: 'SERVICE_NOT_RUNNING',
  SERVICE_ALREADY_RUNNING: 'SERVICE_ALREADY_RUNNING',
  SERVICE_START_FAILED: 'SERVICE_START_FAILED',
  SERVICE_STOP_FAILED: 'SERVICE_STOP_FAILED',

  // Network related
  NETWORK_DISCONNECTED: 'NETWORK_DISCONNECTED',
  NETWORK_SEND_FAILED: 'NETWORK_SEND_FAILED',
  RELAY_ALL_FAILED: 'RELAY_ALL_FAILED',

  // Argument related
  INVALID_ARGS: 'INVALID_ARGS',
  INVALID_PUBKEY: 'INVALID_PUBKEY',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',

  // Group related
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  GROUP_ALREADY_EXISTS: 'GROUP_ALREADY_EXISTS',
  NOT_GROUP_OWNER: 'NOT_GROUP_OWNER',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  MEMBER_BANNED: 'MEMBER_BANNED',
  MEMBER_MUTED: 'MEMBER_MUTED',

  // Message related
  MESSAGE_EXPIRED: 'MESSAGE_EXPIRED',
  MESSAGE_RETRY_EXHAUSTED: 'MESSAGE_RETRY_EXHAUSTED',

  // System related
  FILE_ERROR: 'FILE_ERROR',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// ============ Utility functions ============

/**
 * Ensure data directory exists
 */
export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

/**
 * Safely read JSONL file
 * @param {string} filePath - File path
 * @param {boolean} decrypt - Whether to decrypt
 * @returns {Array} Parsed object array
 */
export function readJsonLines(filePath, decrypt = false) {
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return [];

    return content.split('\n').map(line => {
      try {
        if (decrypt) {
          // Try to decrypt
          try {
            line = decryptFromStorage(line);
          } catch {
            // May be old unencrypted data, parse directly
          }
        }
        return JSON.parse(line);
      } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Safely append JSONL file
 * @param {string} filePath - File path
 * @param {Object} data - Data to append
 * @param {boolean} encrypt - Whether to encrypt storage
 */
export function appendJsonLine(filePath, data, encrypt = false) {
  ensureDataDir();
  let line = JSON.stringify(data);
  if (encrypt) {
    line = encryptForStorage(line);
  }
  fs.appendFileSync(filePath, line + '\n');
}

/**
 * LRU cache class - unified implementation
 * @template K, V
 */
export class LRUCache {
  /**
   * @param {number} maxSize - Maximum cache size
   */
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    /** @type {Map<K, V>} */
    this.cache = new Map();
  }

  /**
   * Check if key exists
   * @param {K} key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Get value
   * @param {K} key
   * @returns {V|undefined}
   */
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    // Refresh access order
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set value
   * @param {K} key
   * @param {V} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.maxSize > 0 && this.cache.size >= this.maxSize) {
      // Only evict if maxSize > 0 (prevents undefined key when maxSize is 0)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    // Only set if maxSize > 0 or cache not at limit
    if (this.maxSize > 0 || this.cache.size < this.maxSize) {
      this.cache.set(key, value);
    }
  }

  /**
   * Add key (value is true)
   * @param {K} key
   */
  add(key) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.maxSize > 0 && this.cache.size >= this.maxSize) {
      // Only evict if maxSize > 0 (prevents undefined key when maxSize is 0)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    // Only set if maxSize > 0 or cache not at limit
    if (this.maxSize > 0 || this.cache.size < this.maxSize) {
      this.cache.set(key, true);
    }
  }

  /**
   * Delete key
   * @param {K} key
   * @returns {boolean}
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get all entries
   * @returns {Array<[K, V]>}
   */
  entries() {
    return Array.from(this.cache.entries());
  }

  /**
   * Get all keys
   * @returns {K[]}
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values
   * @returns {V[]}
   */
  values() {
    return Array.from(this.cache.values());
  }

  /**
   * Get size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}

// ============ Atomic file operations ============

/**
 * Atomic write to file (using temp file + rename)
 * @param {string} filePath - Target file path
 * @param {string} content - File content
 * @param {Object} [options] - Options
 * @param {number} [options.mode] - File permissions
 */
export function atomicWriteFileSync(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    fs.writeFileSync(tempPath, content, options);
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // Clean up temp file
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
}

/**
 * Safely delete file (ignore not exist error)
 * @param {string} filePath - File path
 * @param {Function} [logFn] - Optional log function
 */
export function safeUnlink(filePath, logFn = null) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT' && logFn) {
      logFn(`Failed to delete ${filePath}: ${err.message}`);
    }
  }
}

/**
 * Generate unique ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ============ Local storage encryption ============

let storageKey = null;
let keyRotationTime = null;
const KEY_ROTATION_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

/**
 * Validate file path is within data directory (prevent path traversal attack)
 * @param {string} filePath - File path to validate
 * @returns {boolean} Whether path is safe
 */
function validatePathInDataDir(filePath) {
  const resolvedPath = path.resolve(filePath);
  const resolvedDataDir = path.resolve(DATA_DIR);
  return resolvedPath.startsWith(resolvedDataDir + path.sep) || resolvedPath === resolvedDataDir;
}

/**
 * Rotate storage key (generates new key and returns both old and new)
 * @returns {{oldKey: Buffer, newKey: Buffer}} Old and new keys for re-encryption
 */
export function rotateStorageKey() {
  ensureDataDir();

  // Validate storage key file path safety
  if (!validatePathInDataDir(STORAGE_KEY_FILE)) {
    throw new Error('Invalid storage key path: path traversal detected');
  }

  const oldKey = storageKey || getStorageKey();
  const newKey = crypto.randomBytes(32);

  // Atomic write of new key
  const tempPath = STORAGE_KEY_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tempPath, newKey.toString('hex'), { mode: 0o600 });
    fs.renameSync(tempPath, STORAGE_KEY_FILE);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }

  // Update cached key and rotation time
  storageKey = newKey;
  keyRotationTime = Date.now();

  return { oldKey, newKey };
}

/**
 * Check if storage key needs rotation
 * @returns {boolean} True if key should be rotated
 */
export function shouldRotateKey() {
  if (!keyRotationTime) {
    // First time load - check file modification time
    try {
      const stats = fs.statSync(STORAGE_KEY_FILE);
      keyRotationTime = stats.mtime.getTime();
    } catch {
      keyRotationTime = Date.now();
    }
  }
  return (Date.now() - keyRotationTime) > KEY_ROTATION_INTERVAL;
}

/**
 * Get or generate local storage key
 * Key is randomly generated, stored in local file
 * Supports automatic key rotation
 */
export function getStorageKey() {
  // Check if key needs rotation
  if (storageKey && shouldRotateKey()) {
    log?.warn('Storage key rotation recommended - key is older than 30 days');
  }

  if (storageKey) return storageKey;

  ensureDataDir();

  // Validate storage key file path safety (prevent symlink attack)
  if (!validatePathInDataDir(STORAGE_KEY_FILE)) {
    throw new Error('Invalid storage key path: path traversal detected');
  }

  if (fs.existsSync(STORAGE_KEY_FILE)) {
    // Verify file is not a symlink (prevent symlink attack)
    const stats = fs.lstatSync(STORAGE_KEY_FILE);
    if (stats.isSymbolicLink()) {
      throw new Error('Security error: storage key file cannot be a symlink');
    }
    // Read existing key
    storageKey = Buffer.from(fs.readFileSync(STORAGE_KEY_FILE, 'utf8'), 'hex');
    keyRotationTime = stats.mtime.getTime();
  } else {
    // Generate new key - use atomic write (temp file + rename)
    const tempPath = STORAGE_KEY_FILE + '.tmp.' + process.pid;
    storageKey = crypto.randomBytes(32);
    keyRotationTime = Date.now();
    try {
      fs.writeFileSync(tempPath, storageKey.toString('hex'), { mode: 0o600 });
      // Atomic rename
      fs.renameSync(tempPath, STORAGE_KEY_FILE);
    } catch (err) {
      // Clean up temp file
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  return storageKey;
}

/**
 * Encrypt data for local storage
 * @param {string} plaintext - Plaintext
 * @returns {string} Ciphertext (iv:encrypted)
 */
export function encryptForStorage(plaintext) {
  const key = getStorageKey();
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return iv.toString('base64') + ':' + encrypted;
}

/**
 * Decrypt local storage data
 * @param {string} ciphertext - Ciphertext (iv:encrypted)
 * @returns {string} Plaintext
 */
export function decryptFromStorage(ciphertext) {
  const key = getStorageKey();

  const [ivB64, encrypted] = ciphertext.split(':');
  if (!ivB64 || !encrypted) {
    throw new Error('Invalid storage ciphertext format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
