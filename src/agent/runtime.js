/**
 * @fileoverview Agent runtime core module
 * Provides Agent lifecycle management and communication API
 */

import { loadOrCreateIdentity } from '../core/identity.js'
import { DEFAULT_AGENT, DEFAULT_TOPIC, DEFAULT_RELAYS, NETWORK_CONFIG } from '../config/defaults.js'
import { NostrNetwork } from '../network/nostr-network.js'
import { logger } from '../utils/logger.js'

const log = logger.child('runtime')

/**
 * @typedef {Object} RuntimeOptions
 * @property {string} [topic] - Communication topic
 * @property {string[]} [relays] - Relay address list
 * @property {Object} [agent] - Agent metadata
 * @property {string} [agent.name] - Agent name
 * @property {string} [identityFile] - Identity file path
 * @property {number} [connectionTimeout] - Connection timeout (ms)
 */

/**
 * @typedef {Object} RuntimeStats
 * @property {boolean} isConnected - Whether connected
 * @property {string} publicKey - Public key
 * @property {string} topic - Current topic
 * @property {number} peerCount - Known node count
 * @property {number} uptime - Runtime (ms)
 */

/**
 * Agent runtime class
 * Wraps Nostr network layer, provides simplified Agent communication API
 */
export class AgentRuntime {
  /**
   * Create AgentRuntime instance
   * @param {RuntimeOptions} [options={}] - Configuration options
   */
  constructor({
    topic = DEFAULT_TOPIC,
    relays = DEFAULT_RELAYS,
    agent = DEFAULT_AGENT,
    identityFile,
    connectionTimeout = NETWORK_CONFIG.CONNECTION_TIMEOUT
  } = {}) {
    this.topic = topic
    this.relays = relays
    this.agent = { ...agent }
    this.identityFile = identityFile
    this.connectionTimeout = connectionTimeout

    /** @private */
    this._identity = null
    /** @private */
    this._network = null
    /** @private */
    this._startTime = null
    /** @private */
    this._messageHandler = null
    /** @private */
    this._isStarting = false
  }

  /**
   * Start Agent runtime
   * @param {Function} [onMessage] - Message callback function
   * @param {Object} [options={}] - Start options
   * @param {number} [options.timeout] - Connection timeout
   * @returns {Promise<Object>} Identity object
   * @throws {Error} If start fails
   */
  async start(onMessage, { timeout = this.connectionTimeout } = {}) {
    // Prevent concurrent start (race condition)
    if (this._network) {
      throw new Error('Runtime already started')
    }
    if (this._isStarting) {
      throw new Error('Runtime is already starting')
    }

    this._isStarting = true

    try {
      log.info('Starting agent runtime', { topic: this.topic })

      // Load or create identity
      this._identity = loadOrCreateIdentity(this.identityFile)

      // Verify identity loaded successfully
      if (!this._identity || !this._identity.publicKey) {
        throw new Error('Failed to load valid identity')
      }

      // Create mutable identity copy for network layer (includes agent metadata)
      const networkIdentity = {
        secretKey: this._identity.secretKey,
        publicKey: this._identity.publicKey,
        agent: this.agent
      }

      // Create network instance
      this._network = new NostrNetwork({
        relays: this.relays,
        topic: this.topic,
        identity: networkIdentity,
        connectionTimeout: timeout
      })

      // Save message handler
      this._messageHandler = onMessage || (() => {})

      // Connect to network
      await this._network.connect(this._messageHandler, { timeout })

      this._startTime = Date.now()

      log.info('Agent runtime started', {
        topic: this.topic
      })

      return this._identity
    } catch (err) {
      log.error('Failed to start runtime', { error: err.message })
      this._cleanup()
      throw err
    } finally {
      this._isStarting = false
    }
  }

  /**
   * Get public key
   * @returns {string} Public key hex string
   * @throws {Error} If runtime not started
   */
  getPublicKey() {
    this._ensureStarted()
    return this._identity.publicKey
  }

  /**
   * Get current topic
   * @returns {string} Topic name
   */
  getTopic() {
    return this.topic
  }

  /**
   * Broadcast message
   * @param {*} message - Message content
   * @returns {Promise<void>}
   * @throws {Error} If send fails
   */
  async broadcast(message) {
    this._ensureStarted()
    await this._network.broadcast(message)
    log.debug('Broadcast message sent')
  }

  /**
   * Send task
   * @param {string} target - Target public key
   * @param {*} task - Task content
   * @returns {Promise<void>}
   * @throws {Error} If send fails
   */
  async sendTask(target, task) {
    this._ensureStarted()
    await this._network.sendTask(target, task)
    log.debug('Task sent', { target: target.slice(0, 16) + '...' })
  }

  /**
   * Send result
   * @param {string} target - Target public key
   * @param {*} result - Result content
   * @returns {Promise<void>}
   * @throws {Error} If send fails
   */
  async sendResult(target, result) {
    this._ensureStarted()
    await this._network.sendResult(target, result)
    log.debug('Result sent', { target: target.slice(0, 16) + '...' })
  }

  /**
   * Get known peer list
   * @returns {Array<{id: string, name: string, lastSeen: number}>}
   */
  getPeers() {
    if (!this._network) return []
    return this._network.getPeers()
  }

  /**
   * Get runtime statistics
   * @returns {RuntimeStats}
   */
  getStats() {
    return {
      isConnected: this._network?.isActive() ?? false,
      publicKey: this._identity?.publicKey ?? null,
      topic: this.topic,
      peerCount: this.getPeers().length,
      uptime: this._startTime ? Date.now() - this._startTime : 0
    }
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnected() {
    return this._network?.isActive() ?? false
  }

  /**
   * Close runtime
   */
  close() {
    log.info('Closing agent runtime')
    this._cleanup()
  }

  /**
   * Stop runtime (alias for close)
   */
  stop() {
    this.close()
  }

  /**
   * Ensure runtime started
   * @private
   * @throws {Error} If not started
   */
  _ensureStarted() {
    if (!this._network) {
      throw new Error('Runtime not started. Call start() first.')
    }
  }

  /**
   * Clean up resources (with error handling)
   * @private
   */
  _cleanup() {
    if (this._network) {
      try {
        this._network.close()
      } catch (err) {
        log.error('Error closing network connection', { error: err.message })
      } finally {
        this._network = null
      }
    }
    this._startTime = null
  }
}
