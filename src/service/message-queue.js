/**
 * @fileoverview Message retry and offline queue
 * Ensures reliable message delivery
 */

import {
  OFFLINE_QUEUE_FILE, CONFIG, ErrorCode,
  ensureDataDirAsync, readJsonLinesAsync, generateId, sleep, atomicWriteFile
} from '../service/shared.js';
import { logger } from '../utils/logger.js';

const log = logger.child('message-queue');

/**
 * @typedef {Object} QueuedMessage
 * @property {string} id - Message ID
 * @property {string} type - Message type (send|group_send)
 * @property {string} target - Target (public key or group ID)
 * @property {*} content - Message content
 * @property {number} retryCount - Retry count
 * @property {number} createdAt - Creation time
 * @property {number} nextRetryAt - Next retry time
 * @property {string} [topic] - Group topic (group message)
 */

// Debounce queue saves to avoid excessive I/O
const SAVE_DEBOUNCE_MS = 100;
let pendingSave = null;
let savePromise = null;

/**
 * Message queue manager
 */
export class MessageQueue {
  constructor() {
    /** @type {Map<string, QueuedMessage>} */
    this.queue = new Map();
    this.isProcessing = false;
    this.processInterval = null;
    this.initialized = false;
  }

  /**
   * Initialize the queue (async version)
   * Call this before using the queue
   */
  async init() {
    if (this.initialized) return;
    await this._loadQueue();
    this.initialized = true;
  }

  /**
   * Load offline queue (async version)
   */
  async _loadQueue() {
    await ensureDataDirAsync();

    try {
      const messages = await readJsonLinesAsync(OFFLINE_QUEUE_FILE);
      const now = Date.now();

      for (const msg of messages) {
        // Filter expired messages
        if (now - msg.createdAt < CONFIG.MESSAGE_TTL) {
          this.queue.set(msg.id, msg);
        }
      }

      if (this.queue.size > 0) {
        log.info('Loaded offline queue', { count: this.queue.size });
      }
    } catch (err) {
      log.warn('Failed to load offline queue', { error: err.message });
    }
  }

  /**
   * Save queue to file (async version with debouncing)
   */
  async _saveQueue() {
    // If a save is already pending, return that promise
    if (savePromise) {
      return savePromise;
    }

    // Clear any pending timeout
    if (pendingSave) {
      clearTimeout(pendingSave);
    }

    // Create a new save promise
    savePromise = (async () => {
      try {
        const lines = Array.from(this.queue.values())
          .map(msg => JSON.stringify(msg))
          .join('\n');

        await atomicWriteFile(OFFLINE_QUEUE_FILE, lines + (lines ? '\n' : ''));
      } catch (err) {
        log.error('Failed to save offline queue', { error: err.message });
      } finally {
        savePromise = null;
      }
    })();

    return savePromise;
  }

  /**
   * Force immediate save (skip debounce)
   */
  async _forceSave() {
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSave = null;
    }
    await this._saveQueue();
  }

  /**
   * Add message to queue
   * @param {string} type - Message type
   * @param {string} target - Target
   * @param {*} content - Content
   * @param {Object} [options] - Extra options
   * @returns {Promise<string>} Message ID
   */
  async enqueue(type, target, content, options = {}) {
    // Ensure initialized
    if (!this.initialized) {
      await this.init();
    }

    // Check queue size limit before adding
    if (this.queue.size >= CONFIG.MAX_QUEUE_SIZE) {
      // Remove oldest message (FIFO eviction based on createdAt)
      let oldestId = null;
      let oldestTime = Infinity;

      for (const [id, msg] of this.queue) {
        if (msg.createdAt < oldestTime) {
          oldestTime = msg.createdAt;
          oldestId = id;
        }
      }

      if (oldestId) {
        this.queue.delete(oldestId);
        log.warn('Queue full, dropped oldest message', { droppedId: oldestId, queueSize: this.queue.size });
      }
    }

    const id = generateId();
    const now = Date.now();

    const message = {
      id,
      type,
      target,
      content,
      retryCount: 0,
      createdAt: now,
      nextRetryAt: now, // Try immediately
      ...options
    };

    this.queue.set(id, message);
    await this._saveQueue();

    log.debug('Message enqueued', { id, type, target: target.slice(0, 16), queueSize: this.queue.size });
    return id;
  }

  /**
   * Mark message sent successfully
   * @param {string} id - Message ID
   */
  async markSuccess(id) {
    if (this.queue.delete(id)) {
      await this._saveQueue();
      log.debug('Message sent successfully', { id });
    }
  }

  /**
   * Mark message send failed and schedule retry
   * @param {string} id - Message ID
   * @param {string} error - Error message
   * @returns {Promise<boolean>} Will retry
   */
  async markFailure(id, error) {
    const msg = this.queue.get(id);
    if (!msg) return false;

    msg.retryCount++;

    if (msg.retryCount >= CONFIG.MESSAGE_RETRY_COUNT) {
      // Exceeded retry count, remove
      this.queue.delete(id);
      await this._saveQueue();
      log.warn('Message retry exhausted', { id, retryCount: msg.retryCount });
      return false;
    }

    // Calculate next retry time (exponential backoff)
    const delay = CONFIG.MESSAGE_RETRY_DELAY * Math.pow(CONFIG.MESSAGE_RETRY_BACKOFF, msg.retryCount - 1);
    msg.nextRetryAt = Date.now() + delay;
    msg.lastError = error;

    await this._saveQueue();
    log.info('Message scheduled for retry', { id, retryCount: msg.retryCount, delay });
    return true;
  }

  /**
   * Get pending messages
   * @returns {QueuedMessage[]} Pending message list
   */
  getPendingMessages() {
    const now = Date.now();
    const pending = [];

    for (const msg of this.queue.values()) {
      if (msg.nextRetryAt <= now) {
        pending.push(msg);
      }
    }

    return pending;
  }

  /**
   * Get queue status
   * @returns {Object} Queue status
   */
  getStatus() {
    const now = Date.now();
    let pending = 0;
    let waiting = 0;
    let expired = 0;

    for (const msg of this.queue.values()) {
      if (now - msg.createdAt >= CONFIG.MESSAGE_TTL) {
        expired++;
      } else if (msg.nextRetryAt <= now) {
        pending++;
      } else {
        waiting++;
      }
    }

    return {
      total: this.queue.size,
      pending,
      waiting,
      expired
    };
  }

  /**
   * Clean expired messages
   * @returns {Promise<number>} Cleaned message count
   */
  async cleanExpired() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, msg] of this.queue) {
      if (now - msg.createdAt >= CONFIG.MESSAGE_TTL) {
        this.queue.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this._saveQueue();
      log.info('Cleaned expired messages', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Get message
   * @param {string} id - Message ID
   * @returns {QueuedMessage|null}
   */
  getMessage(id) {
    return this.queue.get(id) || null;
  }

  /**
   * Clear queue
   */
  async clear() {
    this.queue.clear();
    await this._saveQueue();
  }

  /**
   * Flush any pending saves (for graceful shutdown)
   */
  async flush() {
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSave = null;
    }
    if (savePromise) {
      await savePromise;
    }
  }
}

// Singleton
export const messageQueue = new MessageQueue();

// Initialize the queue on import
messageQueue.init().catch(err => {
  log.error('Failed to initialize message queue', { error: err.message });
});
