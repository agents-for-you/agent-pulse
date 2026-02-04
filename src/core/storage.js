/**
 * @fileoverview Secure JSON file storage module
 * Supports file permission protection and async I/O
 */

import fs from 'fs'
import { promises as fsAsync } from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'

const log = logger.child('storage')

/**
 * Secure file permissions (owner read/write only)
 * @constant {number}
 */
const SECURE_FILE_MODE = 0o600

/**
 * Synchronously read JSON file
 * @param {string} filePath - File path
 * @returns {Object|null} Parsed JSON object, returns null if file doesn't exist or parsing fails
 */
export function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    log.error('Failed to read JSON file', { filePath, error: err.message })
    return null
  }
}

/**
 * Synchronously write JSON file (with permission protection)
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.secure=false] - Use secure permissions (0600)
 * @returns {boolean} Whether write was successful
 */
export function writeJson(filePath, data, { secure = false } = {}) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (secure) {
      // Use atomic write to avoid permission race condition: temp file + rename
      const tempPath = filePath + '.tmp.' + process.pid
      try {
        // Set correct permissions directly when creating
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), {
          mode: SECURE_FILE_MODE
        })
        // Atomic rename operation
        fs.renameSync(tempPath, filePath)
      } catch (err) {
        // Clean up temp file
        try { fs.unlinkSync(tempPath) } catch {}
        throw err
      }
    } else {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
        mode: 0o644
      })
    }

    return true
  } catch (err) {
    log.error('Failed to write JSON file', { filePath, error: err.message })
    return false
  }
}

/**
 * Asynchronously read JSON file
 * @param {string} filePath - File path
 * @returns {Promise<Object|null>} Parsed JSON object, returns null if file doesn't exist or parsing fails
 */
export async function readJsonAsync(filePath) {
  try {
    const raw = await fsAsync.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.error('Failed to read JSON file', { filePath, error: err.message })
    }
    return null
  }
}

/**
 * Asynchronously write JSON file (with permission protection)
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.secure=false] - Use secure permissions (0600)
 * @returns {Promise<boolean>} Whether write was successful
 */
export async function writeJsonAsync(filePath, data, { secure = false } = {}) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (dir && dir !== '.') {
      await fsAsync.mkdir(dir, { recursive: true }).catch(() => {})
    }

    if (secure) {
      // Use atomic write to avoid permission race condition
      const tempPath = filePath + '.tmp.' + process.pid
      try {
        await fsAsync.writeFile(tempPath, JSON.stringify(data, null, 2), {
          mode: SECURE_FILE_MODE
        })
        await fsAsync.rename(tempPath, filePath)
      } catch (err) {
        // Clean up temp file
        try { await fsAsync.unlink(tempPath) } catch {}
        throw err
      }
    } else {
      await fsAsync.writeFile(filePath, JSON.stringify(data, null, 2), {
        mode: 0o644
      })
    }

    return true
  } catch (err) {
    log.error('Failed to write JSON file', { filePath, error: err.message })
    return false
  }
}

/**
 * Check if file exists
 * @param {string} filePath - File path
 * @returns {Promise<boolean>} Whether file exists
 */
export async function exists(filePath) {
  try {
    await fsAsync.access(filePath)
    return true
  } catch {
    return false
  }
}
