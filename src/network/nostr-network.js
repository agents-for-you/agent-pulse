/**
 * @fileoverview Nostr network communication layer
 * Provides P2P communication based on Nostr protocol
 */

import { SimplePool, finalizeEvent, verifyEvent } from 'nostr-tools'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
import { DEFAULT_RELAYS, DEFAULT_TOPIC, NETWORK_CONFIG } from '../config/defaults.js'
import { logger } from '../utils/logger.js'
import { LRUCache } from '../service/shared.js'

useWebSocketImplementation(WebSocket)

const log = logger.child('network')

/**
 * Agent-specific event type (NIP-78 replaceable event)
 * @constant {number}
 */
const AGENT_KIND = 30078

/**
 * @typedef {Object} NetworkOptions
 * @property {string[]} [relays] - Relay address list
 * @property {string} [topic] - Topic/channel
 * @property {Object} identity - Identity object
 * @property {number} [connectionTimeout] - Connection timeout (ms)
 * @property {number} [maxPeers] - Maximum peer cache size
 * @property {boolean} [autoReconnect] - Auto reconnect
 * @property {number} [reconnectInterval] - Reconnect interval (ms)
 */

/**
 * @typedef {Object} Message
 * @property {string} type - Message type (announce|broadcast|task|result)
 * @property {string} from - Sender public key
 * @property {string} [to] - Recipient public key (task/result)
 * @property {Object} [agent] - Agent metadata
 * @property {number} ts - Timestamp
 * @property {*} [message] - Message content (broadcast)
 * @property {*} [task] - Task content (task)
 * @property {*} [result] - Result content (result)
 */

/**
 * Nostr network communication class
 */
export class NostrNetwork {
  /**
   * Create NostrNetwork instance
   * @param {NetworkOptions} options - Configuration options
   */
  constructor({
    relays = DEFAULT_RELAYS,
    topic = DEFAULT_TOPIC,
    identity,
    connectionTimeout = NETWORK_CONFIG.CONNECTION_TIMEOUT,
    maxPeers = NETWORK_CONFIG.MAX_PEERS,
    autoReconnect = NETWORK_CONFIG.AUTO_RECONNECT,
    reconnectInterval = NETWORK_CONFIG.RECONNECT_INTERVAL
  } = {}) {
    if (!identity) {
      throw new Error('Identity is required')
    }

    this.relays = relays
    this.topic = topic
    this.identity = identity
    this.connectionTimeout = connectionTimeout
    this.maxPeers = maxPeers
    this.autoReconnect = autoReconnect
    this.reconnectInterval = reconnectInterval

    // SimplePool configuration: silence NOTICE messages
    this.pool = new SimplePool({
      eoseSubTimeout: 5000,
      getTimeout: 5000
    })

    // Override relay notice handler (silence handling)
    this._originalConsoleLog = null

    this.knownPeers = new LRUCache(maxPeers)
    this.sub = null
    this.onMessage = null
    this.isConnected = false
    this.reconnectTimer = null
    this.relayHealth = new Map()

    // Initialize relay health tracking
    for (const relay of relays) {
      this.relayHealth.set(relay, {
        successCount: 0,
        failureCount: 0,
        lastSuccess: null,
        lastFailure: null,
        lastLatency: null,
        avgLatency: null,
        score: 100 // Initial score, decreases with failures
      })
    }
  }

  /**
   * Get relays sorted by health score (best first)
   * @returns {string[]} Sorted relay list
   */
  getSortedRelays() {
    return [...this.relayHealth.entries()]
      .sort(([, a], [, b]) => {
        // First prioritize by score
        if (a.score !== b.score) return b.score - a.score
        // Then by recency of success
        if (a.lastSuccess && b.lastSuccess) {
          return b.lastSuccess - a.lastSuccess
        }
        return a.lastSuccess ? -1 : 1
      })
      .map(([relay]) => relay)
  }

  /**
   * Get healthy relays (score > 30)
   * @returns {string[]} Healthy relay list
   */
  getHealthyRelays() {
    return this.getSortedRelays().filter(relay => {
      const health = this.relayHealth.get(relay)
      return health && health.score > 30
    })
  }

  /**
   * Record relay connection success
   * @private
   * @param {string} relay - Relay URL
   * @param {number} latency - Connection latency in ms
   */
  _recordSuccess(relay, latency = 0) {
    const health = this.relayHealth.get(relay)
    if (!health) return

    health.successCount++
    health.lastSuccess = Date.now()
    health.lastLatency = latency

    // Update average latency
    if (health.avgLatency === null) {
      health.avgLatency = latency
    } else {
      health.avgLatency = Math.round((health.avgLatency * 0.8) + (latency * 0.2))
    }

    // Increase score (max 100)
    health.score = Math.min(100, health.score + 5)

    log.debug('Relay success', { relay, score: health.score, latency })
  }

  /**
   * Record relay connection failure
   * @private
   * @param {string} relay - Relay URL
   * @param {string} error - Error message
   */
  _recordFailure(relay, error) {
    const health = this.relayHealth.get(relay)
    if (!health) return

    health.failureCount++
    health.lastFailure = Date.now()

    // Decrease score based on error type
    if (error?.includes('ENOTFOUND') || error?.includes('ECONNREFUSED')) {
      health.score -= 15 // Permanent errors hurt more
    } else if (error?.includes('timeout') || error?.includes('502')) {
      health.score -= 5 // Temporary errors
    } else {
      health.score -= 10 // Other errors
    }

    health.score = Math.max(0, health.score)

    log.debug('Relay failure', { relay, score: health.score, error })
  }

  /**
   * Get relay health status
   * @returns {Object} Relay health info
   */
  getRelayHealth() {
    const result = {}
    for (const [relay, health] of this.relayHealth.entries()) {
      result[relay] = {
        score: health.score,
        successRate: health.successCount + health.failureCount > 0
          ? Math.round((health.successCount / (health.successCount + health.failureCount)) * 100)
          : null,
        avgLatency: health.avgLatency,
        lastSuccess: health.lastSuccess,
        isHealthy: health.score > 30
      }
    }
    return result
  }

  /**
   * Safe JSON parsing (prevent prototype pollution attack)
   * @private
   * @param {string} str - JSON string
   * @returns {Object|null} Parsed object
   */
  _safeJsonParse(str) {
    try {
      const obj = JSON.parse(str)
      // Comprehensive prototype pollution detection
      if (obj && typeof obj === 'object') {
        // Check direct prototype pollution
        if (obj.__proto__ !== Object.prototype) {
          log.warn('Prototype pollution detected: __proto__ modified')
          return null
        }

        // Check constructor prototype pollution
        if (obj.constructor && obj.constructor.prototype !== Object.prototype) {
          log.warn('Prototype pollution detected: constructor.prototype modified')
          return null
        }

        // Check for dangerous prototype pollution keys
        const dangerousKeys = ['__proto__', 'constructor', 'prototype']
        for (const key of Object.keys(obj)) {
          if (dangerousKeys.includes(key)) {
            log.warn('Prototype pollution attempt detected', { key })
            return null
          }
        }

        // Deep check nested objects (recursive, limited depth)
        const POLLUTION_MAX_DEPTH = 5
        const checkNested = (o, depth = 0) => {
          if (depth > POLLUTION_MAX_DEPTH) return true
          if (!o || typeof o !== 'object') return true

          for (const key of Object.keys(o)) {
            if (dangerousKeys.includes(key)) {
              log.warn('Nested prototype pollution detected', { key, depth })
              return false
            }
            if (!checkNested(o[key], depth + 1)) {
              return false
            }
          }
          return true
        }

        if (!checkNested(obj)) {
          return null
        }
      }
      return obj
    } catch (err) {
      log.debug('JSON parse failed', { error: err.message })
      return null
    }
  }

  /**
   * @deprecated No longer need console hijacking, SimplePool has built-in handling
   * @private
   */
  _silenceNotices() {
    // No longer hijack console.log, avoid security risk
    // NOTICE messages from SimplePool are now handled through logging system
  }

  /**
   * @deprecated No longer need console restore
   * @private
   */
  _restoreConsole() {
    // No longer hijack console.log
  }

  /**
   * Connect to Nostr network
   * @param {Function} onMessage - Message callback
   * @param {Object} [options={}] - Connection options
   * @param {number} [options.timeout] - Connection timeout
   * @returns {Promise<void>}
   * @throws {Error} If connection fails or times out
   */
  async connect(onMessage, { timeout = this.connectionTimeout } = {}) {
    this.onMessage = onMessage

    // Silence relay NOTICE messages
    this._silenceNotices()

    const filter = {
      kinds: [AGENT_KIND],
      '#d': [this.topic],
      since: Math.floor(Date.now() / 1000) - NETWORK_CONFIG.MESSAGE_HISTORY_SECONDS
    }

    log.info('Connecting to Nostr network', {
      relays: this.relays.length,
      topic: this.topic
    })

    try {
      // Create subscription
      this.sub = this.pool.subscribeMany(this.relays, [filter], {
        onevent: (event) => this._handleEvent(event),
        oneose: () => {
          log.debug('End of stored events')
        },
        onclose: (reasons) => {
          log.warn('Subscription closed', { reasons })
          this._handleDisconnect()
        }
      })

      // Wait for at least one relay response (with timeout)
      await this._waitForConnection(timeout)

      this.isConnected = true
      log.info('Connected to Nostr network')

      // Send announce message
      await this.announce()

    } catch (err) {
      log.error('Failed to connect', { error: err.message })
      this._handleDisconnect()
      throw err
    }
  }

  /**
   * Wait for connection to be established with individual relay tracking
   * @private
   * @param {number} timeout - Timeout
   * @returns {Promise<void>}
   */
  async _waitForConnection(timeout) {
    const startTime = Date.now()
    const sortedRelays = this.getSortedRelays()

    log.debug('Attempting connection (sorted by health)', {
      relays: sortedRelays.length,
      top3: sortedRelays.slice(0, 3)
    })

    // Try each relay individually to track results
    const connectionPromises = sortedRelays.map(relay => {
      const testEvent = finalizeEvent(
        {
          kind: AGENT_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['d', this.topic]],
          content: JSON.stringify({ type: '_ping', ts: Date.now() })
        },
        this.identity.secretKey
      )

      return this.pool.publish([relay], testEvent)
        .then(() => {
          const latency = Date.now() - startTime
          this._recordSuccess(relay, latency)
          return { relay, success: true, latency }
        })
        .catch(err => {
          this._recordFailure(relay, err.message)
          return { relay, success: false, error: err.message }
        })
    })

    // Wait for first success or timeout
    const result = await Promise.race([
      Promise.any(connectionPromises.filter(p => p.then(r => r.success))),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout)
      )
    ]).catch(() => ({ success: false }))

    if (result.success) {
      log.info('Connection established', { relay: result.relay, latency: result.latency })
      return
    }

    // Check if any relay succeeded
    const results = await Promise.allSettled(connectionPromises)
    const successes = results.filter(r => r.status === 'fulfilled' && r.value.success)

    if (successes.length > 0) {
      log.info('Connection established (after timeout)', {
        relays: successes.map(s => s.value.relay)
      })
      return
    }

    throw new Error('All relays failed to connect')
  }

  /**
   * Handle disconnect
   * @private
   */
  _handleDisconnect() {
    this.isConnected = false

    if (this.autoReconnect && !this.reconnectTimer) {
      log.info('Scheduling reconnect', { interval: this.reconnectInterval })
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this._attemptReconnect()
      }, this.reconnectInterval)
    }
  }

  /**
   * Attempt to reconnect
   * @private
   */
  async _attemptReconnect() {
    if (this.isConnected) return

    log.info('Attempting to reconnect')
    try {
      await this.connect(this.onMessage)
    } catch (err) {
      log.error('Reconnect failed', { error: err.message })
      this._handleDisconnect()
    }
  }

  /**
   * Handle received event
   * @private
   * @param {Object} event - Nostr event
   */
  _handleEvent(event) {
    try {
      // Verify event signature
      if (!verifyEvent(event)) {
        log.warn('Invalid event signature', { eventId: event.id })
        return
      }

      const msg = this._safeJsonParse(event.content)
      if (!msg) {
        log.debug('Failed to parse event content')
        return
      }

      // Verify message structure
      if (!msg.type || !msg.from) {
        log.debug('Invalid message structure')
        return
      }

      // Verify timestamp (prevent replay attack) - 5 minute validity
      const MESSAGE_TTL = 300000 // 5 minutes
      if (msg.ts && (Date.now() - msg.ts > MESSAGE_TTL)) {
        log.debug('Message expired', { age: Date.now() - msg.ts })
        return
      }

      // Ignore own messages
      if (msg.from === this.identity.publicKey) return

      // Ignore ping test messages
      if (msg.type === '_ping') return

      // Update known peers (limit cache size to prevent memory leak)
      if (msg.from && this.knownPeers.size < this.maxPeers) {
        this.knownPeers.set(msg.from, {
          lastSeen: Date.now(),
          nostrPubkey: event.pubkey,
          agentName: msg.agent?.name || 'Agent'
        })
      }

      log.debug('Received message', { type: msg.type, from: msg.from?.slice(0, 16) })

      // Call message callback
      if (this.onMessage) {
        this.onMessage(msg, event)
      }
    } catch (err) {
      log.debug('Failed to parse event', { error: err.message })
    }
  }

  /**
   * Send announce message
   * @returns {Promise<void>}
   */
  async announce() {
    await this.publish({
      type: 'announce',
      from: this.identity.publicKey,
      agent: this.identity.agent,
      ts: Date.now()
    })
    log.debug('Announced presence')
  }

  /**
   * Publish message to Nostr network
   * @param {Message} payload - Message content
   * @param {Object} options - Publish options
   * @param {boolean} [options.multiPath=false] - Use multi-path publishing
   * @param {number} [options.multiPathCount=3] - Number of relays for multi-path
   * @returns {Promise<{success: boolean, relays: Array, errors: Array}>}
   * @throws {Error} If publish fails
   */
  async publish(payload, options = {}) {
    if (!this.isConnected && payload.type !== '_ping') {
      throw new Error('Not connected to network')
    }

    const event = finalizeEvent(
      {
        kind: AGENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', this.topic]],
        content: JSON.stringify(payload)
      },
      this.identity.secretKey
    )

    const { multiPath = false, multiPathCount = 3 } = options

    if (multiPath) {
      return await this._publishMultiPath(event, multiPathCount)
    }

    try {
      await Promise.any(this.pool.publish(this.relays, event))
      log.debug('Published message', { type: payload.type })
      return { success: true, relays: this.relays, errors: [] }
    } catch (err) {
      log.error('Failed to publish message', { type: payload.type, error: err.message })
      throw new Error(`Failed to publish: ${err.message}`)
    }
  }

  /**
   * Publish to multiple relays simultaneously for reliability
   * Uses healthy relays first based on health tracking
   * @private
   * @param {Object} event - Nostr event
   * @param {number} count - Number of relays to use
   * @returns {Promise<Object>} Publish result
   */
  async _publishMultiPath(event, count = 3) {
    // Use healthy relays first, then fall back to sorted relays
    const healthyRelays = this.getHealthyRelays()
    const sortedRelays = this.getSortedRelays()
    const selectedRelays = healthyRelays.length >= count
      ? healthyRelays.slice(0, count)
      : sortedRelays.slice(0, count)

    const results = []
    const startTime = Date.now()

    // Publish to each selected relay simultaneously
    const publishPromises = selectedRelays.map(relay =>
      this.pool.publish([relay], event)
        .then(() => {
          const latency = Date.now() - startTime
          this._recordSuccess(relay, latency)
          return { relay, success: true, latency }
        })
        .catch(err => {
          this._recordFailure(relay, err.message)
          return { relay, success: false, error: err.message }
        })
    )

    const publishResults = await Promise.allSettled(publishPromises)

    for (const result of publishResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
      }
    }

    const successful = results.filter(r => r.success)
    const failed = results.filter(r => !r.success)

    log.debug('Multi-path publish result', {
      total: selectedRelays.length,
      successful: successful.length,
      failed: failed.length,
      avgLatency: successful.length > 0
        ? Math.round(successful.reduce((s, r) => s + r.latency, 0) / successful.length)
        : null
    })

    // Consider success if at least one relay succeeded
    if (successful.length === 0) {
      throw new Error(`All ${selectedRelays.length} relays failed to publish`)
    }

    return {
      success: true,
      relays: selectedRelays,
      successfulRelays: successful.map(r => r.relay),
      failedRelays: failed.map(r => r.relay),
      errors: failed.map(r => r.error)
    }
  }

  /**
   * Broadcast message
   * @param {*} message - Message content
   * @returns {Promise<void>}
   */
  async broadcast(message) {
    await this.publish({
      type: 'broadcast',
      from: this.identity.publicKey,
      agent: this.identity.agent,
      ts: Date.now(),
      message
    })
  }

  /**
   * Broadcast message to specified topic
   * @param {string} topic - Target topic
   * @param {*} message - Message content
   * @returns {Promise<void>}
   */
  async broadcastToTopic(topic, message) {
    const payload = {
      type: 'group_message',
      from: this.identity.publicKey,
      agent: this.identity.agent,
      ts: Date.now(),
      message
    }

    const event = finalizeEvent(
      {
        kind: AGENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', topic]],
        content: JSON.stringify(payload)
      },
      this.identity.secretKey
    )

    try {
      await Promise.any(this.pool.publish(this.relays, event))
      log.debug('Published group message', { topic })
    } catch (err) {
      log.error('Failed to publish group message', { topic, error: err.message })
      throw new Error(`Failed to publish: ${err.message}`)
    }
  }

  /**
   * Subscribe to specified topic
   * @param {string} topic - Topic to subscribe
   * @param {Function} onMessage - Message callback
   * @returns {Object} Subscription object (can call close())
   */
  subscribeToTopic(topic, onMessage) {
    // Validate topic format (prevent injection attack)
    if (typeof topic !== 'string' || topic.length === 0 || topic.length > 100) {
      throw new Error('Invalid topic format')
    }

    const filter = {
      kinds: [AGENT_KIND],
      '#d': [topic],
      since: Math.floor(Date.now() / 1000) - NETWORK_CONFIG.MESSAGE_HISTORY_SECONDS
    }

    const sub = this.pool.subscribeMany(this.relays, [filter], {
      onevent: (event) => {
        // Verify signature
        if (!verifyEvent(event)) {
          log.warn('Invalid event signature', { id: event.id })
          return
        }

        const payload = this._safeJsonParse(event.content)
        if (!payload) {
          log.debug('Failed to parse group event')
          return
        }

        payload.id = event.id
        onMessage(payload)
      },
      oneose: () => {
        log.debug('End of stored events for topic', { topic })
      }
    })

    log.info('Subscribed to topic', { topic })
    return sub
  }

  /**
   * Send task
   * @param {string} target - Target public key
   * @param {*} task - Task content
   * @returns {Promise<void>}
   */
  async sendTask(target, task) {
    if (!target || typeof target !== 'string') {
      throw new Error('Invalid target public key')
    }

    await this.publish({
      type: 'task',
      from: this.identity.publicKey,
      to: target,
      agent: this.identity.agent,
      ts: Date.now(),
      task
    })
  }

  /**
   * Send result
   * @param {string} target - Target public key
   * @param {*} result - Result content
   * @returns {Promise<void>}
   */
  async sendResult(target, result) {
    if (!target || typeof target !== 'string') {
      throw new Error('Invalid target public key')
    }

    await this.publish({
      type: 'result',
      from: this.identity.publicKey,
      to: target,
      agent: this.identity.agent,
      ts: Date.now(),
      result
    })
  }

  /**
   * Get known peer list
   * @returns {Array<{id: string, name: string, lastSeen: number}>}
   */
  getPeers() {
    return this.knownPeers.entries().map(([id, info]) => ({
      id,
      name: info.agentName,
      lastSeen: info.lastSeen
    }))
  }

  /**
   * Get connection status
   * @returns {boolean}
   */
  isActive() {
    return this.isConnected
  }

  /**
   * Close connection
   */
  close() {
    log.info('Closing network connection')

    // Restore console.log
    this._restoreConsole()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.sub) {
      this.sub.close()
      this.sub = null
    }

    this.pool.close(this.relays)
    this.isConnected = false
  }
}
