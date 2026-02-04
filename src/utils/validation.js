/**
 * @fileoverview Input validation utilities
 * Centralized validation for all user inputs to prevent security issues
 */

import { logger } from './logger.js'

const log = logger.child('validation')

// Regular expressions for validation
const VALID_PUBKEY_HEX = /^[0-9a-fA-F]{64}$/
const VALID_NPUB = /^npub1[0-9a-zA-F]{58}$/
const VALID_NSEC = /^nsec1[0-9a-zA-F]{58}$/
const VALID_TOPIC = /^[a-zA-Z0-9_-]{1,100}$/
const VALID_GROUP_ID = /^[a-zA-Z0-9-]{1,50}$/
const VALID_MESSAGE = /^.{1,5000}$/s // Max 5000 chars, any content

/**
 * Sanitize string input (remove null bytes and control characters)
 * @param {string} input - Raw input
 * @returns {string} Sanitized string
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return ''
  // Remove null bytes and most control characters (except tab, newline, carriage return)
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Validate and normalize public key input (hex or npub)
 * @param {string} pubkey - Public key (hex or npub)
 * @returns {Object} { valid: boolean, normalized?: string, error?: string }
 */
export function validatePubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') {
    return { valid: false, error: 'Public key is required' }
  }

  const sanitized = sanitizeString(pubkey.trim())

  // Check npub format
  if (VALID_NPUB.test(sanitized)) {
    return { valid: true, normalized: sanitized, format: 'npub' }
  }

  // Check nsec format (private key, reject for most operations)
  if (VALID_NSEC.test(sanitized)) {
    return { valid: false, error: 'nsec format is a private key, not a public key' }
  }

  // Check hex format
  if (VALID_PUBKEY_HEX.test(sanitized)) {
    return { valid: true, normalized: sanitized.toLowerCase(), format: 'hex' }
  }

  return { valid: false, error: 'Invalid public key format (expected 64-char hex or npub)' }
}

/**
 * Validate topic string
 * @param {string} topic - Topic to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateTopic(topic) {
  if (!topic || typeof topic !== 'string') {
    return { valid: false, error: 'Topic is required' }
  }

  const sanitized = sanitizeString(topic.trim())

  if (!VALID_TOPIC.test(sanitized)) {
    return { valid: false, error: 'Topic must be 1-100 alphanumeric characters, hyphens, or underscores' }
  }

  return { valid: true, normalized: sanitized }
}

/**
 * Validate group ID
 * @param {string} groupId - Group ID to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateGroupId(groupId) {
  if (!groupId || typeof groupId !== 'string') {
    return { valid: false, error: 'Group ID is required' }
  }

  const sanitized = sanitizeString(groupId.trim())

  if (!VALID_GROUP_ID.test(sanitized)) {
    return { valid: false, error: 'Group ID must be 1-50 alphanumeric characters or hyphens' }
  }

  return { valid: true, normalized: sanitized }
}

/**
 * Validate message content
 * @param {string} message - Message content
 * @param {number} maxLength - Maximum allowed length
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateMessage(message, maxLength = 10000) {
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Message content is required' }
  }

  const sanitized = sanitizeString(message)

  if (sanitized.length === 0) {
    return { valid: false, error: 'Message cannot be empty' }
  }

  if (sanitized.length > maxLength) {
    return { valid: false, error: `Message exceeds maximum length of ${maxLength} characters` }
  }

  return { valid: true, normalized: sanitized }
}

/**
 * Validate file path (prevent path traversal attacks)
 * @param {string} filePath - File path to validate
 * @param {string} allowedDir - Allowed base directory
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateFilePath(filePath, allowedDir) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path is required' }
  }

  const path = (await import('path')).default

  try {
    const resolvedPath = path.resolve(filePath)
    const resolvedAllowed = path.resolve(allowedDir)

    // Check if resolved path is within allowed directory
    if (!resolvedPath.startsWith(resolvedAllowed + path.sep) && resolvedPath !== resolvedAllowed) {
      return { valid: false, error: 'Path traversal detected: path must be within allowed directory' }
    }

    // Check for symlink attacks
    const fs = (await import('fs')).default
    try {
      const stats = fs.lstatSync(resolvedPath)
      if (stats.isSymbolicLink()) {
        return { valid: false, error: 'Symlinks are not allowed for security reasons' }
      }
    } catch {
      // File doesn't exist yet, that's ok
    }

    return { valid: true, normalized: resolvedPath }
  } catch (err) {
    return { valid: false, error: `Invalid file path: ${err.message}` }
  }
}

/**
 * Validate numeric input
 * @param {string|number} value - Value to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, parsed?: number, error?: string }
 */
export function validateNumber(value, options = {}) {
  const {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
    integer = false,
    positive = false
  } = options

  const parsed = parseInt(value, 10)

  if (isNaN(parsed)) {
    return { valid: false, error: 'Value must be a valid number' }
  }

  if (integer && !Number.isInteger(parsed)) {
    return { valid: false, error: 'Value must be an integer' }
  }

  if (positive && parsed <= 0) {
    return { valid: false, error: 'Value must be positive' }
  }

  if (parsed < min || parsed > max) {
    return { valid: false, error: `Value must be between ${min} and ${max}` }
  }

  return { valid: true, parsed }
}

/**
 * Validate command options
 * @param {Object} options - Options object to validate
 * @param {Object} schema - Validation schema
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateOptions(options, schema) {
  const errors = []

  for (const [key, rules] of Object.entries(schema)) {
    const value = options[key]

    // Check required
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`Missing required option: ${key}`)
      continue
    }

    // Skip validation if not required and not provided
    if (!rules.required && (value === undefined || value === null)) {
      continue
    }

    // Type validation
    if (rules.type && typeof value !== rules.type) {
      errors.push(`Option ${key} must be of type ${rules.type}`)
      continue
    }

    // Custom validator
    if (rules.validator && !rules.validator(value)) {
      errors.push(`Option ${key} is invalid: ${rules.message || 'validation failed'}`)
      continue
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Create a validation result with suggestion
 * @param {boolean} valid - Whether validation passed
 * @param {string} error - Error message
 * @param {string} suggestion - Recovery suggestion
 * @returns {Object} Validation result
 */
export function validationResult(valid, error = '', suggestion = '') {
  return {
    valid,
    error,
    suggestion,
    toString() {
      if (valid) return 'Valid'
      let msg = error
      if (suggestion) msg += `. Suggestion: ${suggestion}`
      return msg
    }
  }
}

/**
 * Validate JSON safely (prevent prototype pollution)
 * @param {string} jsonStr - JSON string
 * @returns {Object} { valid: boolean, parsed?: any, error?: string }
 */
export function validateJson(jsonStr) {
  if (typeof jsonStr !== 'string') {
    return { valid: false, error: 'Input must be a string' }
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // Check for prototype pollution
    if (parsed && typeof parsed === 'object') {
      if (parsed.__proto__ !== Object.prototype) {
        return { valid: false, error: 'Prototype pollution detected' }
      }

      // Check constructor prototype
      if (parsed.constructor && parsed.constructor.prototype !== Object.prototype) {
        return { valid: false, error: 'Constructor prototype pollution detected' }
      }
    }

    return { valid: true, parsed }
  } catch (err) {
    return { valid: false, error: `Invalid JSON: ${err.message}` }
  }
}

// Export default validator instance for convenience
export const validator = {
  pubkey: validatePubkey,
  topic: validateTopic,
  groupId: validateGroupId,
  message: validateMessage,
  filePath: validateFilePath,
  number: validateNumber,
  json: validateJson,
  options: validateOptions,
  sanitizeString
}
