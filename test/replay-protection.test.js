/**
 * @fileoverview Replay protection module tests
 * Tests nonce tracking and replay attack prevention
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { ReplayProtection, getReplayProtection, resetReplayProtection } from '../src/utils/replay-protection.js'

describe('ReplayProtection', () => {
  let rp

  beforeEach(() => {
    rp = new ReplayProtection()
    resetReplayProtection()
  })

  describe('checkNonce', () => {
    it('should allow first-time nonce', () => {
      const nonce = 'abc123'
      const timestamp = Date.now()
      const result = rp.checkNonce(nonce, timestamp)
      assert.strictEqual(result.allowed, true)
    })

    it('should reject duplicate nonce', () => {
      const nonce = 'abc123'
      const timestamp = Date.now()
      rp.checkNonce(nonce, timestamp)
      const result = rp.checkNonce(nonce, timestamp)
      assert.strictEqual(result.allowed, false)
      assert.strictEqual(result.reason, 'Nonce already seen (replay attack)')
    })

    it('should reject timestamps outside tolerance', () => {
      const nonce = 'xyz789'
      const oldTimestamp = Date.now() - 120000 // 2 minutes ago
      const result = rp.checkNonce(nonce, oldTimestamp)
      assert.strictEqual(result.allowed, false)
      assert.ok(result.reason.includes('outside tolerance'))
    })

    it('should reject future timestamps outside tolerance', () => {
      const nonce = 'future123'
      const futureTimestamp = Date.now() + 120000 // 2 minutes in future
      const result = rp.checkNonce(nonce, futureTimestamp)
      assert.strictEqual(result.allowed, false)
      assert.ok(result.reason.includes('outside tolerance'))
    })

    it('should allow timestamps within tolerance', () => {
      const nonce = 'recent123'
      const recentTimestamp = Date.now() - 30000 // 30 seconds ago
      const result = rp.checkNonce(nonce, recentTimestamp)
      assert.strictEqual(result.allowed, true)
    })

    it('should reject invalid nonce format', () => {
      const result = rp.checkNonce(null, Date.now())
      assert.strictEqual(result.allowed, false)
      assert.strictEqual(result.reason, 'Invalid nonce format')
    })

    it('should handle empty nonce string', () => {
      const result = rp.checkNonce('', Date.now())
      assert.strictEqual(result.allowed, false)
      assert.strictEqual(result.reason, 'Invalid nonce format')
    })
  })

  describe('generateNonce', () => {
    it('should generate unique nonces', () => {
      const nonce1 = ReplayProtection.generateNonce()
      const nonce2 = ReplayProtection.generateNonce()
      assert.ok(nonce1 !== nonce2)
      assert.strictEqual(nonce1.length, 32) // 16 bytes = 32 hex chars
    })

    it('should generate different size nonces', () => {
      const nonce8 = ReplayProtection.generateNonce(8)
      const nonce32 = ReplayProtection.generateNonce(32)
      assert.strictEqual(nonce8.length, 16) // 8 bytes = 16 hex chars
      assert.strictEqual(nonce32.length, 64) // 32 bytes = 64 hex chars
    })
  })

  describe('createMessageNonce', () => {
    it('should create consistent nonce for same input', () => {
      const content = 'hello world'
      const sender = 'abc123'
      const timestamp = 1234567890
      const nonce1 = ReplayProtection.createMessageNonce(content, sender, timestamp)
      const nonce2 = ReplayProtection.createMessageNonce(content, sender, timestamp)
      assert.strictEqual(nonce1, nonce2)
    })

    it('should create different nonces for different inputs', () => {
      const sender = 'abc123'
      const timestamp = 1234567890
      const nonce1 = ReplayProtection.createMessageNonce('hello', sender, timestamp)
      const nonce2 = ReplayProtection.createMessageNonce('world', sender, timestamp)
      assert.ok(nonce1 !== nonce2)
    })

    it('should create different nonces for different senders', () => {
      const content = 'hello'
      const timestamp = 1234567890
      const nonce1 = ReplayProtection.createMessageNonce(content, 'sender1', timestamp)
      const nonce2 = ReplayProtection.createMessageNonce(content, 'sender2', timestamp)
      assert.ok(nonce1 !== nonce2)
    })
  })

  describe('getStats', () => {
    it('should return statistics', () => {
      rp.checkNonce('test1', Date.now())
      rp.checkNonce('test2', Date.now())
      rp.checkNonce('test1', Date.now()) // Replay

      const stats = rp.getStats()
      assert.strictEqual(stats.totalSeen, 2)
      assert.strictEqual(stats.replaysDetected, 1)
      assert.ok(stats.cacheSize > 0)
    })
  })

  describe('clear', () => {
    it('should clear all nonces', () => {
      rp.checkNonce('test1', Date.now())
      assert.strictEqual(rp.getStats().cacheSize, 1)

      rp.clear()
      assert.strictEqual(rp.getStats().cacheSize, 0)
    })
  })

  describe('singleton', () => {
    it('should return same instance', () => {
      const rp1 = getReplayProtection()
      const rp2 = getReplayProtection()
      assert.strictEqual(rp1, rp2)
    })

    it('should return new instance after reset', () => {
      const rp1 = getReplayProtection()
      resetReplayProtection()
      const rp2 = getReplayProtection()
      assert.notStrictEqual(rp1, rp2)
    })
  })
})
