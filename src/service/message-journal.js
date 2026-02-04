/**
 * @fileoverview Message persistence with journaling
 * Allows messages to survive service restarts
 */
import fs from 'fs'
import { promises as fsAsync } from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'
import { DATA_DIR, generateId } from '../service/shared.js'

const log = logger.child('message-persistence')

// Journal file path
const JOURNAL_DIR = path.join(DATA_DIR, 'journal')
const JOURNAL_INDEX = path.join(JOURNAL_DIR, 'index.json')
const JOURNAL_DATA = path.join(JOURNAL_DIR, 'messages.bin')

// Journal header (binary format)
const JOURNAL_MAGIC = 0x4D534731 // 'MSG1'
const JOURNAL_VERSION = 1

/**
 * Ensure journal directory exists
 */
function ensureJournalDir() {
  if (!fs.existsSync(JOURNAL_DIR)) {
    fs.mkdirSync(JOURNAL_DIR, { recursive: true })
  }
}

/**
 * Message journal class
 */
export class MessageJournal {
  constructor() {
    this.index = new Map() // message ID -> offset
    this.loaded = false
    this.dirty = false
  }

  /**
   * Initialize journal (load index)
   */
  async init() {
    ensureJournalDir()

    try {
      if (fs.existsSync(JOURNAL_INDEX)) {
        const data = await fsAsync.readFile(JOURNAL_INDEX, 'utf8')
        const indexData = JSON.parse(data)

        for (const [id, offset] of Object.entries(indexData)) {
          this.index.set(id, offset)
        }

        log.info('Loaded message journal index', { count: this.index.size })
      }
    } catch (err) {
      log.warn('Failed to load journal index', { error: err.message })
      this.index.clear()
    }

    this.loaded = true
  }

  /**
   * Append message to journal
   * @param {Object} message - Message to persist
   * @returns {Promise<boolean>} Success
   */
  async append(message) {
    if (!this.loaded) {
      await this.init()
    }

    try {
      ensureJournalDir()

      // Serialize message
      const data = JSON.stringify(message)
      const buffer = Buffer.from(data, 'utf8')

      // Write to journal file (append)
      const offset = (await this._getFileSize()).toString()
      await fsAsync.appendFile(JOURNAL_DATA, buffer)

      // Update index
      this.index.set(message.id, offset)
      this.dirty = true

      return true
    } catch (err) {
      log.error('Failed to append to journal', { error: err.message })
      return false
    }
  }

  /**
   * Get current journal file size
   * @private
   */
  async _getFileSize() {
    try {
      const stats = await fsAsync.stat(JOURNAL_DATA)
      return stats.size
    } catch {
      return 0
    }
  }

  /**
   * Get message from journal by ID
   * @param {string} id - Message ID
   * @returns {Promise<Object|null>} Message or null
   */
  async get(id) {
    if (!this.loaded) {
      await this.init()
    }

    const offset = this.index.get(id)
    if (offset === undefined) {
      return null
    }

    try {
      const fd = await fsAsync.open(JOURNAL_DATA, 'r')
      try {
        const buffer = Buffer.alloc(8192) // Max message size
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, parseInt(offset))

        if (bytesRead > 0) {
          const data = buffer.subarray(0, bytesRead).toString('utf8')
          return JSON.parse(data)
        }
      } finally {
        await fd.close()
      }
    } catch (err) {
      log.error('Failed to read from journal', { id, error: err.message })
    }

    return null
  }

  /**
   * Get all messages from journal
   * @param {Object} options - Options
   * @returns {Promise<Array>} Messages
   */
  async getAll(options = {}) {
    if (!this.loaded) {
      await this.init()
    }

    const { limit, since } = options
    const messages = []

    try {
      const fd = await fsAsync.open(JOURNAL_DATA, 'r')
      try {
        const stats = await fd.stat()
        let offset = 0
        const buffer = Buffer.alloc(8192)

        while (offset < stats.size) {
          const { bytesRead } = await fd.read(buffer, 0, buffer.length, offset)

          if (bytesRead === 0) break

          try {
            const data = buffer.subarray(0, bytesRead).toString('utf8')
            const msg = JSON.parse(data)

            // Filter by since timestamp
            if (since && msg.timestamp < since) {
              offset += bytesRead
              continue
            }

            messages.push(msg)
            offset += bytesRead

            // Apply limit
            if (limit && messages.length >= limit) {
              break
            }
          } catch {
            // Skip corrupted messages
            offset += bytesRead
          }
        }
      } finally {
        await fd.close()
      }
    } catch (err) {
      log.error('Failed to read journal', { error: err.message })
    }

    return messages
  }

  /**
   * Delete message from journal
   * @param {string} id - Message ID
   * @returns {Promise<boolean>} Success
   */
  async delete(id) {
    if (!this.loaded) {
      await this.init()
    }

    this.index.delete(id)
    this.dirty = true
    return true
  }

  /**
   * Clear all messages from journal
   * @returns {Promise<boolean>} Success
   */
  async clear() {
    this.index.clear()
    this.dirty = true

    try {
      await fsAsync.unlink(JOURNAL_DATA)
      await fsAsync.unlink(JOURNAL_INDEX)
      return true
    } catch {
      return true // Files may not exist
    }
  }

  /**
   * Save index to disk
   * @returns {Promise<boolean>} Success
   */
  async flush() {
    if (!this.dirty) {
      return true
    }

    try {
      ensureJournalDir()

      const indexData = {}
      for (const [id, offset] of this.index.entries()) {
        indexData[id] = offset
      }

      await fsAsync.writeFile(
        JOURNAL_INDEX,
        JSON.stringify(indexData),
        { mode: 0o600 }
      )

      this.dirty = false
      log.debug('Flushed journal index', { entries: this.index.size })
      return true
    } catch (err) {
      log.error('Failed to flush journal', { error: err.message })
      return false
    }
  }

  /**
   * Get journal statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    if (!this.loaded) {
      await this.init()
    }

    let size = 0
    try {
      const stats = await fsAsync.stat(JOURNAL_DATA)
      size = stats.size
    } catch {}

    return {
      messageCount: this.index.size,
      fileSize: size,
      indexDirty: this.dirty
    }
  }

  /**
   * Compact journal (remove deleted messages)
   * @returns {Promise<boolean>} Success
   */
  async compact() {
    if (!this.loaded) {
      await this.init()
    }

    log.info('Compacting journal', { currentSize: this.index.size })

    try {
      // Read all valid messages
      const messages = []
      for (const id of this.index.keys()) {
        const msg = await this.get(id)
        if (msg) {
          messages.push(msg)
        }
      }

      // Clear journal
      await this.clear()

      // Rewrite messages
      for (const msg of messages) {
        await this.append(msg)
      }

      await this.flush()
      log.info('Journal compacted', { newSize: this.index.size })
      return true
    } catch (err) {
      log.error('Failed to compact journal', { error: err.message })
      return false
    }
  }

  /**
   * Close journal (flush index)
   */
  async close() {
    await this.flush()
    this.loaded = false
  }
}

// Singleton instance
let journalInstance = null

/**
 * Get message journal singleton
 * @returns {MessageJournal} Journal instance
 */
export function getMessageJournal() {
  if (!journalInstance) {
    journalInstance = new MessageJournal()
  }
  return journalInstance
}

/**
 * Initialize journal on startup
 */
export async function initMessageJournal() {
  const journal = getMessageJournal()
  await journal.init()
  return journal
}
