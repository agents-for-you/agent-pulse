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
      // Detect prototype pollution
      if (obj && typeof obj === 'object') {
        if (obj.__proto__ !== Object.prototype ||
            (obj.constructor && obj.constructor.prototype !== Object.prototype)) {
          log.warn('Prototype pollution detected in JSON')
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
   * Wait for connection to be established
   * @private
   * @param {number} timeout - Timeout
   * @returns {Promise<void>}
   */
  async _waitForConnection(timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeout}ms`))
      }, timeout)

      // Try to send a test event to verify connection
      const testEvent = finalizeEvent(
        {
          kind: AGENT_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['d', this.topic]],
          content: JSON.stringify({ type: '_ping', ts: Date.now() })
        },
        this.identity.secretKey
      )

      Promise.any(this.pool.publish(this.relays, testEvent))
        .then(() => {
          clearTimeout(timer)
          resolve()
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(new Error(`All relays failed: ${err.message}`))
        })
    })
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
   * @returns {Promise<void>}
   * @throws {Error} If publish fails
   */
  async publish(payload) {
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

    try {
      await Promise.any(this.pool.publish(this.relays, event))
      log.debug('Published message', { type: payload.type })
    } catch (err) {
      log.error('Failed to publish message', { type: payload.type, error: err.message })
      throw new Error(`Failed to publish: ${err.message}`)
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
