/**
 * @fileoverview JSON file utilities
 * Provides safe JSON file read/write operations (both sync and async)
 */

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { ensureDataDir } from './data-dir.js';
import { decryptFromStorage, encryptForStorage } from './storage-encryption.js';

/**
 * Safely read JSON file
 * @param {string} filePath - File path
 * @returns {Object|null} Parsed object or null
 */
export function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Safely write JSON file
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 */
export function writeJson(filePath, data) {
  ensureDataDir();
  const content = JSON.stringify(data, null, 2);
  atomicWriteFileSync(filePath, content);
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

// ============ Async versions ============

/**
 * Safely read JSON file (async version)
 * @param {string} filePath - File path
 * @returns {Promise<Object|null>} Parsed object or null
 */
export async function readJsonAsync(filePath) {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    if (!content.trim()) return null;
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

/**
 * Safely write JSON file (async version)
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 */
export async function writeJsonAsync(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  await atomicWriteFile(filePath, content);
}

/**
 * Safely read JSONL file (async version)
 * @param {string} filePath - File path
 * @param {boolean} decrypt - Whether to decrypt
 * @returns {Promise<Array>} Parsed object array
 */
export async function readJsonLinesAsync(filePath, decrypt = false) {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    if (!content.trim()) return [];

    const lines = content.split('\n').filter(Boolean);
    const results = [];

    for (let line of lines) {
      try {
        if (decrypt) {
          try {
            line = decryptFromStorage(line);
          } catch {
            // May be old unencrypted data, parse directly
          }
        }
        results.push(JSON.parse(line));
      } catch { /* skip invalid lines */ }
    }

    return results;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }
}

/**
 * Safely append JSONL file (async version)
 * @param {string} filePath - File path
 * @param {Object} data - Data to append
 * @param {boolean} encrypt - Whether to encrypt storage
 */
export async function appendJsonLineAsync(filePath, data, encrypt = false) {
  let line = JSON.stringify(data);
  if (encrypt) {
    line = encryptForStorage(line);
  }
  await fsPromises.appendFile(filePath, line + '\n');
}

/**
 * Atomic write to file (async version using temp file + rename)
 * @param {string} filePath - Target file path
 * @param {string} content - File content
 * @param {Object} [options] - Options
 * @param {number} [options.mode] - File permissions
 */
export async function atomicWriteFile(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    await fsPromises.writeFile(tempPath, content, options);
    await fsPromises.rename(tempPath, filePath);
  } catch (err) {
    // Clean up temp file
    try { await fsPromises.unlink(tempPath); } catch {}
    throw err;
  }
}

/**
 * Safely delete file (async version, ignore not exist error)
 * @param {string} filePath - File path
 * @param {Function} [logFn] - Optional log function
 */
export async function safeUnlinkAsync(filePath, logFn = null) {
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT' && logFn) {
      logFn(`Failed to delete ${filePath}: ${err.message}`);
    }
  }
}

/**
 * Check if file exists (async version)
 * @param {string} filePath - File path
 * @returns {Promise<boolean>} Whether file exists
 */
export async function fileExistsAsync(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file stats (async version)
 * @param {string} filePath - File path
 * @returns {Promise<fs.Stats|null>} File stats or null
 */
export async function getStatsAsync(filePath) {
  try {
    return await fsPromises.stat(filePath);
  } catch {
    return null;
  }
}
