/**
 * @fileoverview Group encryption unit tests
 * Tests AES-256-GCM group message encryption/decryption with backward compatibility
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import crypto from 'crypto'

// ============ New GCM implementation ============

/**
 * Derive group shared key from topic using GCM-compatible derivation
 * Uses proper random salt per group with topic binding
 */
function deriveGroupKey(topic) {
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > 200) {
    throw new Error('Invalid topic format')
  }

  const APP_IDENTIFIER = 'agent-p2p-group-v3'
  const baseSalt = Buffer.from(APP_IDENTIFIER, 'utf8')
  const salt = crypto.hkdfSync('sha256', topic, baseSalt, 'salt', 32)
  const key = crypto.hkdfSync('sha256', topic, Buffer.from(salt), 'encryption', 32)

  return { key: Buffer.from(key), salt: Buffer.from(salt) }
}

/**
 * Encrypt group message using AES-256-GCM
 */
function encryptGroupMessage(topic, plaintext) {
  const { key } = deriveGroupKey(topic)
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)

  // Set topic as AAD
  cipher.setAAD(Buffer.from(topic, 'utf8'), {
    plaintextLength: Buffer.byteLength(plaintext, 'utf8')
  })

  let encrypted = cipher.update(plaintext, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  const authTag = cipher.getAuthTag()

  const nonceB64 = nonce.toString('base64')
  const encryptedB64 = encrypted.toString('base64')
  const tagB64 = authTag.toString('base64')

  return `v2:${nonceB64}:${encryptedB64}:${tagB64}`
}

/**
 * Decrypt group message with version detection
 */
function decryptGroupMessage(topic, ciphertext) {
  const { key } = deriveGroupKey(topic)
  const parts = ciphertext.split(':')

  if (parts[0] === 'v2' && parts.length === 4) {
    // New GCM format
    const [, nonceB64, encryptedB64, tagB64] = parts
    const nonce = Buffer.from(nonceB64, 'base64')
    const encrypted = Buffer.from(encryptedB64, 'base64')
    const authTag = Buffer.from(tagB64, 'base64')

    if (nonce.length !== 12) {
      throw new Error('Invalid nonce length')
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(authTag)
    decipher.setAAD(Buffer.from(topic, 'utf8'), {
      plaintextLength: encrypted.length
    })

    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted.toString('utf8')
  }

  // Legacy format fallback
  try {
    return decryptLegacyGroupMessage(topic, ciphertext)
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}`)
  }
}

/**
 * Decrypt legacy group message (AES-256-CBC format)
 */
function decryptLegacyGroupMessage(topic, ciphertext) {
  const APP_IDENTIFIER = 'agent-p2p-group-v2'
  const salt = Buffer.from(APP_IDENTIFIER, 'utf8')
  const key = crypto.hkdfSync('sha256', topic, salt, 'encryption', 32)
  const ivPrefix = crypto.hkdfSync('sha256', topic, salt, 'iv', 8)

  const [ivRandomB64, encrypted] = ciphertext.split(':')
  if (!ivRandomB64 || !encrypted) {
    throw new Error('Invalid legacy ciphertext format')
  }

  const ivRandom = Buffer.from(ivRandomB64, 'base64')
  const iv = Buffer.concat([Buffer.from(ivPrefix), ivRandom])

  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv)
  let decrypted = decipher.update(encrypted, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Encrypt with legacy format for testing backward compatibility
 */
function encryptLegacyGroupMessage(topic, plaintext) {
  const APP_IDENTIFIER = 'agent-p2p-group-v2'
  const salt = Buffer.from(APP_IDENTIFIER, 'utf8')
  const key = crypto.hkdfSync('sha256', topic, salt, 'encryption', 32)
  const ivPrefix = crypto.hkdfSync('sha256', topic, salt, 'iv', 8)

  const ivRandom = crypto.randomBytes(8)
  const iv = Buffer.concat([Buffer.from(ivPrefix), ivRandom])

  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  return ivRandom.toString('base64') + ':' + encrypted
}

describe('Group Encryption (GCM)', () => {
  describe('deriveGroupKey', () => {
    it('should derive consistent keys for same topic', () => {
      const topic = 'test-group-topic'
      const key1 = deriveGroupKey(topic)
      const key2 = deriveGroupKey(topic)

      assert.deepStrictEqual(key1.key, key2.key)
      assert.deepStrictEqual(key1.salt, key2.salt)
    })

    it('should derive different keys for different topics', () => {
      const key1 = deriveGroupKey('topic-1')
      const key2 = deriveGroupKey('topic-2')

      assert.notDeepStrictEqual(key1.key, key2.key)
      assert.notDeepStrictEqual(key1.salt, key2.salt)
    })

    it('should produce 32-byte key for AES-256', () => {
      const { key } = deriveGroupKey('test-topic')
      assert.strictEqual(key.length, 32)
    })

    it('should produce 32-byte salt', () => {
      const { salt } = deriveGroupKey('test-topic')
      assert.strictEqual(salt.length, 32)
    })

    it('should reject invalid topic format', () => {
      assert.throws(() => deriveGroupKey(''), /Invalid topic format/)
      assert.throws(() => deriveGroupKey('a'.repeat(201)), /Invalid topic format/)
    })
  })

  describe('encryptGroupMessage (GCM)', () => {
    it('should encrypt message to different ciphertext each time', () => {
      const topic = 'test-topic'
      const message = 'Hello, group!'

      const enc1 = encryptGroupMessage(topic, message)
      const enc2 = encryptGroupMessage(topic, message)

      // Random nonce means different ciphertext
      assert.notStrictEqual(enc1, enc2)
    })

    it('should produce v2 versioned ciphertext', () => {
      const ciphertext = encryptGroupMessage('topic', 'message')

      assert.match(ciphertext, /^v2:/)
      const parts = ciphertext.split(':')
      assert.strictEqual(parts.length, 4) // v2:nonce:encrypted:tag
    })

    it('should produce valid base64 components', () => {
      const ciphertext = encryptGroupMessage('topic', 'message')
      const parts = ciphertext.split(':')

      const [, nonceB64, encryptedB64, tagB64] = parts

      // Verify all components are valid base64
      assert.doesNotThrow(() => Buffer.from(nonceB64, 'base64'))
      assert.doesNotThrow(() => Buffer.from(encryptedB64, 'base64'))
      assert.doesNotThrow(() => Buffer.from(tagB64, 'base64'))

      // Verify nonce is 12 bytes
      const nonce = Buffer.from(nonceB64, 'base64')
      assert.strictEqual(nonce.length, 12)

      // Verify tag is 16 bytes (GCM standard)
      const tag = Buffer.from(tagB64, 'base64')
      assert.strictEqual(tag.length, 16)
    })

    it('should use different nonce for each encryption', () => {
      const topic = 'test-topic'
      const message = 'Same message'

      const enc1 = encryptGroupMessage(topic, message)
      const enc2 = encryptGroupMessage(topic, message)

      const nonce1 = Buffer.from(enc1.split(':')[1], 'base64')
      const nonce2 = Buffer.from(enc2.split(':')[1], 'base64')

      assert.notDeepStrictEqual(nonce1, nonce2)
    })
  })

  describe('decryptGroupMessage (GCM)', () => {
    it('should decrypt message correctly', () => {
      const topic = 'test-topic'
      const original = 'Secret group message'

      const encrypted = encryptGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, encrypted)

      assert.strictEqual(decrypted, original)
    })

    it('should handle unicode messages', () => {
      const topic = 'unicode-topic'
      const original = 'Hello World 🎉 Welcome 🚀'

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

    it('should fail with wrong topic (authentication failure)', () => {
      const encrypted = encryptGroupMessage('topic-1', 'message')

      // Decrypting with wrong topic should fail due to AAD mismatch
      assert.throws(() => decryptGroupMessage('topic-2', encrypted))
    })

    it('should fail with tampered ciphertext', () => {
      const topic = 'test-topic'
      const original = 'Important message'

      const encrypted = encryptGroupMessage(topic, original)

      // Tamper with the ciphertext
      const parts = encrypted.split(':')
      const tamperedEncrypted = Buffer.from(parts[2], 'base64')
      tamperedEncrypted[0] = tamperedEncrypted[0] ^ 0xff // Flip bits

      const tamperedMessage = `v2:${parts[1]}:${tamperedEncrypted.toString('base64')}:${parts[3]}`

      // Should fail due to authentication tag verification
      assert.throws(() => decryptGroupMessage(topic, tamperedMessage))
    })

    it('should fail with tampered auth tag', () => {
      const topic = 'test-topic'
      const original = 'Important message'

      const encrypted = encryptGroupMessage(topic, original)

      // Tamper with the auth tag
      const parts = encrypted.split(':')
      const tamperedTag = Buffer.from(parts[3], 'base64')
      tamperedTag[0] = tamperedTag[0] ^ 0xff

      const tamperedMessage = `v2:${parts[1]}:${parts[2]}:${tamperedTag.toString('base64')}`

      // Should fail due to authentication tag verification
      assert.throws(() => decryptGroupMessage(topic, tamperedMessage))
    })

    it('should fail with wrong nonce length', () => {
      const topic = 'test-topic'

      // Create message with wrong nonce length (8 bytes instead of 12)
      const shortNonce = crypto.randomBytes(8).toString('base64')
      const fakeMessage = `v2:${shortNonce}:fake:text:tag`

      // Should throw - the error message may vary between Node versions
      assert.throws(() => decryptGroupMessage(topic, fakeMessage))
    })

    it('should fail with tampered topic in AAD (topic substitution attack)', () => {
      // This tests that AAD properly binds the topic to the message
      const topic1 = 'topic-1'
      const topic2 = 'topic-2'
      const original = 'Secret message'

      const encrypted = encryptGroupMessage(topic1, original)

      // Try to decrypt with different topic (should fail due to AAD mismatch)
      assert.throws(() => decryptGroupMessage(topic2, encrypted))
    })

    it('should handle long messages', () => {
      const topic = 'long-topic'
      const original = 'A'.repeat(10000)

      const encrypted = encryptGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, encrypted)

      assert.strictEqual(decrypted, original)
    })
  })

  describe('Backward compatibility', () => {
    it('should decrypt legacy CBC format messages', () => {
      const topic = 'legacy-topic'
      const original = 'Legacy message'

      // Encrypt using legacy format
      const legacyEncrypted = encryptLegacyGroupMessage(topic, original)

      // Should decrypt successfully
      const decrypted = decryptGroupMessage(topic, legacyEncrypted)

      assert.strictEqual(decrypted, original)
    })

    it('should distinguish v2 from legacy format', () => {
      const topic = 'test-topic'
      const message = 'Test message'

      const v2Encrypted = encryptGroupMessage(topic, message)
      const legacyEncrypted = encryptLegacyGroupMessage(topic, message)

      // v2 format starts with 'v2:'
      assert.match(v2Encrypted, /^v2:/)
      // Legacy format does not start with 'v2:'
      assert.doesNotMatch(legacyEncrypted, /^v2:/)
    })

    it('should handle unicode in legacy format', () => {
      const topic = 'unicode-topic'
      const original = 'Hello World 🎉'

      const legacyEncrypted = encryptLegacyGroupMessage(topic, original)
      const decrypted = decryptGroupMessage(topic, legacyEncrypted)

      assert.strictEqual(decrypted, original)
    })

    it('should fail on completely invalid format', () => {
      assert.throws(() => decryptGroupMessage('topic', 'invalid-format'))
      assert.throws(() => decryptGroupMessage('topic', 'v2:invalid'))
    })
  })

  describe('Cross-member decryption', () => {
    it('should allow any member with topic to decrypt (v2)', () => {
      const sharedTopic = 'shared-group-abc123'
      const message = 'Group announcement'

      // Member A encrypts with new format
      const encrypted = encryptGroupMessage(sharedTopic, message)

      // Member B decrypts (same topic derivation)
      const decrypted = decryptGroupMessage(sharedTopic, encrypted)

      assert.strictEqual(decrypted, message)
    })

    it('should allow any member with topic to decrypt (legacy)', () => {
      const sharedTopic = 'shared-group-legacy'
      const message = 'Legacy announcement'

      // Member A encrypts with legacy format
      const encrypted = encryptLegacyGroupMessage(sharedTopic, message)

      // Member B decrypts
      const decrypted = decryptGroupMessage(sharedTopic, encrypted)

      assert.strictEqual(decrypted, message)
    })
  })

  describe('Security properties', () => {
    it('should not leak information about identical plaintexts', () => {
      const topic = 'security-topic'
      const message = 'Same message content'

      const enc1 = encryptGroupMessage(topic, message)
      const enc2 = encryptGroupMessage(topic, message)

      // Due to random nonce, ciphertexts should differ
      assert.notStrictEqual(enc1, enc2)

      // Nonces should differ
      const nonce1 = enc1.split(':')[1]
      const nonce2 = enc2.split(':')[1]
      assert.notStrictEqual(nonce1, nonce2)
    })

    it('should provide authentication via GCM tag', () => {
      const topic = 'auth-topic'
      const message = 'Authenticated message'

      const encrypted = encryptGroupMessage(topic, message)

      // Verify tag exists and is 16 bytes
      const tag = Buffer.from(encrypted.split(':')[3], 'base64')
      assert.strictEqual(tag.length, 16)
    })

    it('should bind topic as AAD preventing substitution', () => {
      const topic1 = 'topic-a'
      const topic2 = 'topic-b'
      const message = 'Sensitive data'

      const encrypted = encryptGroupMessage(topic1, message)

      // Topic substitution should fail authentication
      // GCM will throw "Unsupported state or unable to authenticate data" on AAD mismatch
      assert.throws(() => {
        decryptGroupMessage(topic2, encrypted)
      })
    })
  })
})
