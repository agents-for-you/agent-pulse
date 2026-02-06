/**
 * @fileoverview AgentPulse SDK
 * Library interface for AI Agents to integrate AgentPulse directly
 * without spawning subprocesses. Provides event-based messaging.
 */
import { EventEmitter } from 'events'
import { loadOrCreateIdentity, generateIdentity, getIdentityPublicKey, getIdentityPublicKeyNpub } from '../core/identity.js'
import { NostrNetwork } from '../network/nostr-network.js'
import { DEFAULT_RELAYS, DEFAULT_TOPIC } from '../config/defaults.js'
import { logger } from '../utils/logger.js'
import { messageRateLimiter } from '../utils/rate-limiter.js'
import * as nip04 from 'nostr-tools/nip04'

const log = logger.child('sdk')

/**
 * AgentPulse SDK Client
 * Provides a programmatic interface for agents to use AgentPulse
 */
export class AgentPulseClient extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {string} [options.identity] - Identity file path
   * @param {boolean} [options.ephemeral] - Use ephemeral keys
   * @param {string[]} [options.relays] - Custom relays
   * @param {string} [options.topic] - Custom topic
   */
  constructor(options = {}) {
    super()

    this.options = {
      identity: options.identity,
      ephemeral: options.ephemeral || false,
      relays: options.relays || DEFAULT_RELAYS,
      topic: options.topic || DEFAULT_TOPIC
    }

    this.network = null
    this.identity = null
    this.connected = false
    this.messageQueue = []
    this._autoReconnect = true
  }

  /**
   * Initialize the client and connect to network
   * @returns {Promise<Object>} Connection status
   */
  async init() {
    try {
      // Load or create identity (only if not already set)
      if (!this.identity) {
        if (this.options.ephemeral) {
          this.identity = generateIdentity()
          log.info('Using ephemeral identity')
        } else {
          this.identity = this.options.identity
            ? loadOrCreateIdentity(this.options.identity)
            : loadOrCreateIdentity()
        }
      } else {
        log.info('Using pre-set identity')
      }

      // Create network instance
      this.network = new NostrNetwork({
        relays: this.options.relays,
        topic: this.options.topic,
        identity: this.identity,
        autoReconnect: this._autoReconnect
      })

      // Connect to network
      await this.network.connect((msg) => this._handleMessage(msg))

      this.connected = true

      const pubkey = getIdentityPublicKey(this.identity)
      const npub = getIdentityPublicKeyNpub(this.identity)

      log.info('AgentPulse client initialized', { npub: npub.slice(0, 16) + '...' })

      return {
        ok: true,
        pubkey,
        npub,
        connected: true
      }
    } catch (err) {
      log.error('Failed to initialize client', { error: err.message })
      return {
        ok: false,
        error: err.message
      }
    }
  }

  /**
   * Handle incoming message from network
   * @private
   */
  async _handleMessage(msg) {
    try {
      // Rate limiting
      const rateLimitResult = messageRateLimiter.tryRequest(msg.from)
      if (!rateLimitResult.allowed) {
        log.debug('Rate limited message', { from: msg.from?.slice(0, 8) })
        return
      }

      // Get content from various possible locations
      // - msg.task: encrypted DM content from sendTask()
      // - msg.result: response content from sendResult()
      // - msg.message: broadcast message
      // - msg.content: generic content
      let content = msg.task || msg.result || msg.message || msg.content || msg

      // Debug logging
      log.debug('SDK received message', {
        from: msg.from?.slice(0, 8),
        type: msg.type,
        to: msg.to?.slice(0, 8),
        hasTask: !!msg.task,
        hasResult: !!msg.result,
        hasMessage: !!msg.message,
        contentType: typeof content,
        contentPreview: typeof content === 'string' ? content.slice(0, 50) : JSON.stringify(content).slice(0, 50)
      })

      // Check if message is for us
      if (msg.to && msg.to !== this.identity.publicKey) {
        log.debug('Message not for us, ignoring', { to: msg.to?.slice(0, 8), me: this.identity.publicKey.slice(0, 8) })
        return
      }

      // Try NIP-04 decryption (content may be encrypted string)
      if (typeof content === 'string') {
        try {
          const decrypted = await nip04.decrypt(
            this.identity.secretKey,
            msg.from,
            content
          )
          log.debug('Successfully decrypted message')
          try {
            content = JSON.parse(decrypted)
          } catch {
            content = decrypted // Keep as string if not JSON
          }
        } catch (decryptError) {
          // Not encrypted or failed to decrypt, try parsing as JSON
          log.debug('Failed to decrypt, trying as plain JSON', { error: decryptError.message, name: decryptError.name })
          try {
            content = JSON.parse(content)
          } catch {
            // Plain text message, keep as is
            log.debug('Content is plain text')
          }
        }
      }

      const message = {
        id: msg.id || `${msg.from}-${Date.now()}`,
        from: msg.from,
        content: content,
        timestamp: msg.ts || Date.now(),
        isGroup: msg.isGroup || false,
        groupId: msg.groupId || null
      }

      // Add to queue for recv()
      this.messageQueue.push(message)

      // Emit for real-time listeners
      this.emit('message', message)

      // Emit specific event types if present
      if (content && content.type) {
        this.emit(content.type, message)
      }
    } catch (err) {
      log.error('Failed to handle message', { error: err.message })
    }
  }

  /**
   * Get own public key (hex format)
   * @returns {string} Public key
   */
  getPubkey() {
    return this.identity?.publicKey
  }

  /**
   * Get own public key (npub format)
   * @returns {string} npub
   */
  getNpub() {
    return getIdentityPublicKeyNpub(this.identity)
  }

  /**
   * Send a message to another agent
   * @param {string} to - Recipient public key (hex or npub)
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} Send result
   */
  async send(to, content) {
    if (!this.connected) {
      return { ok: false, error: 'Not connected. Call init() first.' }
    }

    try {
      // Normalize npub to hex if needed
      let targetPubkey = to
      if (to.startsWith('npub')) {
        const { decodePublicKey } = await import('../core/nip19.js')
        targetPubkey = decodePublicKey(to)
      }

      // Prepare message
      const message = typeof content === 'string' ? content : JSON.stringify(content)

      // Encrypt with NIP-04
      const encrypted = await nip04.encrypt(
        this.identity.secretKey,
        targetPubkey,
        message
      )

      // Send via network
      await this.network.sendTask(targetPubkey, encrypted)

      // Flush to ensure message is sent immediately
      await this.network.flush()

      log.debug('Message sent', { to: targetPubkey.slice(0, 8) })

      return {
        ok: true,
        id: Date.now().toString(36)
      }
    } catch (err) {
      log.error('Failed to send message', { error: err.message })
      return { ok: false, error: err.message }
    }
  }

  /**
   * Receive messages (non-blocking)
   * @param {Object} options - Options
   * @returns {Array} Messages
   */
  recv(options = {}) {
    const {
      clear = true,
      limit,
      since,
      from
    } = options

    let messages = this.messageQueue

    // Apply filters
    if (since) {
      messages = messages.filter(m => m.timestamp >= since)
    }
    if (from) {
      messages = messages.filter(m => m.from === from)
    }
    if (limit) {
      messages = messages.slice(0, limit)
    }

    // Clear if requested
    if (clear) {
      this.messageQueue = []
    }

    return messages
  }

  /**
   * Peek at messages without clearing queue
   * @param {Object} options - Options
   * @returns {Array} Messages
   */
  peek(options = {}) {
    return this.recv({ ...options, clear: false })
  }

  /**
   * Wait for next message (real-time)
   * @param {Object} options - Options
   * @returns {Promise<Object>} Next message
   */
  async waitForMessage(options = {}) {
    const {
      timeout = 30000,
      filter = null
    } = options

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('message', onMessage)
        reject(new Error('Timeout waiting for message'))
      }, timeout)

      const onMessage = (msg) => {
        if (filter && !filter(msg)) {
          return
        }
        clearTimeout(timer)
        this.off('message', onMessage)
        resolve(msg)
      }

      this.on('message', onMessage)
    })
  }

  /**
   * Subscribe to messages (real-time stream)
   * @param {Function} callback - Message callback
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.on('message', callback)

    // Return unsubscribe function
    return () => {
      this.off('message', callback)
    }
  }

  /**
   * Get connection status
   * @returns {Object} Status
   */
  getStatus() {
    return {
      connected: this.connected,
      pubkey: this.getPubkey(),
      npub: this.getNpub(),
      queuedMessages: this.messageQueue.length,
      isConnected: () => this.network?.isActive() || false
    }
  }

  /**
   * Disconnect from network
   */
  disconnect() {
    if (this.network) {
      this.network.close()
      this.connected = false
    }
    this.messageQueue = []
  }

  /**
   * Create a group
   * @param {string} name - Group name
   * @returns {Promise<Object>} Group info
   */
  async createGroup(name) {
    const { generateId } = await import('../service/shared.js')
    const groupId = generateId()

    return {
      ok: true,
      groupId,
      topic: `group-${groupId}`,
      name
    }
  }
}

/**
 * Quick start - create and initialize client in one call
 * @param {Object} options - Options
 * @returns {Promise<AgentPulseClient>} Initialized client
 */
export async function createClient(options = {}) {
  const client = new AgentPulseClient(options)
  await client.init()
  return client
}

/**
 * Quick send - send message without managing client
 * @param {string} to - Recipient
 * @param {string|Object} content - Message
 * @param {Object} options - Options
 * @returns {Promise<Object>} Send result
 */
export async function quickSend(to, content, options = {}) {
  const client = new AgentPulseClient(options)
  await client.init()
  const result = await client.send(to, content)
  client.disconnect()
  return result
}

/**
 * Quick receive - receive messages without managing client
 * @param {Object} options - Options
 * @returns {Promise<Array>} Messages
 */
export async function quickRecv(options = {}) {
  const client = new AgentPulseClient(options)
  await client.init()

  // Wait a bit for messages
  await new Promise(resolve => setTimeout(resolve, options.wait || 1000))

  const messages = client.recv(options)
  client.disconnect()
  return messages
}

export default {
  AgentPulseClient,
  createClient,
  quickSend,
  quickRecv
}
