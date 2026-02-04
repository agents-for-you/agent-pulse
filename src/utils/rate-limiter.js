/**
 * @fileoverview Rate limiting utilities
 * Implements token bucket and sliding window rate limiters
 */

import { logger } from './logger.js'

const log = logger.child('rate-limiter')

/**
 * Token Bucket Rate Limiter
 * Allows bursts up to capacity, then refills at constant rate
 */
export class TokenBucket {
  /**
   * @param {Object} options - Configuration
   * @param {number} [options.capacity=100] - Maximum tokens
   * @param {number} [options.refillRate=10] - Tokens per second
   * @param {number} [options.refillInterval=100] - Refill check interval ms
   */
  constructor(options = {}) {
    this.capacity = options.capacity || 100
    this.refillRate = options.refillRate || 10 // tokens per second
    this.refillInterval = options.refillInterval || 100 // ms

    this.tokens = this.capacity
    this.lastRefill = Date.now()

    // Start refill timer
    this._timer = setInterval(() => this._refill(), this.refillInterval)
    this._timer.unref() // Don't keep process alive
  }

  /**
   * Refill tokens based on elapsed time
   * @private
   */
  _refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000 // seconds
    const tokensToAdd = Math.floor(elapsed * this.refillRate)

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd)
      this.lastRefill = now
    }
  }

  /**
   * Try to consume tokens
   * @param {number} count - Number of tokens to consume
   * @returns {boolean} Whether tokens were available
   */
  tryConsume(count = 1) {
    this._refill() // Ensure we have latest tokens

    if (this.tokens >= count) {
      this.tokens -= count
      return true
    }

    return false
  }

  /**
   * Get available token count
   * @returns {number} Available tokens
   */
  get available() {
    this._refill()
    return this.tokens
  }

  /**
   * Reset bucket to full capacity
   */
  reset() {
    this.tokens = this.capacity
    this.lastRefill = Date.now()
  }

  /**
   * Stop the refill timer
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }
}

/**
 * Sliding Window Rate Limiter
 * More accurate rate limiting using time windows
 */
export class SlidingWindowLimiter {
  /**
   * @param {Object} options - Configuration
   * @param {number} [options.maxRequests=100] - Maximum requests per window
   * @param {number} [options.windowMs=60000] - Time window in milliseconds
   */
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 100
    this.windowMs = options.windowMs || 60000 // 1 minute default
    this.requests = new Map() // key -> array of timestamps
  }

  /**
   * Try to make a request
   * @param {string} key - Identifier (e.g., IP address, pubkey)
   * @returns {Object} { allowed: boolean, resetTime?: number }
   */
  tryRequest(key) {
    const now = Date.now()
    const windowStart = now - this.windowMs

    // Get existing requests for this key
    let timestamps = this.requests.get(key) || []

    // Filter out timestamps outside the window
    timestamps = timestamps.filter(ts => ts > windowStart)

    // Check if under limit
    if (timestamps.length < this.maxRequests) {
      timestamps.push(now)
      this.requests.set(key, timestamps)

      // Calculate when the window resets
      const oldestTimestamp = timestamps[0] || now
      const resetTime = oldestTimestamp + this.windowMs

      return {
        allowed: true,
        remaining: this.maxRequests - timestamps.length,
        resetTime
      }
    }

    // Rate limited - calculate reset time
    const oldestTimestamp = timestamps[0]
    const resetTime = oldestTimestamp + this.windowMs

    return {
      allowed: false,
      remaining: 0,
      resetTime,
      retryAfter: Math.ceil((resetTime - now) / 1000) // seconds
    }
  }

  /**
   * Clear history for a key
   * @param {string} key - Identifier to clear
   */
  clear(key) {
    this.requests.delete(key)
  }

  /**
   * Clear all history
   */
  clearAll() {
    this.requests.clear()
  }

  /**
   * Get current status for a key
   * @param {string} key - Identifier
   * @returns {Object} { count: number, remaining: number }
   */
  getStatus(key) {
    const now = Date.now()
    const windowStart = now - this.windowMs

    const timestamps = (this.requests.get(key) || [])
      .filter(ts => ts > windowStart)

    return {
      count: timestamps.length,
      remaining: Math.max(0, this.maxRequests - timestamps.length)
    }
  }
}

/**
 * Per-key rate limiter with automatic cleanup
 * Useful for limiting message rates per sender
 */
export class PerKeyRateLimiter {
  /**
   * @param {Object} options - Configuration
   * @param {number} [options.maxPerKey=10] - Max requests per key per window
   * @param {number} [options.windowMs=60000] - Time window
   * @param {number} [options.cleanupInterval=300000] - Cleanup interval (5 min)
   */
  constructor(options = {}) {
    this.maxPerKey = options.maxPerKey || 10
    this.windowMs = options.windowMs || 60000
    this.cleanupInterval = options.cleanupInterval || 300000 // 5 min

    this.windows = new Map() // key -> SlidingWindowLimiter
    this.lastAccess = new Map() // key -> last access time

    // Start cleanup timer
    this._cleanupTimer = setInterval(() => this._cleanup(), this.cleanupInterval)
    this._cleanupTimer.unref()
  }

  /**
   * Get or create limiter for a key
   * @private
   */
  _getLimiter(key) {
    if (!this.windows.has(key)) {
      this.windows.set(key, new SlidingWindowLimiter({
        maxRequests: this.maxPerKey,
        windowMs: this.windowMs
      }))
    }
    this.lastAccess.set(key, Date.now())
    return this.windows.get(key)
  }

  /**
   * Try to make a request for a key
   * @param {string} key - Identifier
   * @returns {Object} Result from tryRequest
   */
  tryRequest(key) {
    return this._getLimiter(key).tryRequest(key)
  }

  /**
   * Cleanup inactive limiters
   * @private
   */
  _cleanup() {
    const now = Date.now()
    const staleThreshold = now - this.cleanupInterval * 2

    for (const [key, lastAccess] of this.lastAccess.entries()) {
      if (lastAccess < staleThreshold) {
        this.windows.delete(key)
        this.lastAccess.delete(key)
      }
    }

    if (this.windows.size > 0) {
      log.debug('Rate limiter cleanup', { activeLimiters: this.windows.size })
    }
  }

  /**
   * Clear history for a key
   * @param {string} key - Identifier
   */
  clear(key) {
    this.windows.delete(key)
    this.lastAccess.delete(key)
  }

  /**
   * Stop the cleanup timer
   */
  stop() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
      this._cleanupTimer = null
    }
  }
}

/**
 * Default rate limiter instance for messages
 * Limits messages per sender to prevent flooding
 */
export const messageRateLimiter = new PerKeyRateLimiter({
  maxPerKey: 30, // 30 messages per minute per sender
  windowMs: 60000
})

/**
 * Default rate limiter for commands
 * Limits command execution rate
 */
export const commandRateLimiter = new TokenBucket({
  capacity: 100,
  refillRate: 10 // 10 commands per second
})
