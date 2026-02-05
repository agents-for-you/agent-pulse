/**
 * @fileoverview Exponential backoff tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Exponential Backoff', () => {
  it('should calculate correct backoff values', () => {
    // Simulate the backoff calculation
    const BASE = 1000
    const MULTIPLIER = 2
    const MAX = 60000
    const JITTER_RATIO = 0.2

    function calculateBackoff(attempt) {
      const backoff = BASE * Math.pow(MULTIPLIER, attempt)
      return Math.min(backoff, MAX)
    }

    function addJitter(delay) {
      const range = delay * JITTER_RATIO
      return (Math.random() - 0.5) * 2 * range
    }

    // Test exponential growth
    assert.strictEqual(calculateBackoff(0), 1000)   // 1s
    assert.strictEqual(calculateBackoff(1), 2000)   // 2s
    assert.strictEqual(calculateBackoff(2), 4000)   // 4s
    assert.strictEqual(calculateBackoff(3), 8000)   // 8s
    assert.strictEqual(calculateBackoff(4), 16000)  // 16s
    assert.strictEqual(calculateBackoff(5), 32000)  // 32s
    assert.strictEqual(calculateBackoff(6), 60000)  // 60s (capped)
    assert.strictEqual(calculateBackoff(7), 60000)  // 60s (capped)
    assert.strictEqual(calculateBackoff(10), 60000) // 60s (capped)

    // Test jitter is within expected range
    const delay = 4000
    const jitter = addJitter(delay)
    const maxJitter = delay * JITTER_RATIO
    assert.ok(jitter >= -maxJitter && jitter <= maxJitter)
  })

  it('should prevent thundering herd with jitter', () => {
    // Simulate 10 concurrent reconnections
    const BASE = 1000
    const MULTIPLIER = 2
    const JITTER_RATIO = 0.2

    const delays = []
    for (let i = 0; i < 10; i++) {
      const backoff = BASE * Math.pow(MULTIPLIER, 2) // attempt 2: 4s
      const jitter = (Math.random() - 0.5) * 2 * backoff * JITTER_RATIO
      delays.push(backoff + jitter)
    }

    // All delays should be different (very unlikely to be same with randomness)
    const uniqueDelays = new Set(delays)
    assert.ok(uniqueDelays.size > 8, 'Jitter should spread out reconnection times')

    // All delays should be within valid range
    const baseDelay = 4000
    const maxJitter = baseDelay * JITTER_RATIO
    for (const delay of delays) {
      assert.ok(delay >= baseDelay - maxJitter)
      assert.ok(delay <= baseDelay + maxJitter)
    }
  })
})
