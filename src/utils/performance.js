/**
 * @fileoverview Performance optimization utilities
 * Message compression and batch processing for high-throughput scenarios
 */

import crypto from 'crypto'
import { gzipSync, gunzipSync } from 'zlib'

/**
 * Compression configuration
 */
export const CompressionConfig = {
  // Minimum message size to consider compression (bytes)
  MIN_COMPRESS_SIZE: 256,

  // Maximum message size before force-compression (bytes)
  MAX_UNCOMPRESSED_SIZE: 1024,

  // Compression level (0-9, higher = better compression but slower)
  COMPRESSION_LEVEL: 6,

  // Compression threshold - use compression if ratio is better than this
  COMPRESSION_THRESHOLD: 0.8
}

/**
 * Batch processing configuration
 */
export const BatchConfig = {
  // Maximum batch size (number of messages)
  MAX_BATCH_SIZE: 100,

  // Maximum batch size in bytes
  MAX_BATCH_BYTES: 256 * 1024, // 256KB

  // Batch timeout (ms) - flush batch even if not full
  BATCH_TIMEOUT: 100,

  // Maximum pending batches
  MAX_PENDING_BATCHES: 10
}

/**
 * Compress data if beneficial
 * @param {string|Buffer} data - Data to compress
 * @param {Object} options - Compression options
 * @returns {Object} { compressed: boolean, data: Buffer, originalSize: number, compressedSize: number }
 */
export function compressIfNeeded(data, options = {}) {
  const config = { ...CompressionConfig, ...options }

  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  const originalSize = input.length

  // Skip compression for small messages
  if (originalSize < config.MIN_COMPRESS_SIZE) {
    return {
      compressed: false,
      data: input,
      originalSize,
      compressedSize: originalSize
    }
  }

  // Force compression for large messages
  if (originalSize > config.MAX_UNCOMPRESSED_SIZE) {
    const compressed = gzipSync(input, { level: config.COMPRESSION_LEVEL })
    return {
      compressed: true,
      data: compressed,
      originalSize,
      compressedSize: compressed.length
    }
  }

  // Try compression and check if beneficial
  const compressed = gzipSync(input, { level: config.COMPRESSION_LEVEL })
  const compressionRatio = compressed.length / originalSize

  if (compressionRatio < config.COMPRESSION_THRESHOLD) {
    return {
      compressed: true,
      data: compressed,
      originalSize,
      compressedSize: compressed.length
    }
  }

  // Compression not beneficial, return original
  return {
    compressed: false,
    data: input,
    originalSize,
    compressedSize: originalSize
  }
}

/**
 * Decompress data if compressed
 * @param {Buffer} data - Data to decompress
 * @param {boolean} isCompressed - Whether data is compressed
 * @returns {Buffer} Decompressed data
 */
export function decompressIfNeeded(data, isCompressed = true) {
  if (!isCompressed) {
    return data
  }

  try {
    return gunzipSync(data)
  } catch (err) {
    throw new Error(`Decompression failed: ${err.message}`)
  }
}

/**
 * Compress and encode to base64 for transmission
 * @param {string|Object} data - Data to compress
 * @returns {string} Base64 encoded compressed data with prefix
 */
export function encodeCompressed(data) {
  const json = typeof data === 'string' ? data : JSON.stringify(data)
  const result = compressIfNeeded(json)

  if (result.compressed) {
    return `gzip:${result.data.toString('base64')}`
  }

  return `raw:${Buffer.from(json).toString('base64')}`
}

/**
 * Decode and decompress from base64
 * @param {string} encoded - Encoded compressed data
 * @returns {string} Decompressed data
 */
export function decodeCompressed(encoded) {
  if (encoded.startsWith('gzip:')) {
    const base64 = encoded.slice(5)
    const compressed = Buffer.from(base64, 'base64')
    const decompressed = decompressIfNeeded(compressed, true)
    return decompressed.toString('utf8')
  }

  if (encoded.startsWith('raw:')) {
    const base64 = encoded.slice(4)
    return Buffer.from(base64, 'base64').toString('utf8')
  }

  // Legacy format (no prefix)
  return encoded
}

/**
 * Message batch class for accumulating and flushing messages
 */
export class MessageBatcher {
  /**
   * @param {Object} options - Configuration
   * @param {number} [options.maxSize] - Maximum messages per batch
   * @param {number} [options.maxBytes] - Maximum bytes per batch
   * @param {number} [options.timeout] - Flush timeout in ms
   * @param {boolean} [options.compress] - Whether to compress batches
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || BatchConfig.MAX_BATCH_SIZE
    this.maxBytes = options.maxBytes || BatchConfig.MAX_BATCH_BYTES
    this.timeout = options.timeout || BatchConfig.BATCH_TIMEOUT
    this.compress = options.compress !== undefined ? options.compress : true

    this.messages = []
    this.currentBytes = 0
    this.flushTimer = null
    this.flushCallback = null
  }

  /**
   * Add a message to the batch
   * @param {Object} message - Message to add
   * @returns {boolean} True if added, false if batch full
   */
  add(message) {
    const msgSize = this._estimateSize(message)

    // Check if adding would exceed limits
    if (this.messages.length >= this.maxSize) {
      return false
    }

    if (this.currentBytes + msgSize > this.maxBytes) {
      return false
    }

    this.messages.push(message)
    this.currentBytes += msgSize

    // Auto-flush if full
    if (this.messages.length >= this.maxSize || this.currentBytes >= this.maxBytes) {
      this._scheduleFlush()
    }

    return true
  }

  /**
   * Estimate message size in bytes
   * @private
   */
  _estimateSize(message) {
    return JSON.stringify(message).length * 2 // Rough estimate
  }

  /**
   * Set the flush callback
   * @param {Function} callback - Callback(batch) when batch flushes
   */
  onFlush(callback) {
    this.flushCallback = callback
  }

  /**
   * Schedule a flush after timeout
   * @private
   */
  _scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }

    this.flushTimer = setTimeout(() => {
      this.flush()
    }, this.timeout)
  }

  /**
   * Flush the current batch
   * @returns {Array} Messages that were flushed
   */
  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    const batch = this.messages.slice()
    this.messages = []
    this.currentBytes = 0

    if (batch.length > 0 && this.flushCallback) {
      // Compress batch if enabled
      let data = batch
      let compressed = false

      if (this.compress) {
        const json = JSON.stringify(batch)
        const result = compressIfNeeded(json)
        if (result.compressed) {
          data = {
            _batch: true,
            compressed: true,
            data: result.data.toString('base64'),
            count: batch.length,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize
          }
          compressed = true
        }
      }

      this.flushCallback(data, compressed)
    }

    return batch
  }

  /**
   * Get current batch size
   * @returns {number} Number of messages in current batch
   */
  get size() {
    return this.messages.length
  }

  /**
   * Get current batch bytes
   * @returns {number} Estimated bytes in current batch
   */
  get bytes() {
    return this.currentBytes
  }

  /**
   * Check if batch is empty
   * @returns {boolean}
   */
  isEmpty() {
    return this.messages.length === 0
  }
}

/**
 * Decompress a batched message
 * @param {Object} batch - Batch object
 * @returns {Array} Array of messages
 */
export function decompressBatch(batch) {
  if (!batch._batch) {
    return [batch] // Single message, not a batch
  }

  if (batch.compressed) {
    const compressed = Buffer.from(batch.data, 'base64')
    const decompressed = gunzipSync(compressed)
    return JSON.parse(decompressed.toString('utf8'))
  }

  // Uncompressed batch
  const data = Buffer.from(batch.data, 'base64').toString('utf8')
  return JSON.parse(data)
}

/**
 * Create a batched message from multiple messages
 * @param {Array} messages - Messages to batch
 * @param {Object} options - Options
 * @returns {Object} Batched message
 */
export function createBatch(messages, options = {}) {
  const compress = options.compress !== undefined ? options.compress : true

  if (messages.length === 1) {
    return messages[0]
  }

  let data
  let compressed = false
  let originalSize = 0
  let compressedSize = 0

  const json = JSON.stringify(messages)
  originalSize = json.length

  if (compress) {
    const result = compressIfNeeded(json)
    if (result.compressed) {
      data = result.data.toString('base64')
      compressed = true
      compressedSize = result.compressedSize
    } else {
      data = Buffer.from(json).toString('base64')
      compressedSize = originalSize
    }
  } else {
    data = Buffer.from(json).toString('base64')
    compressedSize = originalSize
  }

  return {
    _batch: true,
    compressed,
    data,
    count: messages.length,
    originalSize,
    compressedSize
  }
}

/**
 * Singleton batcher instance for the worker
 */
let workerBatcher = null

/**
 * Get or create the worker batcher
 * @param {Object} options - Configuration options
 * @returns {MessageBatcher} Batcher instance
 */
export function getWorkerBatcher(options = {}) {
  if (!workerBatcher) {
    workerBatcher = new MessageBatcher({
      maxSize: 50,
      maxBytes: 128 * 1024,
      timeout: 50,
      compress: true,
      ...options
    })
  }
  return workerBatcher
}

/**
 * Reset the worker batcher (mainly for testing)
 */
export function resetWorkerBatcher() {
  if (workerBatcher) {
    workerBatcher.flush()
  }
  workerBatcher = null
}

/**
 * Calculate compression stats
 * @param {number} originalSize - Original data size
 * @param {number} compressedSize - Compressed data size
 * @returns {Object} Stats object
 */
export function calculateCompressionStats(originalSize, compressedSize) {
  const ratio = compressedSize / originalSize
  const savings = 1 - ratio

  return {
    originalSize,
    compressedSize,
    ratio: Math.round(ratio * 1000) / 1000,
    savingsPercent: Math.round(savings * 100),
    savingsBytes: originalSize - compressedSize
  }
}
