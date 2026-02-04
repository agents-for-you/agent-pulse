/**
 * @fileoverview Message retry and offline queue
 * Ensures reliable message delivery
 */

import fs from 'fs';
import {
  OFFLINE_QUEUE_FILE, CONFIG, ErrorCode,
  ensureDataDir, withLock, readJsonLines, appendJsonLine, generateId, sleep, atomicWriteFileSync
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

/**
 * Message queue manager
 */
export class MessageQueue {
  constructor() {
    /** @type {Map<string, QueuedMessage>} */
    this.queue = new Map();
    this.isProcessing = false;
    this.processInterval = null;

    // Load offline queue
    this._loadQueue();
  }

  /**
   * Load offline queue
   */
  _loadQueue() {
    ensureDataDir();

    try {
      const messages = readJsonLines(OFFLINE_QUEUE_FILE);
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
   * Save queue to file
   */
  _saveQueue() {
    try {
      const lines = Array.from(this.queue.values())
        .map(msg => JSON.stringify(msg))
        .join('\n');

      atomicWriteFileSync(OFFLINE_QUEUE_FILE, lines + (lines ? '\n' : ''));
    } catch (err) {
      log.error('Failed to save offline queue', { error: err.message });
    }
  }

  /**
   * Add message to queue
   * @param {string} type - Message type
   * @param {string} target - Target
   * @param {*} content - Content
   * @param {Object} [options] - Extra options
   * @returns {string} Message ID
   */
  enqueue(type, target, content, options = {}) {
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
    this._saveQueue();

    log.debug('Message enqueued', { id, type, target: target.slice(0, 16) });
    return id;
  }

  /**
   * Mark message sent successfully
   * @param {string} id - Message ID
   */
  markSuccess(id) {
    if (this.queue.delete(id)) {
      this._saveQueue();
      log.debug('Message sent successfully', { id });
    }
  }

  /**
   * Mark message send failed and schedule retry
   * @param {string} id - Message ID
   * @param {string} error - Error message
   * @returns {boolean} Will retry
   */
  markFailure(id, error) {
    const msg = this.queue.get(id);
    if (!msg) return false;

    msg.retryCount++;

    if (msg.retryCount >= CONFIG.MESSAGE_RETRY_COUNT) {
      // Exceeded retry count, remove
      this.queue.delete(id);
      this._saveQueue();
      log.warn('Message retry exhausted', { id, retryCount: msg.retryCount });
      return false;
    }

    // Calculate next retry time (exponential backoff)
    const delay = CONFIG.MESSAGE_RETRY_DELAY * Math.pow(CONFIG.MESSAGE_RETRY_BACKOFF, msg.retryCount - 1);
    msg.nextRetryAt = Date.now() + delay;
    msg.lastError = error;

    this._saveQueue();
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
   * @returns {number} Cleaned message count
   */
  cleanExpired() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, msg] of this.queue) {
      if (now - msg.createdAt >= CONFIG.MESSAGE_TTL) {
        this.queue.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this._saveQueue();
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
  clear() {
    this.queue.clear();
    this._saveQueue();
  }
}

// Singleton
export const messageQueue = new MessageQueue();
