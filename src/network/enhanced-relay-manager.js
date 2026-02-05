/**
 * @fileoverview Enhanced relay manager with blacklist and recovery
 * Provides relay health monitoring, automatic failover, and multi-path publishing
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { RELAY_STATS_FILE, DATA_DIR, atomicWriteFileSync, ensureDataDir } from '../service/shared.js'
import { logger } from '../utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const log = logger.child('relay-manager')

const BLACKLIST_FILE = path.join(__dirname, '../../.data/relay_blacklist.json')
const HEALTH_HISTORY_FILE = path.join(__dirname, '../../.data/relay_health_history.json')

/**
 * Enhanced relay manager with reliability features
 */
export class EnhancedRelayManager {
  /**
   * @param {string[]} relays - Initial relay list
   * @param {Object} options - Configuration options
   */
  constructor(relays, options = {}) {
    this.relays = new Map()
    this.blacklist = new Set()
    this.healthHistory = new Map()

    this.options = {
      minScore: 0.3,
      healthCheckInterval: 30000,
      latencyWeight: 0.3,
      successRateWeight: 0.7,
      blacklistThreshold: 10,
      recoveryAttempts: 3,
      multiPathCount: 3,
      minHealthyRelays: 2,
      ...options
    }

    // Initialize relay statistics
    for (const relay of relays) {
      this.relays.set(relay, this._createStats())
    }

    this._loadStats()
    this._loadBlacklist()
    this._loadHealthHistory()

    // Start health monitoring
    this._startHealthCheck()
  }

  /**
   * Create initial stats object
   * @private
   */
  _createStats() {
    return {
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalLatency: 0,
      lastSuccess: 0,
      lastFailure: 0,
      isHealthy: true,
      blacklisted: false,
      recoveryAttempts: 0
    }
  }

  /**
   * Load persisted statistics
   * @private
   */
  _loadStats() {
    try {
      if (fs.existsSync(RELAY_STATS_FILE)) {
        const data = JSON.parse(fs.readFileSync(RELAY_STATS_FILE, 'utf8'))
        for (const [relay, stats] of Object.entries(data)) {
          if (this.relays.has(relay)) {
            this.relays.set(relay, { ...this._createStats(), ...stats })
          }
        }
        log.debug('Loaded relay stats', { count: Object.keys(data).length })
      }
    } catch (err) {
      log.warn('Failed to load relay stats', { error: err.message })
    }
  }

  /**
   * Save stats to file
   * @private
   */
  _saveStats() {
    try {
      const data = {}
      for (const [relay, stats] of this.relays) {
        data[relay] = stats
      }
      ensureDataDir()
      atomicWriteFileSync(RELAY_STATS_FILE, JSON.stringify(data, null, 2))
    } catch (err) {
      log.warn('Failed to save relay stats', { error: err.message })
    }
  }

  /**
   * Load blacklist
   * @private
   */
  _loadBlacklist() {
    try {
      if (fs.existsSync(BLACKLIST_FILE)) {
        const data = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8'))
        const blacklist = data.relays || []
        for (const relay of blacklist) {
          this.blacklist.add(relay)
          const stats = this.relays.get(relay)
          if (stats) {
            stats.blacklisted = true
          }
        }
        log.debug('Loaded blacklist', { count: this.blacklist.size })
      }
    } catch (err) {
      log.warn('Failed to load blacklist', { error: err.message })
    }
  }

  /**
   * Save blacklist
   * @private
   */
  _saveBlacklist() {
    try {
      ensureDataDir()
      atomicWriteFileSync(
        BLACKLIST_FILE,
        JSON.stringify({ relays: Array.from(this.blacklist), updatedAt: Date.now() }, null, 2)
      )
    } catch (err) {
      log.warn('Failed to save blacklist', { error: err.message })
    }
  }

  /**
   * Load health history
   * @private
   */
  _loadHealthHistory() {
    try {
      if (fs.existsSync(HEALTH_HISTORY_FILE)) {
        const data = JSON.parse(fs.readFileSync(HEALTH_HISTORY_FILE, 'utf8'))
        for (const [relay, history] of Object.entries(data)) {
          this.healthHistory.set(relay, history)
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Save health history
   * @private
   */
  _saveHealthHistory() {
    try {
      ensureDataDir()
      const data = {}
      for (const [relay, history] of this.healthHistory) {
        data[relay] = history
      }
      atomicWriteFileSync(HEALTH_HISTORY_FILE, JSON.stringify(data, null, 2))
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Record success
   * @param {string} relay - Relay URL
   * @param {number} latency - Latency ms
   */
  recordSuccess(relay, latency = 0) {
    const stats = this.relays.get(relay)
    if (!stats) return

    stats.successCount++
    stats.consecutiveSuccesses++
    stats.consecutiveFailures = 0
    stats.totalLatency += latency
    stats.lastSuccess = Date.now()
    stats.isHealthy = true

    // Try to recover blacklisted relay
    if (stats.blacklisted) {
      this._attemptRecovery(relay)
    }

    // Record health history
    this._recordHealthHistory(relay, true)

    this._saveStats()
  }

  /**
   * Record failure
   * @param {string} relay - Relay URL
   */
  recordFailure(relay) {
    const stats = this.relays.get(relay)
    if (!stats) return

    stats.failureCount++
    stats.consecutiveFailures++
    stats.consecutiveSuccesses = 0
    stats.lastFailure = Date.now()

    // Check if should blacklist
    if (stats.consecutiveFailures >= this.options.blacklistThreshold) {
      this._blacklistRelay(relay)
    } else {
      // Mark unhealthy if recent failure rate is high
      const recentFailures = this._getRecentFailureRate(relay)
      if (recentFailures > 0.5) {
        stats.isHealthy = false
        log.warn('Relay marked unhealthy', { relay, consecutiveFailures: stats.consecutiveFailures })
      }
    }

    this._recordHealthHistory(relay, false)
    this._saveStats()
  }

  /**
   * Record health history
   * @private
   */
  _recordHealthHistory(relay, success) {
    if (!this.healthHistory.has(relay)) {
      this.healthHistory.set(relay, { checks: [] })
    }
    const history = this.healthHistory.get(relay)
    history.checks.push({ success, time: Date.now() })

    // Keep only last 100 checks
    if (history.checks.length > 100) {
      history.checks = history.checks.slice(-100)
    }

    this._saveHealthHistory()
  }

  /**
   * Blacklist a relay
   * @private
   */
  _blacklistRelay(relay) {
    const stats = this.relays.get(relay)
    if (stats && !stats.blacklisted) {
      stats.blacklisted = true
      this.blacklist.add(relay)
      log.error('Relay blacklisted due to failures', {
        relay,
        consecutiveFailures: stats.consecutiveFailures
      })
      this._saveBlacklist()
      this._saveStats()
    }
  }

  /**
   * Attempt to recover a blacklisted relay
   * @private
   */
  _attemptRecovery(relay) {
    const stats = this.relays.get(relay)
    if (!stats || !stats.blacklisted) return

    stats.recoveryAttempts++

    // Recovery successful after several consecutive successes
    if (stats.consecutiveSuccesses >= 5) {
      log.info('Relay recovered from blacklist', { relay })
      stats.blacklisted = false
      stats.consecutiveFailures = 0
      stats.recoveryAttempts = 0
      this.blacklist.delete(relay)
      this._saveBlacklist()
    }
  }

  /**
   * Get recent failure rate
   * @private
   */
  _getRecentFailureRate(relay) {
    const stats = this.relays.get(relay)
    if (!stats) return 1

    // Weight recent failures more heavily
    const total = stats.successCount + stats.failureCount
    if (total === 0) return 0

    // Use consecutive failures as a stronger signal
    const consecutiveWeight = 0.7
    const overallWeight = 0.3

    const overallRate = stats.failureCount / total
    const consecutiveRate = Math.min(stats.consecutiveFailures / 10, 1) // Cap at 10

    return overallRate * overallWeight + consecutiveRate * consecutiveWeight
  }

  /**
   * Calculate relay score
   * @param {string} relay - Relay URL
   * @returns {number} 0-1 score
   */
  getScore(relay) {
    const stats = this.relays.get(relay)
    if (!stats || stats.blacklisted) return 0

    const total = stats.successCount + stats.failureCount
    if (total === 0) return 0.5 // New relay gets medium score

    // Success rate
    const successRate = stats.successCount / total

    // Average latency score
    const avgLatency = stats.successCount > 0 ? stats.totalLatency / stats.successCount : 1000
    const latencyScore = Math.max(0, 1 - avgLatency / 5000)

    // Consecutive failures penalty
    const failurePenalty = Math.pow(0.9, stats.consecutiveFailures)

    // Combined score
    const score = (
      successRate * this.options.successRateWeight +
      latencyScore * this.options.latencyWeight
    ) * failurePenalty

    return stats.isHealthy ? score : score * 0.3
  }

  /**
   * Get healthy relays excluding blacklisted
   * @returns {string[]} Relay list sorted by score
   */
  getHealthyRelays() {
    const relays = []

    for (const [relay, stats] of this.relays) {
      if (stats.blacklisted) continue
      if (!stats.isHealthy && this.getScore(relay) < this.options.minScore) continue

      relays.push({ relay, score: this.getScore(relay) })
    }

    // Sort by score descending
    relays.sort((a, b) => b.score - a.score)

    return relays.map(r => r.relay)
  }

  /**
   * Get relays for multi-path publishing
   * Returns the top N relays by score
   * @param {number} count - Number of relays to return
   * @returns {string[]} Relay list
   */
  getMultiPathRelays(count = null) {
    const targetCount = count || this.options.multiPathCount
    const healthy = this.getHealthyRelays()

    // Ensure we have minimum healthy relays
    if (healthy.length < this.options.minHealthyRelays) {
      log.warn('Not enough healthy relays', {
        available: healthy.length,
        minimum: this.options.minHealthyRelays
      })
    }

    return healthy.slice(0, targetCount)
  }

  /**
   * Get all relay status
   * @returns {Array} Relay status list
   */
  getAllRelayStatus() {
    const result = []

    for (const [relay, stats] of this.relays) {
      const total = stats.successCount + stats.failureCount
      result.push({
        relay,
        healthy: stats.isHealthy,
        blacklisted: stats.blacklisted,
        score: Math.round(this.getScore(relay) * 100) / 100,
        successRate: total > 0 ? Math.round(stats.successCount / total * 100) : 0,
        avgLatency: stats.successCount > 0 ? Math.round(stats.totalLatency / stats.successCount) : null,
        consecutiveFailures: stats.consecutiveFailures,
        lastSuccess: stats.lastSuccess || null,
        lastFailure: stats.lastFailure || null
      })
    }

    return result.sort((a, b) => b.score - a.score)
  }

  /**
   * Get blacklist
   * @returns {string[]} Blacklisted relay URLs
   */
  getBlacklist() {
    return Array.from(this.blacklist)
  }

  /**
   * Manually blacklist a relay
   * @param {string} relay - Relay URL
   */
  blacklistRelay(relay) {
    const stats = this.relays.get(relay)
    if (stats) {
      stats.blacklisted = true
      this.blacklist.add(relay)
      log.warn('Relay manually blacklisted', { relay })
      this._saveBlacklist()
      this._saveStats()
    }
  }

  /**
   * Unblacklist a relay
   * @param {string} relay - Relay URL
   */
  unblacklistRelay(relay) {
    const stats = this.relays.get(relay)
    if (stats) {
      stats.blacklisted = false
      stats.consecutiveFailures = 0
      stats.recoveryAttempts = 0
      this.blacklist.delete(relay)
      log.info('Relay unblacklisted', { relay })
      this._saveBlacklist()
      this._saveStats()
    }
  }

  /**
   * Add relay
   * @param {string} relay - Relay URL
   */
  addRelay(relay) {
    if (!this.relays.has(relay)) {
      this.relays.set(relay, this._createStats())
      log.info('Added relay', { relay })
      this._saveStats()
    }
  }

  /**
   * Remove relay
   * @param {string} relay - Relay URL
   */
  removeRelay(relay) {
    if (this.relays.delete(relay)) {
      this.blacklist.delete(relay)
      this.healthHistory.delete(relay)
      log.info('Removed relay', { relay })
      this._saveStats()
      this._saveBlacklist()
      this._saveHealthHistory()
    }
  }

  /**
   * Get best relay
   * @returns {string|null} Best relay URL
   */
  getBestRelay() {
    const healthy = this.getHealthyRelays()
    return healthy.length > 0 ? healthy[0] : null
  }

  /**
   * Reset relay statistics
   * @param {string} relay - Relay URL
   */
  resetRelay(relay) {
    if (this.relays.has(relay)) {
      this.relays.set(relay, this._createStats())
      this.blacklist.delete(relay)
      log.info('Reset relay stats', { relay })
      this._saveStats()
      this._saveBlacklist()
    }
  }

  /**
   * Start health check timer
   * @private
   */
  _startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }

    this.healthCheckTimer = setInterval(() => {
      this._performHealthCheck()
    }, this.options.healthCheckInterval || 60000)

    log.debug('Health check timer started')
  }

  /**
   * Perform health check on all relays
   * @private
   */
  async _performHealthCheck() {
    log.debug('Performing health check on all relays')

    // This would normally connect to each relay and check status
    // For now, just log the current state
    const healthyCount = Array.from(this.relays.values()).filter(s => s.isHealthy && !s.blacklisted).length
    const blacklistedCount = this.blacklist.size

    log.debug('Health check complete', {
      total: this.relays.size,
      healthy: healthyCount,
      blacklisted: blacklistedCount
    })
  }

  /**
   * Stop health check timer
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
      log.debug('Health check timer stopped')
    }
  }

  /**
   * Get health summary
   * @returns {Object} Health summary
   */
  getHealthSummary() {
    const total = this.relays.size
    let healthy = 0
    let unhealthy = 0
    let blacklisted = 0

    for (const stats of this.relays.values()) {
      if (stats.blacklisted) {
        blacklisted++
      } else if (stats.isHealthy) {
        healthy++
      } else {
        unhealthy++
      }
    }

    return { total, healthy, unhealthy, blacklisted }
  }
}

// Export the class as default
export default EnhancedRelayManager
