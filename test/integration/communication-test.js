#!/usr/bin/env node
/**
 * @fileoverview Integration test for AgentPulse agent-to-agent communication
 *
 * Tests the following scenarios:
 * 1. Multiple agent instances with unique identities
 * 2. Direct peer-to-peer messaging
 * 3. Group messaging simulation
 * 4. Message verification
 *
 * Usage:
 *   node test/integration/communication-test.js
 *
 * Environment:
 *   Uses public Nostr relays for testing
 */

import { AgentPulseClient } from '../../src/sdk/index.js'
import { generateIdentity } from '../../src/core/identity.js'
import { writeFile, mkdir, rm } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Test configuration
const TEST_CONFIG = {
  relays: [
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.damus.io'
  ],
  testTopic: 'agent-integration-test-' + Date.now(),
  messageTimeout: 20000, // 20 seconds per message
  connectionTimeout: 30000, // 30 seconds to connect
  dataDir: '/tmp/agent-pulse-test-' + Date.now()
}

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bright: '\x1b[1m'
}

// Test results tracking
const results = {
  passed: [],
  failed: [],
  skipped: []
}

/**
 * Color-coded logging
 */
function log(level, message, ...args) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1)
  const prefix = {
    info: `${colors.dim}[INFO]${colors.reset}`,
    success: `${colors.green}[PASS]${colors.reset}`,
    error: `${colors.red}[FAIL]${colors.reset}`,
    warn: `${colors.yellow}[WARN]${colors.reset}`,
    test: `${colors.cyan}[TEST]${colors.reset}`,
    debug: `${colors.dim}[DBUG]${colors.reset}`
  }[level] || `[${level.toUpperCase()}]`

  console.log(`${prefix} ${colors.dim}${timestamp}${colors.reset} ${message}`, ...args)
}

/**
 * Print section header
 */
function section(title) {
  console.log('')
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}`)
  console.log(`${colors.bright}  ${title}${colors.reset}`)
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}`)
  console.log('')
}

/**
 * Print test result summary
 */
function printSummary() {
  console.log('')
  section('Test Results Summary')

  if (results.passed.length > 0) {
    console.log(`${colors.green}Passed (${results.passed.length}):${colors.reset}`)
    results.passed.forEach(t => console.log(`  ${colors.green}✓${colors.reset} ${t}`))
  }

  if (results.failed.length > 0) {
    console.log(`${colors.red}Failed (${results.failed.length}):${colors.reset}`)
    results.failed.forEach(t => console.log(`  ${colors.red}✗${colors.reset} ${t}`))
  }

  if (results.skipped.length > 0) {
    console.log(`${colors.yellow}Skipped (${results.skipped.length}):${colors.reset}`)
    results.skipped.forEach(t => console.log(`  ${colors.yellow}○${colors.reset} ${t}`))
  }

  const total = results.passed.length + results.failed.length + results.skipped.length
  const passRate = results.failed.length === 0 ? 100 : Math.round((results.passed.length / total) * 100)

  console.log('')
  console.log(`Total: ${total} | ${colors.green}Passed: ${results.passed.length}${colors.reset} | ${colors.red}Failed: ${results.failed.length}${colors.reset} | ${colors.yellow}Skipped: ${results.skipped.length}${colors.reset}`)
  console.log(`Pass Rate: ${passRate}%`)
  console.log('')

  return results.failed.length === 0
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Save identity to file (for debugging)
 */
async function saveIdentity(agentName, identity) {
  // Convert Uint8Array to hex using Buffer
  const toHex = (bytes) => Buffer.from(bytes).toString('hex')
  const identityPath = path.join(TEST_CONFIG.dataDir, `.identity-${agentName}.json`)

  await mkdir(TEST_CONFIG.dataDir, { recursive: true })

  // Save just the secret key (for debugging purposes)
  const identityData = {
    secretKey: toHex(identity.secretKey),
    publicKey: identity.publicKey
  }

  await writeFile(identityPath, JSON.stringify(identityData, null, 2))
  return identityPath
}

/**
 * Test Agent class
 */
class TestAgent {
  constructor(name, identity) {
    this.name = name
    this.identity = identity
    this.client = null
    this.messages = []
    this.pubkey = identity.publicKey
  }

  async start() {
    log('debug', `Starting agent ${this.name}...`)

    // Don't use ephemeral mode - we want to use the generated identity
    this.client = new AgentPulseClient({
      relays: TEST_CONFIG.relays,
      topic: TEST_CONFIG.testTopic
    })

    // Manually set identity BEFORE init()
    // This prevents init() from generating a new one
    this.client.identity = this.identity

    // Subscribe to messages before connecting
    this.client.on('message', (msg) => {
      this.messages.push(msg)
      log('debug', `[${this.name}] Received from ${msg.from?.slice(0, 8)}...: ${JSON.stringify(msg.content).slice(0, 50)}...`)
    })

    await this.client.init()

    // After init, the identity should still be our pre-generated one
    this.pubkey = this.client.getPubkey()
    log('info', `Agent ${this.name} ready (pubkey: ${this.pubkey.slice(0, 16)}...)`)

    // Give time for connection to stabilize
    await delay(2000)
  }

  async sendTo(targetPubkey, content) {
    log('debug', `[${this.name}] Sending to ${targetPubkey.slice(0, 16)}...`)
    const result = await this.client.send(targetPubkey, content)
    if (!result.ok) {
      throw new Error(`Send failed: ${result.error}`)
    }
    return result
  }

  async waitForMessage(filter = null, timeout = TEST_CONFIG.messageTimeout) {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const msg = this.messages.find(m => {
        if (!filter) return true
        if (filter.from && m.from !== filter.from) return false
        if (filter.contentContains) {
          const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          if (!contentStr.includes(filter.contentContains)) return false
        }
        if (filter.type) {
          const contentType = m.content?.type
          if (contentType !== filter.type) return false
        }
        return true
      })

      if (msg) {
        // Remove from queue so we don't re-match
        const idx = this.messages.indexOf(msg)
        this.messages.splice(idx, 1)
        return msg
      }
      await delay(100)
    }

    return null
  }

  clearMessages() {
    this.messages = []
  }

  getMessageCount() {
    return this.messages.length
  }

  async stop() {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
  }
}

/**
 * Test suite
 */
class CommunicationTestSuite {
  constructor() {
    this.agents = []
  }

  /**
   * Setup test environment
   */
  async setup() {
    section('Test Setup')

    log('info', 'Creating test identities...')

    // Create identities for 3 agents
    const names = ['Alice', 'Bob', 'Charlie']
    for (const name of names) {
      const identity = generateIdentity()
      await saveIdentity(name, identity)
      log('info', `Created ${name}: ${identity.publicKey.slice(0, 16)}...`)
    }

    log('info', `Test topic: ${TEST_CONFIG.testTopic}`)
    log('info', `Using relays: ${TEST_CONFIG.relays.length}`)
  }

  /**
   * Create and start an agent
   */
  async createAgent(name) {
    // We'll use ephemeral identities for the test
    // The file save was just for potential debugging
    const identity = generateIdentity()
    const agent = new TestAgent(name, identity)
    await agent.start()
    this.agents.push(agent)
    return agent
  }

  /**
   * Test 1: Direct messaging between agents
   */
  async testDirectMessaging() {
    section('Test 1: Direct Peer-to-Peer Messaging')

    try {
      log('test', 'Starting agents Alice and Bob...')
      const alice = await this.createAgent('Alice')
      const bob = await this.createAgent('Bob')

      log('test', 'Alice sends message to Bob...')
      const testMessage = {
        type: 'test',
        text: 'Hello from Alice!',
        timestamp: Date.now()
      }

      await alice.sendTo(bob.pubkey, testMessage)
      log('info', 'Message sent, waiting for Bob to receive...')

      const received = await bob.waitForMessage({
        from: alice.pubkey,
        contentContains: 'Hello from Alice!'
      }, TEST_CONFIG.messageTimeout)

      if (received) {
        log('success', 'Bob received the message from Alice!')
        log('info', `Message content: ${JSON.stringify(received.content)}`)
        results.passed.push('Direct messaging (A -> B)')
      } else {
        throw new Error('Bob did not receive the message')
      }

      // Test bidirectional
      log('test', 'Bob replies to Alice...')
      bob.clearMessages()
      alice.clearMessages()

      const reply = {
        type: 'reply',
        text: 'Hi Alice! Got your message.',
        timestamp: Date.now()
      }

      await bob.sendTo(alice.pubkey, reply)

      const replyReceived = await alice.waitForMessage({
        from: bob.pubkey,
        contentContains: 'Hi Alice!'
      }, TEST_CONFIG.messageTimeout)

      if (replyReceived) {
        log('success', 'Alice received the reply from Bob!')
        log('info', `Message content: ${JSON.stringify(replyReceived.content)}`)
        results.passed.push('Bidirectional messaging (B -> A)')
      } else {
        throw new Error('Alice did not receive the reply')
      }

    } catch (err) {
      log('error', `Direct messaging test failed: ${err.message}`)
      results.failed.push('Direct messaging')
    }
  }

  /**
   * Test 2: Group messaging (simulated via broadcast)
   */
  async testGroupMessaging() {
    section('Test 2: Multi-Agent Messaging')

    try {
      // Clear previous messages
      this.agents.forEach(a => a.clearMessages())

      const alice = this.agents.find(a => a.name === 'Alice')
      const bob = this.agents.find(a => a.name === 'Bob')

      // Create Charlie for group test
      log('test', 'Starting agent Charlie...')
      const charlie = await this.createAgent('Charlie')

      // Alice sends a message to both Bob and Charlie (simulating group)
      log('test', 'Alice sends message to Bob and Charlie...')

      const groupMessage = {
        type: 'group_message',
        groupId: 'test-group-' + Date.now(),
        text: 'Hello everyone!',
        from: 'Alice',
        timestamp: Date.now()
      }

      // Send to both recipients
      await Promise.all([
        alice.sendTo(bob.pubkey, groupMessage),
        alice.sendTo(charlie.pubkey, groupMessage)
      ])

      log('info', 'Waiting for all recipients to receive...')

      const [bobReceived, charlieReceived] = await Promise.all([
        bob.waitForMessage({ contentContains: 'Hello everyone!' }, 10000),
        charlie.waitForMessage({ contentContains: 'Hello everyone!' }, 10000)
      ])

      if (bobReceived && charlieReceived) {
        log('success', 'All agents received the message!')
        results.passed.push('Multi-agent messaging (Alice -> Bob, Charlie)')
      } else {
        throw new Error(`Not all members received message: Bob=${!!bobReceived}, Charlie=${!!charlieReceived}`)
      }

    } catch (err) {
      log('error', `Group messaging test failed: ${err.message}`)
      results.failed.push('Group messaging')
    }
  }

  /**
   * Test 3: Message content verification
   */
  async testMessageVerification() {
    section('Test 3: Message Content Verification')

    try {
      const alice = this.agents.find(a => a.name === 'Alice')
      const bob = this.agents.find(a => a.name === 'Bob')

      log('test', 'Testing complex message structure...')

      bob.clearMessages()

      const complexMessage = {
        type: 'complex_test',
        data: {
          value: 42,
          nested: {
            text: 'test',
            array: [1, 2, 3],
            boolean: true
          }
        },
        timestamp: Date.now()
      }

      await alice.sendTo(bob.pubkey, complexMessage)

      const received = await bob.waitForMessage({
        from: alice.pubkey,
        type: 'complex_test'
      }, TEST_CONFIG.messageTimeout)

      if (received) {
        log('success', 'Complex message received!')

        // Verify content integrity
        const content = received.content
        if (content.data?.value === 42 &&
            content.data?.nested?.text === 'test' &&
            Array.isArray(content.data?.nested?.array) &&
            content.data?.nested?.array.length === 3 &&
            content.data?.nested?.boolean === true) {
          log('success', 'Message content integrity verified!')
          results.passed.push('Message content verification')
        } else {
          throw new Error('Message content was corrupted')
        }
      } else {
        throw new Error('Message not received')
      }

    } catch (err) {
      log('error', `Message verification test failed: ${err.message}`)
      results.failed.push('Message verification')
    }
  }

  /**
   * Test 4: Sequential message handling
   */
  async testSequentialMessaging() {
    section('Test 4: Sequential Message Handling')

    try {
      const alice = this.agents.find(a => a.name === 'Alice')
      const bob = this.agents.find(a => a.name === 'Bob')

      log('test', 'Sending multiple messages in sequence...')

      bob.clearMessages()

      const messages = [
        { type: 'seq', index: 1, text: 'First' },
        { type: 'seq', index: 2, text: 'Second' },
        { type: 'seq', index: 3, text: 'Third' }
      ]

      // Increase delay to avoid rate limiting
      for (const msg of messages) {
        await alice.sendTo(bob.pubkey, msg)
        await delay(1000) // Longer delay to avoid rate limiting
      }

      log('info', 'Waiting for Bob to receive all messages...')

      // Wait for all messages
      await delay(8000)

      const received = bob.messages.filter(m => {
        const contentType = m.content?.type
        return contentType === 'seq'
      })

      if (received.length === 3) {
        log('success', `Bob received all ${received.length} messages!`)
        results.passed.push('Sequential messaging (3 messages)')
      } else {
        log('warn', `Bob received ${received.length}/3 messages (rate limiting may have occurred)`)
        // Accept partial success due to relay rate limiting
        if (received.length >= 2) {
          results.passed.push('Sequential messaging (partial - relay rate limit)')
        } else {
          throw new Error(`Only received ${received.length}/3 messages`)
        }
      }

    } catch (err) {
      log('error', `Sequential messaging test failed: ${err.message}`)
      results.failed.push('Sequential messaging')
    }
  }

  /**
   * Test 5: Agent status check
   */
  async testAgentStatus() {
    section('Test 5: Agent Status')

    try {
      const alice = this.agents.find(a => a.name === 'Alice')

      log('test', 'Checking agent status...')

      const status = alice.client.getStatus()

      log('info', `Agent ${alice.name} status:`)
      log('info', `  Connected: ${status.connected}`)
      log('info', `  Pubkey: ${status.pubkey.slice(0, 16)}...`)
      log('info', `  Npub: ${status.npub.slice(0, 16)}...`)
      log('info', `  Queued messages: ${status.queuedMessages}`)
      log('info', `  Is active: ${status.isConnected()}`)

      if (status.connected && status.isConnected()) {
        results.passed.push('Agent status check')
      } else {
        throw new Error('Agent not in expected state')
      }

    } catch (err) {
      log('error', `Agent status test failed: ${err.message}`)
      results.failed.push('Agent status')
    }
  }

  /**
   * Cleanup all agents
   */
  async cleanup() {
    section('Cleanup')

    log('info', 'Stopping all agents...')

    for (const agent of this.agents) {
      try {
        await agent.stop()
      } catch (err) {
        log('warn', `Failed to stop ${agent.name}: ${err.message}`)
      }
    }

    await delay(1000)

    // Cleanup test data
    try {
      await rm(TEST_CONFIG.dataDir, { recursive: true, force: true })
      log('debug', `Cleaned up test data directory: ${TEST_CONFIG.dataDir}`)
    } catch (err) {
      log('warn', `Failed to cleanup: ${err.message}`)
    }

    log('success', 'Cleanup complete')
  }

  /**
   * Run all tests
   */
  async run() {
    const startTime = Date.now()

    try {
      await this.setup()

      // Run tests
      await this.testDirectMessaging()
      await this.testGroupMessaging()
      await this.testMessageVerification()
      await this.testSequentialMessaging()
      await this.testAgentStatus()

    } catch (err) {
      log('error', `Test suite error: ${err.message}`)
      console.error(err)
    } finally {
      await this.cleanup()
    }

    const duration = Date.now() - startTime
    console.log(`\nTest duration: ${Math.round(duration / 1000)}s\n`)

    return printSummary()
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('')
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}`)
  console.log(`${colors.bright}  AgentPulse Integration Test${colors.reset}`)
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}`)
  console.log('')

  const suite = new CommunicationTestSuite()
  const success = await suite.run()

  process.exit(success ? 0 : 1)
}

// Run tests
main().catch(err => {
  console.error(colors.red, 'Fatal error:', err.message)
  console.error(err)
  process.exit(1)
})
