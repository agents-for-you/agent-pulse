/**
 * @fileoverview Relay manager
 * Dynamic scoring, failover, health monitoring
 */

import { promises as fs } from 'fs';
import { RELAY_STATS_FILE, atomicWriteFileSync } from '../service/shared.js';
import { logger } from '../utils/logger.js';

const log = logger.child('relay-manager');

/**
 * Debounced write configuration
 */
const DEBOUNCE_CONFIG = {
  IDLE_TIMEOUT: 30000,  // Save after 30 seconds of inactivity
  OPERATION_THRESHOLD: 10,  // Save after 10 operations
};

/**
 * @typedef {Object} RelayStats
 * @property {number} successCount - Success count
 * @property {number} failureCount - Failure count
 * @property {number} totalLatency - Total latency ms
 * @property {number} lastSuccess - Last success time
 * @property {number} lastFailure - Last failure time
 * @property {boolean} isHealthy - Whether healthy
 */

/**
 * Relay manager class
 */
export class RelayManager {
  /**
   * @param {string[]} relays - Initial Relay list
   * @param {Object} options - Configuration options
   */
  constructor(relays, options = {}) {
    this.relays = new Map();
    this.options = {
      minScore: 0.3,           // Minimum usable score
      healthCheckInterval: 30000, // Health check interval
      latencyWeight: 0.3,      // Latency weight
      successRateWeight: 0.7,  // Success rate weight
      ...options
    };

    // Initialize Relay statistics
    for (const relay of relays) {
      this.relays.set(relay, this._createStats());
    }

    // Debounced write state
    this._dirty = false;
    this._pendingOperations = 0;
    this._saveTimer = null;
    this._savePromise = null;
    this._loadPromise = null;

    // Schedule async load (non-blocking)
    this._loadPromise = this._loadStats().catch(err => {
      log.warn('Failed to load relay stats during init', { error: err.message });
    });
  }

  /**
   * Create initial stats object
   */
  _createStats() {
    return {
      successCount: 0,
      failureCount: 0,
      totalLatency: 0,
      lastSuccess: 0,
      lastFailure: 0,
      isHealthy: true
    };
  }

  /**
   * Load persisted statistics (async)
   * @private
   */
  async _loadStats() {
    try {
      const data = await fs.readFile(RELAY_STATS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      for (const [relay, stats] of Object.entries(parsed)) {
        if (this.relays.has(relay)) {
          this.relays.set(relay, { ...this._createStats(), ...stats });
        }
      }
      log.debug('Loaded relay stats', { count: Object.keys(parsed).length });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.warn('Failed to load relay stats', { error: err.message });
      }
    }
  }

  /**
   * Wait for initial load to complete
   * @returns {Promise<void>}
   */
  async ready() {
    if (this._loadPromise) {
      await this._loadPromise;
      this._loadPromise = null;
    }
  }

  /**
   * Schedule debounced save
   * @private
   */
  _scheduleSave() {
    this._dirty = true;
    this._pendingOperations++;

    // Clear existing timer
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }

    // Save immediately if operation threshold reached
    if (this._pendingOperations >= DEBOUNCE_CONFIG.OPERATION_THRESHOLD) {
      this._saveStats();
      return;
    }

    // Schedule save after idle timeout
    this._saveTimer = setTimeout(() => {
      this._saveStats();
    }, DEBOUNCE_CONFIG.IDLE_TIMEOUT);
  }

  /**
   * Save stats to file (async with deduplication)
   * @private
   */
  async _saveStats() {
    // Clear timer
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }

    // Skip if not dirty or already saving
    if (!this._dirty || this._savePromise) {
      return;
    }

    this._dirty = false;
    this._pendingOperations = 0;

    // Create save promise to prevent concurrent writes
    this._savePromise = (async () => {
      try {
        const data = {};
        for (const [relay, stats] of this.relays) {
          data[relay] = stats;
        }
        await fs.writeFile(RELAY_STATS_FILE, JSON.stringify(data, null, 2));
      } catch (err) {
        log.warn('Failed to save relay stats', { error: err.message });
      } finally {
        this._savePromise = null;
      }
    })();

    return this._savePromise;
  }

  /**
   * Flush pending stats to disk immediately
   * @returns {Promise<void>}
   */
  async flush() {
    if (this._dirty) {
      await this._saveStats();
    }
    // Wait for any in-flight save
    if (this._savePromise) {
      await this._savePromise;
    }
  }

  /**
   * Record success
   * @param {string} relay - Relay URL
   * @param {number} latency - Latency ms
   */
  recordSuccess(relay, latency = 0) {
    const stats = this.relays.get(relay);
    if (stats) {
      stats.successCount++;
      stats.totalLatency += latency;
      stats.lastSuccess = Date.now();
      stats.isHealthy = true;
      this._scheduleSave();
    }
  }

  /**
   * Record failure
   * @param {string} relay - Relay URL
   */
  recordFailure(relay) {
    const stats = this.relays.get(relay);
    if (stats) {
      stats.failureCount++;
      stats.lastFailure = Date.now();

      // Mark unhealthy if consecutive failures exceed threshold
      const recentFailures = this._getRecentFailureRate(relay);
      if (recentFailures > 0.5) {
        stats.isHealthy = false;
        log.warn('Relay marked unhealthy', { relay });
      }
      this._scheduleSave();
    }
  }

  /**
   * Get recent failure rate
   */
  _getRecentFailureRate(relay) {
    const stats = this.relays.get(relay);
    if (!stats) return 1;

    const total = stats.successCount + stats.failureCount;
    if (total === 0) return 0;

    return stats.failureCount / total;
  }

  /**
   * Calculate Relay score
   * @param {string} relay - Relay URL
   * @returns {number} 0-1 score
   */
  getScore(relay) {
    const stats = this.relays.get(relay);
    if (!stats) return 0;

    const total = stats.successCount + stats.failureCount;
    if (total === 0) return 0.5; // New Relay gets medium default score

    // Success rate
    const successRate = stats.successCount / total;

    // Average latency score (lower latency = higher score)
    const avgLatency = stats.successCount > 0 ? stats.totalLatency / stats.successCount : 1000;
    const latencyScore = Math.max(0, 1 - avgLatency / 5000); // 5s is worst

    // Combined score
    const score =
      successRate * this.options.successRateWeight +
      latencyScore * this.options.latencyWeight;

    // Downweight unhealthy Relays
    return stats.isHealthy ? score : score * 0.3;
  }

  /**
   * Get sorted healthy Relay list
   * @returns {string[]} Relay list sorted by score
   */
  getHealthyRelays() {
    const relays = [];

    for (const [relay, stats] of this.relays) {
      if (stats.isHealthy || this.getScore(relay) >= this.options.minScore) {
        relays.push({ relay, score: this.getScore(relay) });
      }
    }

    // Sort by score descending
    relays.sort((a, b) => b.score - a.score);

    return relays.map(r => r.relay);
  }

  /**
   * Get all Relays and their status
   * @returns {Array} Relay status list
   */
  getAllRelayStatus() {
    const result = [];

    for (const [relay, stats] of this.relays) {
      const total = stats.successCount + stats.failureCount;
      result.push({
        relay,
        healthy: stats.isHealthy,
        score: Math.round(this.getScore(relay) * 100) / 100,
        successRate: total > 0 ? Math.round(stats.successCount / total * 100) : 0,
        avgLatency: stats.successCount > 0 ? Math.round(stats.totalLatency / stats.successCount) : null,
        lastSuccess: stats.lastSuccess || null,
        lastFailure: stats.lastFailure || null
      });
    }

    return result.sort((a, b) => b.score - a.score);
  }

  /**
   * Add Relay
   * @param {string} relay - Relay URL
   */
  addRelay(relay) {
    if (!this.relays.has(relay)) {
      this.relays.set(relay, this._createStats());
      log.info('Added relay', { relay });
      this._scheduleSave();
    }
  }

  /**
   * Remove Relay
   * @param {string} relay - Relay URL
   */
  removeRelay(relay) {
    if (this.relays.delete(relay)) {
      log.info('Removed relay', { relay });
      this._scheduleSave();
    }
  }

  /**
   * Reset Relay statistics (for recovering unhealthy Relays)
   * @param {string} relay - Relay URL
   */
  resetRelay(relay) {
    if (this.relays.has(relay)) {
      this.relays.set(relay, this._createStats());
      log.info('Reset relay stats', { relay });
      this._scheduleSave();
    }
  }

  /**
   * Get best Relay
   * @returns {string|null} Best Relay URL
   */
  getBestRelay() {
    const healthy = this.getHealthyRelays();
    return healthy.length > 0 ? healthy[0] : null;
  }

  /**
   * Close the manager and flush pending saves
   * @returns {Promise<void>}
   */
  async close() {
    // Clear any pending timer
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    // Flush any pending saves
    await this.flush();
  }
}
