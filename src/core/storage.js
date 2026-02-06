/**
 * @fileoverview Secure JSON file storage module
 * Supports file permission protection, async I/O, and encryption-at-rest
 */

import fs from 'fs'
import { promises as fsAsync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { logger } from '../utils/logger.js'

const log = logger.child('storage')

/**
 * PBKDF2 iteration count for key derivation
 * @constant {number}
 */
const PBKDF2_ITERATIONS = 100000

/**
 * AES key length in bytes (256 bits)
 * @constant {number}
 */
const AES_KEY_LENGTH = 32

/**
 * IV length for AES-GCM (96 bits)
 * @constant {number}
 */
const IV_LENGTH = 12

/**
 * Salt length for key derivation (128 bits)
 * @constant {number}
 */
const SALT_LENGTH = 16

/**
 * Auth tag length for GCM (128 bits)
 * @constant {number}
 */
const AUTH_TAG_LENGTH = 16

/**
 * Path to locally generated encryption key
 * @constant {string}
 */
const LOCAL_KEY_PATH = path.join(process.cwd(), '.agent-pulse-key')

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

/**
 * Derive encryption key from password using PBKDF2
 * @param {string} password - Password to derive key from
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} Derived key (32 bytes for AES-256)
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, AES_KEY_LENGTH, 'sha256')
}

/**
 * Generate or load local encryption key
 * Creates a new random key if none exists
 * @returns {Buffer} 32-byte encryption key
 */
function getOrGenerateLocalKey() {
  try {
    if (fs.existsSync(LOCAL_KEY_PATH)) {
      const keyData = fs.readFileSync(LOCAL_KEY_PATH, 'utf8')
      // Validate key length
      if (keyData.length === AES_KEY_LENGTH * 2) { // hex encoded
        return Buffer.from(keyData, 'hex')
      }
      log.warn('Invalid local key format, generating new one')
    }
  } catch (err) {
    log.warn('Failed to read local key, generating new one', { error: err.message })
  }

  // Generate new random key
  const key = crypto.randomBytes(AES_KEY_LENGTH)
  try {
    // Write with secure permissions
    const dir = path.dirname(LOCAL_KEY_PATH)
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(LOCAL_KEY_PATH, key.toString('hex'), { mode: SECURE_FILE_MODE })
    log.info('Generated new local encryption key', { path: LOCAL_KEY_PATH })
  } catch (err) {
    log.error('Failed to persist local key', { error: err.message })
  }
  return key
}

/**
 * Get encryption key from environment or local storage
 * Priority: AGENT_PULSE_KEY_PASSWORD env var > local generated key
 * @returns {Buffer} 32-byte encryption key
 */
function getEncryptionKey() {
  const password = process.env.AGENT_PULSE_KEY_PASSWORD
  if (password) {
    // Use fixed salt for password-based derivation to allow decryption
    // In production, consider per-file salts stored alongside data
    const salt = Buffer.from('agent-pulse-encryption-salt-v1', 'utf8').slice(0, SALT_LENGTH)
    return deriveKey(password, salt)
  }
  return getOrGenerateLocalKey()
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string} data - Plaintext data to encrypt
 * @returns {Object} Encrypted data object with format { encrypted: true, data: base64(iv:ciphertext:tag) }
 */
function encrypt(data) {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(data, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  // Format: iv:ciphertext:authTag (all hex, then base64 encoded)
  const combined = `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
  return {
    encrypted: true,
    data: Buffer.from(combined, 'utf8').toString('base64')
  }
}

/**
 * Decrypt data encrypted with encrypt()
 * @param {Object} encryptedData - Object with { encrypted: true, data: base64(iv:ciphertext:tag) }
 * @returns {string} Decrypted plaintext data
 * @throws {Error} If decryption fails
 */
function decrypt(encryptedData) {
  if (!encryptedData?.encrypted || !encryptedData?.data) {
    throw new Error('Invalid encrypted data format')
  }

  try {
    const key = getEncryptionKey()
    const combined = Buffer.from(encryptedData.data, 'base64').toString('utf8')
    const [ivHex, ciphertext, authTagHex] = combined.split(':')

    if (!ivHex || !ciphertext || !authTagHex) {
      throw new Error('Invalid encrypted data structure')
    }

    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (err) {
    log.error('Decryption failed', { error: err.message })
    throw new Error(`Decryption failed: ${err.message}`)
  }
}

/**
 * Check if data object is in encrypted format
 * @param {Object} data - Data object to check
 * @returns {boolean} True if data appears to be encrypted
 */
function isEncrypted(data) {
  return data && typeof data === 'object' && data.encrypted === true && typeof data.data === 'string'
}

/**
 * Encrypt a specific field in a JSON object
 * @param {Object} obj - Object containing field to encrypt
 * @param {string} fieldName - Name of field to encrypt
 * @returns {Object} Object with encrypted field
 */
function encryptField(obj, fieldName) {
  if (!obj || !obj[fieldName]) {
    return obj
  }
  const result = { ...obj }
  result[fieldName] = encrypt(result[fieldName])
  return result
}

/**
 * Decrypt a specific field in a JSON object
 * @param {Object} obj - Object containing encrypted field
 * @param {string} fieldName - Name of field to decrypt
 * @returns {string} Decrypted field value
 * @throws {Error} If field is not encrypted or decryption fails
 */
function decryptField(obj, fieldName) {
  if (!obj || !obj[fieldName]) {
    throw new Error(`Field ${fieldName} not found in object`)
  }
  if (isEncrypted(obj[fieldName])) {
    return decrypt(obj[fieldName])
  }
  // Return as-is for backward compatibility (unencrypted data)
  return obj[fieldName]
}

/**
 * Read encrypted JSON file and auto-decrypt specified field
 * @param {string} filePath - File path
 * @param {string} encryptedFieldName - Name of field to decrypt (e.g., 'secretKey')
 * @returns {Object|null} Parsed JSON with decrypted field, or null if file doesn't exist
 */
export function readEncryptedJson(filePath, encryptedFieldName) {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)

    // Check if the field is encrypted
    if (data && data[encryptedFieldName]) {
      if (isEncrypted(data[encryptedFieldName])) {
        // Decrypt the field
        const decrypted = decrypt(data[encryptedFieldName])
        return { ...data, [encryptedFieldName]: decrypted }
      }
      // Field exists but not encrypted - backward compatible, return as-is
      // Mark for migration
      return { ...data, _needsMigration: true }
    }

    return data
  } catch (err) {
    log.error('Failed to read encrypted JSON file', { filePath, error: err.message })
    return null
  }
}

/**
 * Write JSON file with encryption for specified field
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 * @param {string} encryptedFieldName - Name of field to encrypt (e.g., 'secretKey')
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.secure=true] - Use secure permissions (0600)
 * @returns {boolean} Whether write was successful
 */
export function writeEncryptedJson(filePath, data, encryptedFieldName, { secure = true } = {}) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Encrypt the specified field
    const dataToWrite = encryptField(data, encryptedFieldName)

    // Use atomic write with secure permissions by default for encrypted data
    const tempPath = filePath + '.tmp.' + process.pid
    const mode = secure ? SECURE_FILE_MODE : 0o644

    try {
      fs.writeFileSync(tempPath, JSON.stringify(dataToWrite, null, 2), { mode })
      fs.renameSync(tempPath, filePath)
    } catch (err) {
      try { fs.unlinkSync(tempPath) } catch {}
      throw err
    }

    return true
  } catch (err) {
    log.error('Failed to write encrypted JSON file', { filePath, error: err.message })
    return false
  }
}

/**
 * Asynchronously read encrypted JSON file and auto-decrypt specified field
 * @param {string} filePath - File path
 * @param {string} encryptedFieldName - Name of field to decrypt (e.g., 'secretKey')
 * @returns {Promise<Object|null>} Parsed JSON with decrypted field, or null if file doesn't exist
 */
export async function readEncryptedJsonAsync(filePath, encryptedFieldName) {
  try {
    const raw = await fsAsync.readFile(filePath, 'utf8')
    const data = JSON.parse(raw)

    // Check if the field is encrypted
    if (data && data[encryptedFieldName]) {
      if (isEncrypted(data[encryptedFieldName])) {
        // Decrypt the field
        const decrypted = decrypt(data[encryptedFieldName])
        return { ...data, [encryptedFieldName]: decrypted }
      }
      // Field exists but not encrypted - backward compatible
      return { ...data, _needsMigration: true }
    }

    return data
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.error('Failed to read encrypted JSON file', { filePath, error: err.message })
    }
    return null
  }
}

/**
 * Asynchronously write JSON file with encryption for specified field
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 * @param {string} encryptedFieldName - Name of field to encrypt (e.g., 'secretKey')
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.secure=true] - Use secure permissions (0600)
 * @returns {Promise<boolean>} Whether write was successful
 */
export async function writeEncryptedJsonAsync(filePath, data, encryptedFieldName, { secure = true } = {}) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (dir && dir !== '.') {
      await fsAsync.mkdir(dir, { recursive: true }).catch(() => {})
    }

    // Encrypt the specified field
    const dataToWrite = encryptField(data, encryptedFieldName)

    // Use atomic write with secure permissions by default for encrypted data
    const tempPath = filePath + '.tmp.' + process.pid
    const mode = secure ? SECURE_FILE_MODE : 0o644

    try {
      await fsAsync.writeFile(tempPath, JSON.stringify(dataToWrite, null, 2), { mode })
      await fsAsync.rename(tempPath, filePath)
    } catch (err) {
      try { await fsAsync.unlink(tempPath) } catch {}
      throw err
    }

    return true
  } catch (err) {
    log.error('Failed to write encrypted JSON file', { filePath, error: err.message })
    return false
  }
}
