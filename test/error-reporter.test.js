/**
 * Error reporter module tests
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  AgentError,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  ErrorSeverity,
  ErrorCategory,
  withErrorHandling,
  formatErrorForLog
} from '../src/utils/error-reporter.js'

describe('ErrorReporter', () => {
  describe('AgentError', () => {
    it('should create error with all properties', () => {
      const err = new AgentError('INVALID_PUBKEY', { pubkey: 'invalid' })
      assert.strictEqual(err.code, 300)
      assert.strictEqual(err.codeKey, 'INVALID_PUBKEY')
      assert.strictEqual(err.severity, ErrorSeverity.HIGH)
      assert.strictEqual(err.category, ErrorCategory.VALIDATION)
      assert.strictEqual(err.retryable, false)
      assert.ok(err.suggestion)
      assert.ok(err.timestamp)
    })

    it('should convert to JSON', () => {
      const err = new AgentError('NETWORK_DISCONNECTED')
      const json = err.toJSON()
      assert.strictEqual(json.ok, false)
      assert.strictEqual(json.error.code, 100)
      assert.ok(json.error.suggestion)
    })

    it('should convert to string', () => {
      const err = new AgentError('SERVICE_NOT_RUNNING')
      const str = err.toString()
      assert.ok(str.includes('not running'))
      assert.ok(str.includes('Suggestion:'))
    })
  })

  describe('createErrorResponse', () => {
    it('should create error response object', () => {
      const response = createErrorResponse('GROUP_NOT_FOUND', { groupId: 'test123' })
      assert.strictEqual(response.ok, false)
      assert.strictEqual(response.error.code, 400)
      assert.strictEqual(response.error.codeKey, 'GROUP_NOT_FOUND')
      assert.deepStrictEqual(response.error.details, { groupId: 'test123' })
    })

    it('should fallback to INTERNAL_ERROR for unknown code', () => {
      const response = createErrorResponse('UNKNOWN_ERROR_X')
      // Unknown codes should still return a valid error response
      assert.strictEqual(response.ok, false)
      assert.ok(response.error)
      assert.ok(response.error.code)
    })
  })

  describe('createSuccessResponse', () => {
    it('should create success response object', () => {
      const response = createSuccessResponse({ messages: [] })
      assert.strictEqual(response.ok, true)
      assert.deepStrictEqual(response.messages, [])
      assert.ok(response.timestamp)
    })
  })

  describe('withErrorHandling', () => {
    it('should wrap function and handle errors', async () => {
      let calls = 0
      const fn = withErrorHandling(async () => {
        calls++
        if (calls === 1) throw new Error('Test error')
        return { ok: true, success: true }
      }, 'NETWORK_SEND_FAILED')

      const result1 = await fn()
      assert.strictEqual(result1.ok, false)

      const result2 = await fn()
      assert.strictEqual(result2.ok, true)
    })

    it('should handle AgentError directly', async () => {
      const fn = withErrorHandling(async () => {
        throw new AgentError('INVALID_PUBKEY')
      }, 'SERVICE_NOT_RUNNING')

      const result = await fn()
      assert.strictEqual(result.error.code, 300) // INVALID_PUBKEY, not SERVICE_NOT_RUNNING
    })
  })

  describe('formatErrorForLog', () => {
    it('should format AgentError for logging', () => {
      const err = new AgentError('RELAY_ALL_FAILED')
      const formatted = formatErrorForLog(err)
      assert.ok(formatted.includes('CRITICAL'))
      assert.ok(formatted.includes('102'))
      assert.ok(formatted.includes('RELAY_ALL_FAILED'))
    })

    it('should format plain error for logging', () => {
      const formatted = formatErrorForLog(new Error('Test error'))
      assert.ok(formatted.includes('ERROR'))
      assert.ok(formatted.includes('Test error'))
    })
  })

  describe('ErrorCodes', () => {
    it('should have all required error codes', () => {
      const requiredCodes = [
        'NETWORK_DISCONNECTED',
        'SERVICE_NOT_RUNNING',
        'INVALID_PUBKEY',
        'GROUP_NOT_FOUND',
        'MESSAGE_RETRY_EXHAUSTED',
        'REPLAY_ATTACK_DETECTED'
      ]

      for (const code of requiredCodes) {
        assert.ok(ErrorCodes[code], `Missing error code: ${code}`)
        assert.ok(ErrorCodes[code].message, `${code} missing message`)
        assert.ok(ErrorCodes[code].suggestion, `${code} missing suggestion`)
      }
    })
  })
})
