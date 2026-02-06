/**
 * @fileoverview Local storage encryption utilities
 * Provides AES-256-CBC encryption for data at rest with key rotation support
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ensureDataDir, DATA_DIR, STORAGE_KEY_FILE } from './data-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    // Import logger dynamically to avoid circular dependency
    import('./logger.js').then(({ logger }) => {
      logger.child('storage-encryption').warn('Storage key rotation recommended - key is older than 30 days');
    });
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
