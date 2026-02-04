/**
 * @fileoverview Relay manager
 * Dynamic scoring, failover, health monitoring
 */

import fs from 'fs';
import { RELAY_STATS_FILE, atomicWriteFileSync } from '../service/shared.js';
import { logger } from '../utils/logger.js';

const log = logger.child('relay-manager');

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

    // Try to load persisted statistics
    this._loadStats();
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
   * Load persisted statistics
   */
  _loadStats() {
    try {
      if (fs.existsSync(RELAY_STATS_FILE)) {
        const data = JSON.parse(fs.readFileSync(RELAY_STATS_FILE, 'utf8'));
        for (const [relay, stats] of Object.entries(data)) {
          if (this.relays.has(relay)) {
            this.relays.set(relay, { ...this._createStats(), ...stats });
          }
        }
        log.debug('Loaded relay stats', { count: Object.keys(data).length });
      }
    } catch (err) {
      log.warn('Failed to load relay stats', { error: err.message });
    }
  }

  /**
   * Save stats to file
   */
  _saveStats() {
    try {
      const data = {};
      for (const [relay, stats] of this.relays) {
        data[relay] = stats;
      }
      atomicWriteFileSync(RELAY_STATS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn('Failed to save relay stats', { error: err.message });
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
      this._saveStats();
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
      this._saveStats();
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
      this._saveStats();
    }
  }

  /**
   * Remove Relay
   * @param {string} relay - Relay URL
   */
  removeRelay(relay) {
    if (this.relays.delete(relay)) {
      log.info('Removed relay', { relay });
      this._saveStats();
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
      this._saveStats();
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
}
