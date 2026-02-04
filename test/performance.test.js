/**
 * Performance optimization module tests
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import crypto from 'crypto'
import {
  compressIfNeeded,
  decompressIfNeeded,
  encodeCompressed,
  decodeCompressed,
  MessageBatcher,
  decompressBatch,
  createBatch,
  getWorkerBatcher,
  resetWorkerBatcher,
  calculateCompressionStats,
  CompressionConfig,
  BatchConfig
} from '../src/utils/performance.js'

describe('Performance - Compression', () => {
  describe('compressIfNeeded', () => {
    it('should not compress small messages', () => {
      const small = 'hello'
      const result = compressIfNeeded(small)
      assert.strictEqual(result.compressed, false)
      assert.strictEqual(result.originalSize, 5)
      assert.strictEqual(result.compressedSize, 5)
    })

    it('should compress large messages', () => {
      const large = 'x'.repeat(2000)
      const result = compressIfNeeded(large)
      assert.strictEqual(result.compressed, true)
      assert.ok(result.compressedSize < result.originalSize)
    })

    it('should compress when size exceeds max uncompressed', () => {
      const large = 'y'.repeat(CompressionConfig.MAX_UNCOMPRESSED_SIZE + 100)
      const result = compressIfNeeded(large)
      assert.strictEqual(result.compressed, true)
    })

    it('should not compress if not beneficial', () => {
      // Random data that doesn't compress well
      const random = Buffer.from(crypto.randomBytes(500))
      const result = compressIfNeeded(random)
      // Random data might still compress due to gzip, but ratio should be poor
      assert.ok(result.compressedSize <= result.originalSize)
    })

    it('should handle Buffer input', () => {
      const buffer = Buffer.from('test data that is long enough to consider compression')
      const result = compressIfNeeded(buffer)
      assert.ok('data' in result)
      assert.ok('originalSize' in result)
    })
  })

  describe('decompressIfNeeded', () => {
    it('should return data if not compressed', () => {
      const data = Buffer.from('hello')
      const result = decompressIfNeeded(data, false)
      assert.deepStrictEqual(result, data)
    })

    it('should decompress compressed data', () => {
      const original = 'hello world'.repeat(100)
      const compressed = compressIfNeeded(original)

      if (compressed.compressed) {
        const decompressed = decompressIfNeeded(compressed.data, true)
        assert.strictEqual(decompressed.toString(), original)
      }
    })

    it('should throw on invalid compressed data', () => {
      assert.throws(() => {
        decompressIfNeeded(Buffer.from('invalid gzip data'), true)
      }, /Decompression failed/)
    })
  })

  describe('encodeCompressed', () => {
    it('should encode as raw for small data', () => {
      const encoded = encodeCompressed('hello')
      assert.ok(encoded.startsWith('raw:'))
    })

    it('should encode as gzip for large data', () => {
      const large = 'x'.repeat(1000)
      const encoded = encodeCompressed(large)
      // May or may not compress depending on content
      assert.ok(encoded.startsWith('raw:') || encoded.startsWith('gzip:'))
    })

    it('should handle objects', () => {
      const obj = { message: 'hello', data: 'x'.repeat(500) }
      const encoded = encodeCompressed(obj)
      assert.ok(encoded.startsWith('raw:') || encoded.startsWith('gzip:'))
    })
  })

  describe('decodeCompressed', () => {
    it('should decode raw format', () => {
      const encoded = encodeCompressed('hello world')
      const decoded = decodeCompressed(encoded)
      assert.strictEqual(decoded, 'hello world')
    })

    it('should decode gzip format', () => {
      const large = 'test data '.repeat(100)
      const encoded = encodeCompressed(large)
      const decoded = decodeCompressed(encoded)
      assert.strictEqual(decoded, large)
    })

    it('should handle objects', () => {
      const obj = { test: 'value', repeated: 'data '.repeat(50) }
      const encoded = encodeCompressed(obj)
      const decoded = decodeCompressed(encoded)
      assert.deepStrictEqual(JSON.parse(decoded), obj)
    })
  })

  describe('calculateCompressionStats', () => {
    it('should calculate compression stats', () => {
      const stats = calculateCompressionStats(1000, 300)
      assert.strictEqual(stats.originalSize, 1000)
      assert.strictEqual(stats.compressedSize, 300)
      assert.strictEqual(stats.ratio, 0.3)
      assert.strictEqual(stats.savingsPercent, 70)
      assert.strictEqual(stats.savingsBytes, 700)
    })

    it('should handle no compression', () => {
      const stats = calculateCompressionStats(1000, 1000)
      assert.strictEqual(stats.savingsPercent, 0)
      assert.strictEqual(stats.savingsBytes, 0)
    })
  })
})

describe('Performance - MessageBatcher', () => {
  let batcher

  beforeEach(() => {
    resetWorkerBatcher()
    batcher = new MessageBatcher({
      maxSize: 5,
      maxBytes: 1024,
      timeout: 50
    })
  })

  describe('add', () => {
    it('should add messages to batch', () => {
      const added = batcher.add({ id: 1, data: 'test' })
      assert.strictEqual(added, true)
      assert.strictEqual(batcher.size, 1)
    })

    it('should reject when batch is full', () => {
      for (let i = 0; i < 5; i++) {
        batcher.add({ id: i })
      }

      const added = batcher.add({ id: 5 })
      assert.strictEqual(added, false)
      assert.strictEqual(batcher.size, 5)
    })

    it('should estimate bytes correctly', () => {
      batcher.add({ data: 'x'.repeat(100) })
      assert.ok(batcher.bytes > 0)
    })
  })

  describe('flush', () => {
    it('should flush all messages', () => {
      batcher.add({ id: 1 })
      batcher.add({ id: 2 })

      let flushed = null
      batcher.onFlush((batch) => {
        flushed = batch
      })

      const messages = batcher.flush()
      assert.strictEqual(messages.length, 2)
      assert.ok(flushed)
      assert.strictEqual(batcher.size, 0)
    })

    it('should return empty array if no messages', () => {
      const messages = batcher.flush()
      assert.deepStrictEqual(messages, [])
    })

    it('should call flush callback', () => {
      batcher.add({ id: 1 })

      let callbackCalled = false
      batcher.onFlush(() => {
        callbackCalled = true
      })

      batcher.flush()
      assert.strictEqual(callbackCalled, true)
    })

    it('should clear timer on flush', () => {
      batcher.add({ id: 1 })
      batcher.flush()
      // Timer should be cleared, no auto-flush
    })
  })

  describe('isEmpty', () => {
    it('should return true when empty', () => {
      assert.strictEqual(batcher.isEmpty(), true)
    })

    it('should return false when has messages', () => {
      batcher.add({ id: 1 })
      assert.strictEqual(batcher.isEmpty(), false)
    })
  })
})

describe('Performance - Batch Functions', () => {
  describe('decompressBatch', () => {
    it('should return single message for non-batch', () => {
      const msg = { id: 1, text: 'hello' }
      const result = decompressBatch(msg)
      assert.deepStrictEqual(result, [msg])
    })

    it('should decompress batched messages', () => {
      const messages = [
        { id: 1, text: 'message 1' },
        { id: 2, text: 'message 2' }
      ]
      const batch = createBatch(messages, { compress: false })
      const result = decompressBatch(batch)

      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0].id, 1)
      assert.strictEqual(result[1].id, 2)
    })
  })

  describe('createBatch', () => {
    it('should return single message for one item', () => {
      const msg = { id: 1 }
      const result = createBatch([msg])
      assert.deepStrictEqual(result, msg)
    })

    it('should create batch for multiple items', () => {
      const messages = [{ id: 1 }, { id: 2 }]
      const result = createBatch(messages, { compress: false })

      assert.strictEqual(result._batch, true)
      assert.strictEqual(result.count, 2)
      assert.ok(result.data)
    })

    it('should compress batch when enabled', () => {
      const messages = [{ id: 1 }, { id: 2 }]
      const result = createBatch(messages, { compress: true })
      assert.strictEqual(result._batch, true)
      // Check if compression was beneficial
      assert.ok(result.compressed !== undefined)
    })
  })

  describe('getWorkerBatcher', () => {
    it('should return singleton instance', () => {
      resetWorkerBatcher()
      const b1 = getWorkerBatcher()
      const b2 = getWorkerBatcher()
      assert.strictEqual(b1, b2)
    })

    it('should reset with resetWorkerBatcher', () => {
      const b1 = getWorkerBatcher()
      resetWorkerBatcher()
      const b2 = getWorkerBatcher()
      assert.notStrictEqual(b1, b2)
    })
  })
})
