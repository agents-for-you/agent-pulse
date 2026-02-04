/**
 * @fileoverview Group encryption unit tests
 * Tests group message encryption/decryption functionality
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import crypto from 'crypto'

// Simulate group encryption functions from worker.js
// Since these functions are not exported in worker.js, we reimplement them in tests

/**
 * Derive group shared key from topic
 */
function deriveGroupKey(topic) {
  const salt = Buffer.from('agent-p2p-group-v1')
  const key = crypto.hkdfSync('sha256', topic, salt, 'encryption', 32)
  const ivPrefix = crypto.hkdfSync('sha256', topic, salt, 'iv', 8)

  return { key: Buffer.from(key), ivPrefix: Buffer.from(ivPrefix) }
}

/**
 * Encrypt group message
 */
function encryptGroupMessage(topic, plaintext) {
  const { key, ivPrefix } = deriveGroupKey(topic)

  const ivRandom = crypto.randomBytes(8)
  const iv = Buffer.concat([ivPrefix, ivRandom])

  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  return ivRandom.toString('base64') + ':' + encrypted
}

/**
 * Decrypt group message
 */
function decryptGroupMessage(topic, ciphertext) {
  const { key, ivPrefix } = deriveGroupKey(topic)

  const [ivRandomB64, encrypted] = ciphertext.split(':')
  if (!ivRandomB64 || !encrypted) {
    throw new Error('Invalid ciphertext format')
  }

  const ivRandom = Buffer.from(ivRandomB64, 'base64')
  const iv = Buffer.concat([ivPrefix, ivRandom])

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(encrypted, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

describe('Group Encryption', () => {
  describe('deriveGroupKey', () => {
    it('should derive consistent keys for same topic', () => {
      const topic = 'test-group-topic'
      const key1 = deriveGroupKey(topic)
      const key2 = deriveGroupKey(topic)

      assert.deepStrictEqual(key1.key, key2.key)
      assert.deepStrictEqual(key1.ivPrefix, key2.ivPrefix)
    })

    it('should derive different keys for different topics', () => {
      const key1 = deriveGroupKey('topic-1')
      const key2 = deriveGroupKey('topic-2')

      assert.notDeepStrictEqual(key1.key, key2.key)
    })

    it('should produce 32-byte key', () => {
      const { key } = deriveGroupKey('test-topic')
      assert.strictEqual(key.length, 32)
    })

    it('should produce 8-byte IV prefix', () => {
      const { ivPrefix } = deriveGroupKey('test-topic')
      assert.strictEqual(ivPrefix.length, 8)
    })
  })

  describe('encryptGroupMessage', () => {
    it('should encrypt message to different ciphertext each time', () => {
      const topic = 'test-topic'
      const message = 'Hello, group!'

      const enc1 = encryptGroupMessage(topic, message)
      const enc2 = encryptGroupMessage(topic, message)

      // Random IV means different ciphertext
      assert.notStrictEqual(enc1, enc2)
    })

    it('should produce ciphertext in expected format', () => {
      const ciphertext = encryptGroupMessage('topic', 'message')

      // Format: ivRandom(base64):encrypted(base64)
      const parts = ciphertext.split(':')
      assert.strictEqual(parts.length, 2)

      // Verify base64 format
      assert.doesNotThrow(() => Buffer.from(parts[0], 'base64'))
      assert.doesNotThrow(() => Buffer.from(parts[1], 'base64'))
    })
  })

  describe('decryptGroupMessage', () => {
    it('should decrypt message correctly', () => {
      const topic = 'test-topic'
      const original = 'Secret group message'

      const encrypted = encryptGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, encrypted)

      assert.strictEqual(decrypted, original)
    })

    it('should handle unicode messages', () => {
      const topic = 'unicode-topic'
      const original = 'Hello World 🎉 Welcome'

      const encrypted = encryptGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, encrypted)

      assert.strictEqual(decrypted, original)
    })

    it('should handle JSON messages', () => {
      const topic = 'json-topic'
      const data = { type: 'message', content: 'Hello', timestamp: Date.now() }
      const original = JSON.stringify(data)

      const encrypted = encryptGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, encrypted)

      assert.deepStrictEqual(JSON.parse(decrypted), data)
    })

    it('should fail with wrong topic', () => {
      const encrypted = encryptGroupMessage('topic-1', 'message')

      // Decrypting with wrong topic should fail
      assert.throws(() => decryptGroupMessage('topic-2', encrypted))
    })

    it('should throw on invalid format', () => {
      assert.throws(() => decryptGroupMessage('topic', 'invalid'), /Invalid ciphertext format/)
      assert.throws(() => decryptGroupMessage('topic', 'no-colon'), /Invalid ciphertext format/)
    })

    it('should handle long messages', () => {
      const topic = 'long-topic'
      const original = 'A'.repeat(10000)

      const encrypted = encryptGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, encrypted)

      assert.strictEqual(decrypted, original)
    })
  })

  describe('Cross-member decryption', () => {
    it('should allow any member with topic to decrypt', () => {
      // Simulate different members using same topic
      const sharedTopic = 'shared-group-abc123'
      const message = 'Group announcement'

      // Member A encrypts
      const encrypted = encryptGroupMessage(sharedTopic, message)

      // Member B decrypts (same topic derivation)
      const decrypted = decryptGroupMessage(sharedTopic, encrypted)

      assert.strictEqual(decrypted, message)
    })
  })
})
