#!/usr/bin/env node
/**
 * Chat Demo - Simple 1-on-1 Agent Conversation
 *
 * Demonstrates basic peer-to-peer messaging between two agents
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Import utilities
import {
  clear,
  header,
  section,
  message,
  success,
  info,
  divider,
  agentCard,
  countdown,
  sleep
} from '../utils/display.js'

// Import agent definitions
import { alice, bob } from '../agents/definitions.js'

/**
 * Simulate a simple chat between Alice and Bob
 */
async function runChatDemo() {
  clear()

  header('AgentPulse Chat Demo', 50)

  section('Overview')
  console.log(`  This demo shows a simple conversation between two AI agents:`)
  console.log(``)
  console.log(`  • ${alice.name} - The ${alice.role}`)
  console.log(`  • ${bob.name} - The ${bob.role}`)
  console.log(``)
  info('Messages are sent over the decentralized Nostr network')

  divider('═', 50)

  section('Agent Profiles')

  agentCard(alice.name, alice.role, alice.pubkey, 'blue')
  agentCard(bob.name, bob.role, bob.pubkey, 'green')

  divider('═', 50)

  section('Conversation Flow')

  info('Starting conversation simulation...')
  await countdown(3, 'Conversation starts in')

  console.log('')

  // Simulate message exchange
  const messages = [
    { from: alice, to: bob, text: 'Hello Bob! Are you ready to process some data?', delay: 500 },
    { from: bob, to: alice, text: 'Hi Alice! Yes, I\'m ready. What do you need?', delay: 1200 },
    { from: alice, to: bob, text: 'I have a dataset that needs numerical analysis.', delay: 800 },
    { from: bob, to: alice, text: 'Sounds good! Send it over and I\'ll get started.', delay: 1500 },
    { from: alice, to: bob, text: 'Great! The dataset contains 1000 records.', delay: 600 },
    { from: bob, to: alice, text: 'Perfect. I\'ll calculate the statistics.', delay: 1000 },
    { from: bob, to: alice, text: 'Done! Mean: 42.5, StdDev: 3.2', delay: 2000 },
    { from: alice, to: bob, text: 'Excellent work! Thanks Bob.', delay: 700 },
    { from: bob, to: alice, text: 'Anytime! Let me know if you need more.', delay: 900 }
  ]

  for (const msg of messages) {
    await sleep(msg.delay)
    message(msg.from.name, msg.text, '→', msg.from.color)
  }

  console.log('')
  divider('═', 50)

  section('Message Summary')

  const totalMessages = messages.length
  const aliceMessages = messages.filter(m => m.from === alice).length
  const bobMessages = messages.filter(m => m.from === bob).length

  console.log(`  Total messages exchanged: ${totalMessages}`)
  console.log(`  ${alice.name} sent: ${aliceMessages}`)
  console.log(`  ${bob.name} sent: ${bobMessages}`)

  console.log('')
  success('Demo completed successfully!')

  section('How It Works')

  console.log('  Behind the scenes, each message goes through:')
  console.log('')
  console.log('  1. Message creation with structured content')
  console.log('  2. NIP-04 encryption using recipient\'s public key')
  console.log('  3. Publishing to Nostr relay network')
  console.log('  4. Recipient subscribes and receives encrypted message')
  console.log('  5. Decryption with recipient\'s private key')
  console.log('  6. Message routing to handler function')

  console.log('')
  section('Try It Yourself')

  console.log(`  ${colors.dim}# Start the AgentPulse service${colors.reset}`)
  console.log(`  ${colors.cyan}agent-pulse start${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}# Send a message to another agent${colors.reset}`)
  console.log(`  ${colors.cyan}agent-pulse send <pubkey> "Hello from CLI!"${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}# Receive messages${colors.reset}`)
  console.log(`  ${colors.cyan}agent-pulse recv${colors.reset}`)

  divider('═', 50)
  console.log('')
}

// ANSI colors for the last section
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m'
}

// Run the demo
runChatDemo().catch(console.error)
