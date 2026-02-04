/**
 * @fileoverview Shared module unit tests
 * Tests LRUCache, file lock, encrypted storage, etc.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  LRUCache,
  sleep,
  generateId,
  atomicWriteFileSync,
  safeUnlink,
  ensureDataDir,
  encryptForStorage,
  decryptFromStorage,
  ErrorCode
} from '../src/service/shared.js'

describe('LRUCache', () => {
  describe('basic operations', () => {
    it('should set and get values', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      assert.strictEqual(cache.get('key1'), 'value1')
    })

    it('should check existence with has()', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      assert.strictEqual(cache.has('key1'), true)
      assert.strictEqual(cache.has('key2'), false)
    })

    it('should add keys with add()', () => {
      const cache = new LRUCache(10)
      cache.add('key1')
      assert.strictEqual(cache.has('key1'), true)
      assert.strictEqual(cache.get('key1'), true)
    })

    it('should delete keys', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      cache.delete('key1')
      assert.strictEqual(cache.has('key1'), false)
    })

    it('should clear all entries', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()
      assert.strictEqual(cache.size, 0)
    })

    it('should return correct size', () => {
      const cache = new LRUCache(10)
      assert.strictEqual(cache.size, 0)
      cache.set('key1', 'value1')
      assert.strictEqual(cache.size, 1)
      cache.set('key2', 'value2')
      assert.strictEqual(cache.size, 2)
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when full', () => {
      const cache = new LRUCache(3)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      cache.set('key4', 'value4') // should evict key1

      assert.strictEqual(cache.has('key1'), false)
      assert.strictEqual(cache.has('key2'), true)
      assert.strictEqual(cache.has('key4'), true)
    })

    it('should refresh access order on get', () => {
      const cache = new LRUCache(3)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // Access key1 to refresh it
      cache.get('key1')

      // Add key4, should evict key2 (oldest now)
      cache.set('key4', 'value4')

      assert.strictEqual(cache.has('key1'), true)
      assert.strictEqual(cache.has('key2'), false)
    })

    it('should not duplicate on set existing key', () => {
      const cache = new LRUCache(3)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key1', 'updated') // update existing

      assert.strictEqual(cache.size, 2)
      assert.strictEqual(cache.get('key1'), 'updated')
    })
  })

  describe('iteration methods', () => {
    it('should return all entries', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const entries = cache.entries()
      assert.strictEqual(entries.length, 2)
    })

    it('should return all keys', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const keys = cache.keys()
      assert.ok(keys.includes('key1'))
      assert.ok(keys.includes('key2'))
    })

    it('should return all values', () => {
      const cache = new LRUCache(10)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const values = cache.values()
      assert.ok(values.includes('value1'))
      assert.ok(values.includes('value2'))
    })
  })
})

describe('sleep', () => {
  it('should wait approximately the specified time', async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`)
    assert.ok(elapsed < 100, `Expected less than 100ms, got ${elapsed}ms`)
  })
})

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const ids = new Set()
    for (let i = 0; i < 100; i++) {
      ids.add(generateId())
    }
    assert.strictEqual(ids.size, 100)
  })

  it('should generate string IDs', () => {
    const id = generateId()
    assert.strictEqual(typeof id, 'string')
    assert.ok(id.length > 0)
  })
})

describe('atomicWriteFileSync', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-atomic-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should write file atomically', () => {
    const filePath = path.join(tempDir, 'test.txt')
    const content = 'Hello, World!'

    atomicWriteFileSync(filePath, content)

    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content)
  })

  it('should overwrite existing file', () => {
    const filePath = path.join(tempDir, 'test.txt')
    fs.writeFileSync(filePath, 'old content')

    atomicWriteFileSync(filePath, 'new content')

    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'new content')
  })

  it('should not leave temp file on success', () => {
    const filePath = path.join(tempDir, 'test.txt')
    atomicWriteFileSync(filePath, 'content')

    const files = fs.readdirSync(tempDir)
    assert.strictEqual(files.length, 1)
    assert.strictEqual(files[0], 'test.txt')
  })
})

describe('safeUnlink', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-unlink-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should delete existing file', () => {
    const filePath = path.join(tempDir, 'test.txt')
    fs.writeFileSync(filePath, 'content')

    safeUnlink(filePath)

    assert.strictEqual(fs.existsSync(filePath), false)
  })

  it('should not throw for non-existent file', () => {
    const filePath = path.join(tempDir, 'nonexistent.txt')
    assert.doesNotThrow(() => safeUnlink(filePath))
  })

  it('should call log function on non-ENOENT error', () => {
    const dirPath = path.join(tempDir, 'subdir')
    fs.mkdirSync(dirPath)

    let logCalled = false
    safeUnlink(dirPath, () => { logCalled = true })

    // Trying to unlink a directory should cause an error
    assert.strictEqual(logCalled, true)
  })
})

describe('Storage encryption', () => {
  it('should encrypt and decrypt data correctly', () => {
    const original = 'Hello, secret world!'
    const encrypted = encryptForStorage(original)
    const decrypted = decryptFromStorage(encrypted)

    assert.strictEqual(decrypted, original)
    assert.notStrictEqual(encrypted, original)
  })

  it('should produce different ciphertext for same plaintext', () => {
    const text = 'Same text'
    const enc1 = encryptForStorage(text)
    const enc2 = encryptForStorage(text)

    // Due to random IV, ciphertext should differ
    assert.notStrictEqual(enc1, enc2)
  })

  it('should handle JSON data', () => {
    const data = { key: 'value', num: 42, arr: [1, 2, 3] }
    const json = JSON.stringify(data)
    const encrypted = encryptForStorage(json)
    const decrypted = decryptFromStorage(encrypted)

    assert.deepStrictEqual(JSON.parse(decrypted), data)
  })

  it('should throw on invalid ciphertext format', () => {
    assert.throws(() => decryptFromStorage('invalid'), /Invalid storage ciphertext format/)
  })

  it('should handle unicode characters', () => {
    const unicode = 'Hello World 🌍 Welcome'
    const encrypted = encryptForStorage(unicode)
    const decrypted = decryptFromStorage(encrypted)

    assert.strictEqual(decrypted, unicode)
  })
})

describe('ErrorCode', () => {
  it('should have all expected error codes', () => {
    assert.strictEqual(ErrorCode.OK, 'OK')
    assert.strictEqual(ErrorCode.SERVICE_NOT_RUNNING, 'SERVICE_NOT_RUNNING')
    assert.strictEqual(ErrorCode.SERVICE_ALREADY_RUNNING, 'SERVICE_ALREADY_RUNNING')
    assert.strictEqual(ErrorCode.NETWORK_DISCONNECTED, 'NETWORK_DISCONNECTED')
    assert.strictEqual(ErrorCode.INVALID_ARGS, 'INVALID_ARGS')
    assert.strictEqual(ErrorCode.INVALID_PUBKEY, 'INVALID_PUBKEY')
    assert.strictEqual(ErrorCode.GROUP_NOT_FOUND, 'GROUP_NOT_FOUND')
  })
})
