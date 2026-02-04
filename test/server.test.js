/**
 * @fileoverview Server module unit tests
 * Tests service management functionality
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')
const DATA_DIR = path.join(PROJECT_ROOT, '.data')

// Dynamic import to avoid side effects
async function importServer() {
  return await import('../src/service/server.js')
}

describe('Server Module', () => {
  describe('isRunning', () => {
    it('should return false when no PID file exists', async () => {
      const { isRunning } = await importServer()

      // Ensure no PID file
      const pidFile = path.join(DATA_DIR, 'server.pid')
      if (fs.existsSync(pidFile)) {
        // If real service is running, skip test
        const result = isRunning()
        assert.ok(typeof result === 'number' || result === false)
      } else {
        const result = isRunning()
        assert.strictEqual(result, false)
      }
    })
  })

  describe('getStatus', () => {
    it('should return status object', async () => {
      const { getStatus } = await importServer()

      const status = getStatus()

      assert.ok('running' in status)
      assert.ok('pid' in status)
      assert.ok('pendingMessages' in status)
      assert.strictEqual(typeof status.running, 'boolean')
    })
  })

  describe('readMessages', () => {
    it('should return array', async () => {
      const { readMessages } = await importServer()

      const messages = readMessages(false)

      assert.ok(Array.isArray(messages))
    })
  })

  describe('sendMessage validation', () => {
    it('should reject invalid pubkey - too short', async () => {
      const { sendMessage, isRunning } = await importServer()

      // Only test pubkey validation when service is running
      if (isRunning()) {
        const result = await sendMessage('abc', 'hello', { autoStart: false })
        assert.strictEqual(result.ok, false)
        assert.strictEqual(result.code, 'INVALID_PUBKEY')
      }
    })

    it('should reject invalid pubkey - non-hex', async () => {
      const { sendMessage, isRunning } = await importServer()

      if (isRunning()) {
        const result = await sendMessage('g'.repeat(64), 'hello', { autoStart: false })
        assert.strictEqual(result.ok, false)
        assert.strictEqual(result.code, 'INVALID_PUBKEY')
      }
    })

    it('should reject when service not running', async () => {
      const { sendMessage, isRunning } = await importServer()

      if (!isRunning()) {
        const validPubkey = 'a'.repeat(64)
        const result = await sendMessage(validPubkey, 'hello', { autoStart: false })
        assert.strictEqual(result.ok, false)
        assert.strictEqual(result.code, 'SERVICE_NOT_RUNNING')
      }
    })
  })

  describe('getSendResult', () => {
    it('should return null for non-existent cmdId', async () => {
      const { getSendResult } = await importServer()

      const result = getSendResult('nonexistent-cmd-id')
      assert.strictEqual(result, null)
    })
  })

  describe('readResults', () => {
    it('should return array', async () => {
      const { readResults } = await importServer()

      const results = readResults(false)
      assert.ok(Array.isArray(results))
    })
  })
})

describe('Group Operations', () => {
  describe('listGroups', () => {
    it('should return groups object', async () => {
      const { listGroups } = await importServer()

      const result = listGroups()

      assert.strictEqual(result.ok, true)
      assert.ok('groups' in result)
      assert.strictEqual(typeof result.groups, 'object')
    })
  })

  describe('createGroup validation', () => {
    it('should reject empty name', async () => {
      const { createGroup } = await importServer()

      const result = createGroup('')
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })

    it('should reject short name', async () => {
      const { createGroup } = await importServer()

      const result = createGroup('a')
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })
  })

  describe('joinGroup validation', () => {
    it('should reject missing groupId', async () => {
      const { joinGroup } = await importServer()

      const result = joinGroup('', 'topic')
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })

    it('should reject missing topic', async () => {
      const { joinGroup } = await importServer()

      const result = joinGroup('groupId', '')
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })
  })

  describe('leaveGroup', () => {
    it('should return error for non-existent group', async () => {
      const { leaveGroup } = await importServer()

      const result = leaveGroup('nonexistent-group-id')
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'GROUP_NOT_FOUND')
    })
  })

  describe('sendGroupMessage', () => {
    it('should reject when service not running', async () => {
      const { sendGroupMessage, isRunning } = await importServer()

      if (!isRunning()) {
        const result = sendGroupMessage('groupId', 'message')
        assert.strictEqual(result.ok, false)
        assert.strictEqual(result.code, 'SERVICE_NOT_RUNNING')
      }
    })

    it('should reject non-existent group', async () => {
      const { sendGroupMessage, isRunning } = await importServer()

      if (isRunning()) {
        const result = sendGroupMessage('nonexistent-group', 'message')
        assert.strictEqual(result.ok, false)
        assert.strictEqual(result.code, 'GROUP_NOT_FOUND')
      }
    })
  })
})
