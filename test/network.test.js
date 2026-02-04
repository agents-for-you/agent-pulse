/**
 * @fileoverview Network module unit tests
 * Tests basic functionality of NostrNetwork class
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert'
import { generateIdentity } from '../src/core/identity.js'

// Since NostrNetwork depends on actual WebSocket connections,
// we mainly test its configuration and method signatures

describe('NostrNetwork Configuration', () => {
  let identity

  beforeEach(() => {
    identity = generateIdentity()
  })

  it('should require identity in constructor', async () => {
    // Dynamic import to avoid connection
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    assert.throws(() => {
      new NostrNetwork({})
    }, /Identity is required/)
  })

  it('should accept valid configuration', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({
      identity,
      relays: ['wss://relay.test.com'],
      topic: 'test-topic'
    })

    assert.ok(network)
    assert.deepStrictEqual(network.relays, ['wss://relay.test.com'])
    assert.strictEqual(network.topic, 'test-topic')
    assert.strictEqual(network.isConnected, false)
  })

  it('should use default relays when not specified', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')
    const { DEFAULT_RELAYS } = await import('../src/config/defaults.js')

    const network = new NostrNetwork({ identity })

    assert.deepStrictEqual(network.relays, DEFAULT_RELAYS)
  })

  it('should use default topic when not specified', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')
    const { DEFAULT_TOPIC } = await import('../src/config/defaults.js')

    const network = new NostrNetwork({ identity })

    assert.strictEqual(network.topic, DEFAULT_TOPIC)
  })

  it('should initialize with disconnected state', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })

    assert.strictEqual(network.isConnected, false)
    assert.strictEqual(network.isActive(), false)
  })

  it('should initialize empty peers list', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })

    const peers = network.getPeers()
    assert.ok(Array.isArray(peers))
    assert.strictEqual(peers.length, 0)
  })
})

describe('NostrNetwork Methods', () => {
  let identity

  beforeEach(() => {
    identity = generateIdentity()
  })

  it('should have required methods', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })

    assert.strictEqual(typeof network.connect, 'function')
    assert.strictEqual(typeof network.close, 'function')
    assert.strictEqual(typeof network.publish, 'function')
    assert.strictEqual(typeof network.broadcast, 'function')
    assert.strictEqual(typeof network.sendTask, 'function')
    assert.strictEqual(typeof network.sendResult, 'function')
    assert.strictEqual(typeof network.getPeers, 'function')
    assert.strictEqual(typeof network.isActive, 'function')
    assert.strictEqual(typeof network.announce, 'function')
    assert.strictEqual(typeof network.subscribeToTopic, 'function')
    assert.strictEqual(typeof network.broadcastToTopic, 'function')
  })

  it('should throw when publishing without connection', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })

    await assert.rejects(
      () => network.publish({ type: 'test' }),
      /Not connected to network/
    )
  })

  it('should throw when sending task with invalid target', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })
    network.isConnected = true // Mock connected state

    await assert.rejects(
      () => network.sendTask(null, { task: 'test' }),
      /Invalid target public key/
    )

    await assert.rejects(
      () => network.sendTask('', { task: 'test' }),
      /Invalid target public key/
    )
  })

  it('should throw when sending result with invalid target', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })
    network.isConnected = true

    await assert.rejects(
      () => network.sendResult(null, { result: 'test' }),
      /Invalid target public key/
    )
  })

  it('should close gracefully even when not connected', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({ identity })

    // Should not throw
    assert.doesNotThrow(() => network.close())
  })
})

describe('NostrNetwork LRU Cache Integration', () => {
  let identity

  beforeEach(() => {
    identity = generateIdentity()
  })

  it('should use shared LRUCache implementation', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')
    const { LRUCache } = await import('../src/service/shared.js')

    const network = new NostrNetwork({ identity })

    // knownPeers should be an LRUCache instance
    assert.ok(network.knownPeers instanceof LRUCache)
  })

  it('should respect maxPeers configuration', async () => {
    const { NostrNetwork } = await import('../src/network/nostr-network.js')

    const network = new NostrNetwork({
      identity,
      maxPeers: 50
    })

    assert.strictEqual(network.knownPeers.maxSize, 50)
  })
})
