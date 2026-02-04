/**
 * @fileoverview Storage unit tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { readJson, writeJson, readJsonAsync, writeJsonAsync, exists } from '../src/core/storage.js'

describe('Storage', () => {
  let tempDir
  let testFile

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'))
    testFile = path.join(tempDir, 'test.json')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('readJson', () => {
    it('should return null for non-existent file', () => {
      const result = readJson(path.join(tempDir, 'nonexistent.json'))
      assert.strictEqual(result, null)
    })

    it('should read valid JSON file', () => {
      const data = { foo: 'bar', num: 42 }
      fs.writeFileSync(testFile, JSON.stringify(data))
      const result = readJson(testFile)
      assert.deepStrictEqual(result, data)
    })

    it('should return null for invalid JSON', () => {
      fs.writeFileSync(testFile, 'not valid json')
      const result = readJson(testFile)
      assert.strictEqual(result, null)
    })
  })

  describe('writeJson', () => {
    it('should write JSON file', () => {
      const data = { hello: 'world' }
      const success = writeJson(testFile, data)
      assert.strictEqual(success, true)

      const content = fs.readFileSync(testFile, 'utf8')
      assert.deepStrictEqual(JSON.parse(content), data)
    })

    it('should write with secure permissions', () => {
      const data = { secret: 'key' }
      writeJson(testFile, data, { secure: true })

      const stats = fs.statSync(testFile)
      // Check owner read/write only (0600)
      assert.strictEqual(stats.mode & 0o777, 0o600)
    })

    it('should create nested directories', () => {
      const nestedFile = path.join(tempDir, 'a', 'b', 'c', 'test.json')
      const data = { nested: true }
      writeJson(nestedFile, data)

      assert.ok(fs.existsSync(nestedFile))
    })
  })

  describe('readJsonAsync', () => {
    it('should return null for non-existent file', async () => {
      const result = await readJsonAsync(path.join(tempDir, 'nonexistent.json'))
      assert.strictEqual(result, null)
    })

    it('should read valid JSON file', async () => {
      const data = { async: true }
      fs.writeFileSync(testFile, JSON.stringify(data))
      const result = await readJsonAsync(testFile)
      assert.deepStrictEqual(result, data)
    })
  })

  describe('writeJsonAsync', () => {
    it('should write JSON file', async () => {
      const data = { async: 'write' }
      const success = await writeJsonAsync(testFile, data)
      assert.strictEqual(success, true)

      const content = fs.readFileSync(testFile, 'utf8')
      assert.deepStrictEqual(JSON.parse(content), data)
    })
  })

  describe('exists', () => {
    it('should return false for non-existent file', async () => {
      const result = await exists(path.join(tempDir, 'nonexistent.json'))
      assert.strictEqual(result, false)
    })

    it('should return true for existing file', async () => {
      fs.writeFileSync(testFile, '{}')
      const result = await exists(testFile)
      assert.strictEqual(result, true)
    })
  })
})
