/**
 * @fileoverview Identity unit tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  loadOrCreateIdentity,
  generateIdentity,
  loadIdentityFromSecretKey,
  getIdentityPublicKey,
  exportSecretKey
} from '../src/core/identity.js'

describe('Identity', () => {
  let tempDir
  let identityFile

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-identity-test-'))
    identityFile = path.join(tempDir, '.agent-identity.json')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('generateIdentity', () => {
    it('should generate a valid identity', () => {
      const identity = generateIdentity()

      assert.ok(identity.secretKey instanceof Uint8Array)
      assert.strictEqual(identity.secretKey.length, 32)
      assert.strictEqual(typeof identity.publicKey, 'string')
      assert.strictEqual(identity.publicKey.length, 64) // hex encoded
    })

    it('should generate unique identities', () => {
      const id1 = generateIdentity()
      const id2 = generateIdentity()

      assert.notStrictEqual(id1.publicKey, id2.publicKey)
    })

    it('should return frozen object', () => {
      const identity = generateIdentity()

      assert.ok(Object.isFrozen(identity))
      // Uint8Array cannot be frozen in JavaScript, so we only check the identity object itself
      assert.ok(identity.secretKey instanceof Uint8Array)
    })
  })

  describe('loadIdentityFromSecretKey', () => {
    it('should load identity from valid hex key', () => {
      process.env.SECRET_KEY_EXPORT_AUTH = 'TEST_AUTH_TOKEN'

      try {
        const original = generateIdentity()
        const secretKeyHex = exportSecretKey(original, { authorization: 'TEST_AUTH_TOKEN' })

        const loaded = loadIdentityFromSecretKey(secretKeyHex)

        assert.strictEqual(loaded.publicKey, original.publicKey)
      } finally {
        delete process.env.SECRET_KEY_EXPORT_AUTH
      }
    })

    it('should throw for invalid key format', () => {
      assert.throws(() => loadIdentityFromSecretKey('invalid'), /Invalid secret key format/)
      assert.throws(() => loadIdentityFromSecretKey(''), /Invalid secret key format/)
      assert.throws(() => loadIdentityFromSecretKey(null), /Invalid secret key format/)
    })

    it('should throw for wrong length key', () => {
      assert.throws(() => loadIdentityFromSecretKey('abcd'), /Invalid secret key format/)
    })
  })

  describe('loadOrCreateIdentity', () => {
    it('should create new identity when file does not exist', () => {
      const identity = loadOrCreateIdentity(identityFile)

      assert.ok(identity.publicKey)
      assert.ok(fs.existsSync(identityFile))
    })

    it('should load existing identity from file', () => {
      const first = loadOrCreateIdentity(identityFile)
      const second = loadOrCreateIdentity(identityFile)

      assert.strictEqual(first.publicKey, second.publicKey)
    })

    it('should save identity file with secure permissions', () => {
      loadOrCreateIdentity(identityFile)

      const stats = fs.statSync(identityFile)
      assert.strictEqual(stats.mode & 0o777, 0o600)
    })
  })

  describe('getIdentityPublicKey', () => {
    it('should return public key', () => {
      const identity = generateIdentity()
      const pubkey = getIdentityPublicKey(identity)

      assert.strictEqual(pubkey, identity.publicKey)
    })
  })

  describe('exportSecretKey', () => {
    it('should return hex-encoded secret key when auth is configured', () => {
      // Set environment variable to allow export
      process.env.SECRET_KEY_EXPORT_AUTH = 'TEST_AUTH_TOKEN'

      try {
        const identity = generateIdentity()
        const exported = exportSecretKey(identity, { authorization: 'TEST_AUTH_TOKEN' })

        assert.strictEqual(typeof exported, 'string')
        assert.strictEqual(exported.length, 64)
      } finally {
        delete process.env.SECRET_KEY_EXPORT_AUTH
      }
    })

    it('should throw without authorization', () => {
      // Ensure no auth token is set
      delete process.env.SECRET_KEY_EXPORT_AUTH

      const identity = generateIdentity()
      assert.throws(
        () => exportSecretKey(identity),
        /Unauthorized/
      )
    })

    it('should throw when no auth tokens configured', () => {
      // Set to empty string
      process.env.SECRET_KEY_EXPORT_AUTH = ''

      try {
        const identity = generateIdentity()
        assert.throws(
          () => exportSecretKey(identity),
          /not configured/
        )
      } finally {
        delete process.env.SECRET_KEY_EXPORT_AUTH
      }
    })
  })
})
