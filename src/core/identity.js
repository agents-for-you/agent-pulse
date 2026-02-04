/**
 * @fileoverview Nostr identity management module
 * Responsible for generating, loading, and managing Nostr key pairs
 */

import crypto from 'crypto'
import { getPublicKey } from 'nostr-tools'
import { readJson, writeJson } from './storage.js'
import { DEFAULT_IDENTITY_FILE } from '../config/defaults.js'
import { logger } from '../utils/logger.js'
import * as nip19 from './nip19.js'

const log = logger.child('identity')

/**
 * Convert byte array to hexadecimal string
 * @param {Uint8Array} bytes - Byte array
 * @returns {string} Hexadecimal string
 */
function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

/**
 * Convert hexadecimal string to byte array
 * @param {string} hex - Hexadecimal string
 * @returns {Uint8Array} Byte array
 */
function fromHex(hex) {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

/**
 * @typedef {Object} Identity
 * @property {Uint8Array} secretKey - Private key (32 bytes)
 * @property {string} publicKey - Public key (hexadecimal)
 * @property {Object} [agent] - Agent metadata
 * @property {string} [agent.name] - Agent name
 * @frozen
 */

/**
 * Create immutable identity object
 * @param {Uint8Array} secretKey - Private key
 * @param {string} publicKey - Public key
 * @returns {Identity} Frozen identity object
 */
function createIdentity(secretKey, publicKey) {
  // Note: Uint8Array cannot use Object.freeze()
  // Use getter to protect private key from direct modification
  const _secretKey = new Uint8Array(secretKey)

  const identity = {
    get secretKey() {
      return _secretKey
    },
    publicKey,
    agent: null
  }

  // Freeze object itself (but the array returned by secretKey getter can still be modified externally, which is expected)
  return Object.freeze(identity)
}

/**
 * Load identity from existing private key
 * @param {string} secretKeyHex - Private key in hexadecimal format
 * @returns {Identity} Identity object
 * @throws {Error} If private key format is invalid
 */
export function loadIdentityFromSecretKey(secretKeyHex) {
  if (!secretKeyHex || typeof secretKeyHex !== 'string' || secretKeyHex.length !== 64) {
    throw new Error('Invalid secret key format: must be 64-character hex string')
  }

  try {
    const secretKey = fromHex(secretKeyHex)
    const publicKey = getPublicKey(secretKey)
    log.debug('Loaded identity from secret key', { publicKey: publicKey.slice(0, 16) + '...' })
    return createIdentity(secretKey, publicKey)
  } catch (err) {
    throw new Error(`Failed to load identity: ${err.message}`)
  }
}

/**
 * Generate new identity
 * @returns {Identity} Newly generated identity object
 */
export function generateIdentity() {
  const secretKey = new Uint8Array(crypto.randomBytes(32))
  const publicKey = getPublicKey(secretKey)
  log.info('Generated new identity', { publicKey: publicKey.slice(0, 16) + '...' })
  return createIdentity(secretKey, publicKey)
}

/**
 * Load or create identity
 * @param {string} [identityFile=DEFAULT_IDENTITY_FILE] - Identity file path
 * @returns {Identity} Identity object
 * @throws {Error} If unable to load or create identity
 */
export function loadOrCreateIdentity(identityFile = DEFAULT_IDENTITY_FILE) {
  try {
    const existing = readJson(identityFile)

    if (existing?.secretKey) {
      log.debug('Loading existing identity', { file: identityFile })
      return loadIdentityFromSecretKey(existing.secretKey)
    }

    log.info('No existing identity found, generating new one', { file: identityFile })
    const identity = generateIdentity()

    // Save private key with secure permissions
    const saved = writeJson(identityFile, { secretKey: toHex(identity.secretKey) }, { secure: true })
    if (!saved) {
      log.warn('Failed to persist identity file', { file: identityFile })
    }

    return identity
  } catch (err) {
    log.error('Failed to load or create identity', { error: err.message })
    throw err
  }
}

/**
 * Get public key of identity
 * @param {Identity} identity - Identity object
 * @param {Object} [options] - Options
 * @param {boolean} [options.npub=false] - Return npub format instead of hex
 * @returns {string} Public key (hexadecimal or npub)
 */
export function getIdentityPublicKey(identity, options = {}) {
  const hexKey = identity.publicKey
  if (options?.npub) {
    return nip19.encodePublicKey(hexKey)
  }
  return hexKey
}

/**
 * Get public key in npub format
 * @param {Identity} identity - Identity object
 * @returns {string} Public key in npub (Bech32) format
 */
export function getIdentityPublicKeyNpub(identity) {
  return nip19.encodePublicKey(identity.publicKey)
}

/**
 * Export private key of identity (dangerous operation, for backup only)
 * Requires authorization token to execute
 * @param {Identity} identity - Identity object
 * @param {Object} options - Options
 * @param {string} [options.authorization] - Authorization token
 * @returns {string} Private key hexadecimal string
 * @throws {Error} If unauthorized
 */
export function exportSecretKey(identity, options = {}) {
  // Check authorization token (removed hardcoded default, must be set via environment variable)
  const envAuth = process.env.SECRET_KEY_EXPORT_AUTH
  if (!envAuth) {
    log.error('Secret key export disabled - no authorization tokens configured')
    throw new Error('Unauthorized: secret key export is not configured')
  }

  const authTokens = envAuth.split(',').map(t => t.trim()).filter(Boolean)
  if (authTokens.length === 0) {
    throw new Error('Unauthorized: no valid authorization tokens configured')
  }

  const providedAuth = options.authorization
  if (!providedAuth || !authTokens.includes(providedAuth)) {
    log.error('Unauthorized attempt to export secret key', {
      timestamp: Date.now(),
      hasAuth: !!providedAuth
    })
    throw new Error('Unauthorized: secret key export requires valid authorization token')
  }

  log.warn('Exporting secret key - authorized operation', {
    timestamp: Date.now(),
    auth: providedAuth.substring(0, 4) + '***' // Only log first 4 characters
  })
  return toHex(identity.secretKey)
}

/**
 * Export private key in nsec format (Bech32)
 * Requires authorization token to execute
 * @param {Identity} identity - Identity object
 * @param {Object} options - Options
 * @param {string} [options.authorization] - Authorization token
 * @returns {string} Private key in nsec (Bech32) format
 * @throws {Error} If unauthorized
 */
export function exportSecretKeyNsec(identity, options = {}) {
  // Check authorization token
  const envAuth = process.env.SECRET_KEY_EXPORT_AUTH
  if (!envAuth) {
    log.error('Secret key export disabled - no authorization tokens configured')
    throw new Error('Unauthorized: secret key export is not configured')
  }

  const authTokens = envAuth.split(',').map(t => t.trim()).filter(Boolean)
  if (authTokens.length === 0) {
    throw new Error('Unauthorized: no valid authorization tokens configured')
  }

  const providedAuth = options.authorization
  if (!providedAuth || !authTokens.includes(providedAuth)) {
    log.error('Unauthorized attempt to export secret key', {
      timestamp: Date.now(),
      hasAuth: !!providedAuth
    })
    throw new Error('Unauthorized: secret key export requires valid authorization token')
  }

  log.warn('Exporting secret key (nsec) - authorized operation', {
    timestamp: Date.now(),
    auth: providedAuth.substring(0, 4) + '***'
  })
  return nip19.encodeSecretKey(identity.secretKey)
}
