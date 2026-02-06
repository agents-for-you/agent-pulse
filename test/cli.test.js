/**
 * @fileoverview CLI integration tests
 * Tests command line interface input/output
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')
const CLI_PATH = path.join(PROJECT_ROOT, 'index.js')

/**
 * Run CLI command and return result
 * @param {string[]} args - Command arguments
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function runCli(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, LOG_LEVEL: 'SILENT' }
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data })
    proc.stderr.on('data', (data) => { stderr += data })

    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code })
    })
  })
}

/**
 * Parse JSON output
 */
function parseOutput(stdout) {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

describe('CLI', () => {
  describe('help command', () => {
    it('should show help with --help flag', async () => {
      const { stdout, code } = await runCli(['--help'])
      const result = parseOutput(stdout)

      assert.strictEqual(code, 0)
      assert.ok(result.commands)
      assert.ok(result.commands.start)
      assert.ok(result.commands.stop)
      assert.ok(result.commands.me)
    })

    it('should show help with help command', async () => {
      const { stdout, code } = await runCli(['help'])
      const result = parseOutput(stdout)

      assert.strictEqual(code, 0)
      assert.ok(result.commands)
    })

    it('should show help with no arguments', async () => {
      const { stdout, code } = await runCli([])
      const result = parseOutput(stdout)

      assert.strictEqual(code, 0)
      assert.ok(result.commands)
    })
  })

  describe('me command', () => {
    it('should return public key', async () => {
      const { stdout, code } = await runCli(['me'])
      const result = parseOutput(stdout)

      assert.strictEqual(code, 0)
      assert.strictEqual(result.ok, true)
      assert.ok(result.pubkey)
      assert.strictEqual(result.pubkey.length, 64) // hex encoded public key
    })

    it('should return consistent public key', async () => {
      const { stdout: stdout1 } = await runCli(['me'])
      const { stdout: stdout2 } = await runCli(['me'])

      const result1 = parseOutput(stdout1)
      const result2 = parseOutput(stdout2)

      assert.strictEqual(result1.pubkey, result2.pubkey)
    })
  })

  describe('unknown command', () => {
    it('should return error for unknown command', async () => {
      const { stdout, code } = await runCli(['nonexistent'])
      const result = parseOutput(stdout)

      assert.strictEqual(code, 0) // CLI exits 0 but returns error in JSON
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'UNKNOWN_COMMAND')
    })
  })

  describe('send command validation', () => {
    it('should reject missing arguments', async () => {
      const { stdout } = await runCli(['send'])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })

    it('should reject missing message', async () => {
      const { stdout } = await runCli(['send', 'a'.repeat(64)])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })
  })

  describe('group commands validation', () => {
    it('should reject group-create without name', async () => {
      const { stdout } = await runCli(['group-create'])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })

    it('should reject group-join without arguments', async () => {
      const { stdout } = await runCli(['group-join'])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })

    it('should reject group-leave without groupId', async () => {
      const { stdout } = await runCli(['group-leave'])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })

    it('should reject group-send without arguments', async () => {
      const { stdout } = await runCli(['group-send'])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.code, 'INVALID_ARGS')
    })
  })

  describe('status command', () => {
    it('should return status even when service not running', async () => {
      const { stdout, code } = await runCli(['status'])
      const result = parseOutput(stdout)

      assert.strictEqual(code, 0)
      assert.ok('running' in result)
      assert.strictEqual(typeof result.running, 'boolean')
    })
  })

  describe('JSON output format', () => {
    it('should always output valid JSON', async () => {
      const commands = ['me', 'status', 'help', 'recv', 'peek', 'groups']

      for (const cmd of commands) {
        const { stdout } = await runCli([cmd])
        assert.doesNotThrow(() => JSON.parse(stdout), `Command '${cmd}' should output valid JSON`)
      }
    })
  })
})

describe('CLI Error Handling', () => {
  it('should handle invalid pubkey format in send', async () => {
    // First ensure service is running or we get SERVICE_NOT_RUNNING
    const { stdout: statusOut } = await runCli(['status'])
    const status = parseOutput(statusOut)

    if (status.running) {
      const { stdout } = await runCli(['send', 'invalid-pubkey', 'message'])
      const result = parseOutput(stdout)

      assert.strictEqual(result.ok, false)
      // Error code can be numeric (new format) or string (legacy format)
      assert.ok(result.code === 'INVALID_PUBKEY' || result.code === 300 || result.codeKey === 'INVALID_PUBKEY')
    }
  })
})
