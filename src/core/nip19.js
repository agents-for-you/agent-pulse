/**
 * @fileoverview NIP-19 Bech32 encoding/decoding
 * Provides npub, nsec, note, and nprofile encoding utilities
 */

import * as nip19 from 'nostr-tools/nip19'
import { logger } from '../utils/logger.js'

const log = logger.child('nip19')

/**
 * NIP-19 prefix constants
 * @constant {Object}
 */
export const PREFIXES = {
  NPUB: 'npub',      // Public key
  NSEC: 'nsec',      // Private key
  NOTE: 'note',      // Event ID
  NPROFILE: 'nprofile' // Profile
}

/**
 * Encode hex public key to npub (Bech32)
 * @param {string} hexPublicKey - Hexadecimal public key
 * @returns {string} npub encoded string
 * @throws {Error} If encoding fails
 */
export function encodePublicKey(hexPublicKey) {
  try {
    return nip19.npubEncode(hexPublicKey)
  } catch (err) {
    log.error('Failed to encode public key', { error: err.message })
    throw new Error(`Failed to encode public key: ${err.message}`)
  }
}

/**
 * Decode npub to hex public key
 * @param {string} npub - npub encoded string
 * @returns {string} Hexadecimal public key
 * @throws {Error} If decoding fails or invalid format
 */
export function decodePublicKey(npub) {
  try {
    const decoded = nip19.decode(npub)
    if (decoded.type !== PREFIXES.NPUB) {
      throw new Error(`Invalid type: expected ${PREFIXES.NPUB}, got ${decoded.type}`)
    }
    return decoded.data
  } catch (err) {
    log.error('Failed to decode npub', { error: err.message })
    throw new Error(`Failed to decode npub: ${err.message}`)
  }
}

/**
 * Encode hex private key to nsec (Bech32)
 * @param {string|Uint8Array} secretKey - Private key (hex string or bytes)
 * @returns {string} nsec encoded string
 * @throws {Error} If encoding fails
 */
export function encodeSecretKey(secretKey) {
  try {
    const hexKey = typeof secretKey === 'string' ? secretKey : Buffer.from(secretKey).toString('hex')
    return nip19.nsecEncode(hexKey)
  } catch (err) {
    log.error('Failed to encode private key', { error: err.message })
    throw new Error(`Failed to encode private key: ${err.message}`)
  }
}

/**
 * Decode nsec to hex private key
 * @param {string} nsec - nsec encoded string
 * @returns {string} Hexadecimal private key
 * @throws {Error} If decoding fails or invalid format
 */
export function decodeSecretKey(nsec) {
  try {
    const decoded = nip19.decode(nsec)
    if (decoded.type !== PREFIXES.NSEC) {
      throw new Error(`Invalid type: expected ${PREFIXES.NSEC}, got ${decoded.type}`)
    }
    return decoded.data
  } catch (err) {
    log.error('Failed to decode nsec', { error: err.message })
    throw new Error(`Failed to decode nsec: ${err.message}`)
  }
}

/**
 * Detect and decode any NIP-19 key format
 * Automatically detects npub/nsec/hex format
 * @param {string} input - Input string (npub, nsec, or hex)
 * @param {'public'|'private'} keyType - Key type to decode
 * @returns {string} Hexadecimal key
 * @throws {Error} If decoding fails
 */
export function autoDecodeKey(input, keyType) {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input: must be a non-empty string')
  }

  // Strip whitespace
  const cleaned = input.trim()

  // Detect npub format
  if (cleaned.startsWith(PREFIXES.NPUB)) {
    if (keyType !== 'public') {
      throw new Error('Key type mismatch: npub is a public key format')
    }
    return decodePublicKey(cleaned)
  }

  // Detect nsec format
  if (cleaned.startsWith(PREFIXES.NSEC)) {
    if (keyType !== 'private') {
      throw new Error('Key type mismatch: nsec is a private key format')
    }
    return decodeSecretKey(cleaned)
  }

  // Assume hex format (validate length)
  const expectedLength = keyType === 'private' ? 64 : 66
  if (cleaned.length !== expectedLength) {
    throw new Error(`Invalid hex length: expected ${expectedLength} characters, got ${cleaned.length}`)
  }

  // Validate hex characters
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Invalid hex format: contains non-hexadecimal characters')
  }

  return cleaned
}

/**
 * Check if string is a valid npub
 * @param {string} input - Input string to check
 * @returns {boolean} True if valid npub
 */
export function isNpub(input) {
  try {
    if (!input || typeof input !== 'string') return false
    if (!input.startsWith(PREFIXES.NPUB)) return false
    decodePublicKey(input)
    return true
  } catch {
    return false
  }
}

/**
 * Check if string is a valid nsec
 * @param {string} input - Input string to check
 * @returns {boolean} True if valid nsec
 */
export function isNsec(input) {
  try {
    if (!input || typeof input !== 'string') return false
    if (!input.startsWith(PREFIXES.NSEC)) return false
    decodeSecretKey(input)
    return true
  } catch {
    return false
  }
}

/**
 * Format key for display (truncate middle section)
 * @param {string} key - Full key (hex or npub)
 * @param {number} [startLength=8] - Characters to keep at start
 * @param {number} [endLength=4] - Characters to keep at end
 * @returns {string} Truncated key (e.g., "npub1...abcd")
 */
export function truncateKey(key, startLength = 8, endLength = 4) {
  if (!key || key.length <= startLength + endLength) {
    return key
  }
  return `${key.slice(0, startLength)}...${key.slice(-endLength)}`
}
