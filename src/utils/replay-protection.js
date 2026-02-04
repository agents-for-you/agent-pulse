/**
 * @fileoverview Message replay protection module
 * Prevents replay attacks by tracking seen message nonces and timestamps
 */
import crypto from 'crypto'
import { logger } from './logger.js'
import { LRUCache } from '../service/shared.js'

const log = logger.child('replay-protection')

// Configuration
const NONCE_CACHE_SIZE = 10000 // Track up to 10K nonces
const TIMESTAMP_TOLERANCE_MS = 60000 // Accept messages within 60 seconds of clock skew

/**
 * Replay protection class using nonce tracking
 * Tracks seen message nonces to prevent duplicate processing
 */
export class ReplayProtection {
  /**
   * Create replay protection instance
   * @param {Object} options - Configuration options
   * @param {number} [options.cacheSize=NONCE_CACHE_SIZE] - Maximum nonces to track
   * @param {number} [options.timestampTolerance=TIMESTAMP_TOLERANCE_MS] - Clock skew tolerance
   */
  constructor(options = {}) {
    this.cacheSize = options.cacheSize || NONCE_CACHE_SIZE
    this.timestampTolerance = options.timestampTolerance || TIMESTAMP_TOLERANCE_MS

    // Track seen nonces: Map<nonce, timestamp>
    this.seenNonces = new LRUCache(this.cacheSize)

    // Statistics
    this.stats = {
      totalSeen: 0,
      replaysDetected: 0,
      clockSkewRejects: 0
    }
  }

  /**
   * Check if message nonce has been seen before
   * @param {string} nonce - Unique message identifier
   * @param {number} timestamp - Message timestamp in milliseconds
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  checkNonce(nonce, timestamp) {
    if (!nonce || typeof nonce !== 'string') {
      return { allowed: false, reason: 'Invalid nonce format' }
    }

    const now = Date.now()

    // Check timestamp validity (prevent replay of very old messages)
    const timeDiff = now - timestamp
    if (Math.abs(timeDiff) > this.timestampTolerance && Math.abs(timeDiff) < 365 * 24 * 60 * 60 * 1000) {
      // Message is too far in the past or future (but not impossibly old)
      this.stats.clockSkewRejects++
      log.debug('Message timestamp outside tolerance', {
        nonce: nonce.slice(0, 8),
        timeDiff,
        tolerance: this.timestampTolerance
      })
      return { allowed: false, reason: 'Timestamp outside tolerance window' }
    }

    // Check if nonce was seen before
    if (this.seenNonces.has(nonce)) {
      this.stats.replaysDetected++
      log.warn('Replay attack detected', {
        nonce: nonce.slice(0, 8) + '...',
        timestamp
      })
      return { allowed: false, reason: 'Nonce already seen (replay attack)' }
    }

    // Mark nonce as seen
    this.seenNonces.add(nonce)
    this.stats.totalSeen++

    return { allowed: true }
  }

  /**
   * Generate a cryptographically random nonce
   * @param {number} [bytes=16] - Number of random bytes
   * @returns {string} Hex-encoded nonce
   */
  static generateNonce(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex')
  }

  /**
   * Create message signature from content and timestamp
   * Combines content hash + timestamp for unique identification
   * @param {string} content - Message content
   * @param {string} senderPubkey - Sender public key
   * @param {number} timestamp - Message timestamp
   * @returns {string} Nonce string
   */
  static createMessageNonce(content, senderPubkey, timestamp) {
    const data = `${senderPubkey}:${timestamp}:${content}`
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.seenNonces.size,
      maxSize: this.cacheSize
    }
  }

  /**
   * Clear all tracked nonces (use with caution)
   */
  clear() {
    this.seenNonces.clear()
    log.info('Replay protection cache cleared')
  }

  /**
   * Clean old nonces based on timestamp (if using timestamped nonces)
   * This is a no-op for LRU cache which handles eviction automatically
   */
  cleanup() {
    // LRU cache handles automatic eviction
    // This method exists for future extension with time-based eviction
  }
}

// Singleton instance for worker
let replayProtection = null

/**
 * Get or create replay protection singleton
 * @param {Object} options - Configuration options
 * @returns {ReplayProtection} Replay protection instance
 */
export function getReplayProtection(options = {}) {
  if (!replayProtection) {
    replayProtection = new ReplayProtection(options)
  }
  return replayProtection
}

/**
 * Reset replay protection singleton (mainly for testing)
 */
export function resetReplayProtection() {
  replayProtection = null
}
