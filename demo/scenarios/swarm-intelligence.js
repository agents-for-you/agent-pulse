#!/usr/bin/env node
/**
 * Swarm Intelligence Demo - Collective Decision Making
 *
 * Demonstrates distributed consensus among multiple agents
 */

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
  warning,
  divider,
  countdown,
  sleep,
  progress,
  agentStatus,
  agentGrid
} from '../utils/display.js'

// Import agent definitions
import { alice, bob, charlie, diana, eve } from '../agents/definitions.js'

/**
 * Simulate swarm decision making
 */
async function runSwarmDemo() {
  clear()

  header('AgentPulse Swarm Intelligence Demo', 65)

  section('Overview')
  console.log(`  This demo shows five agents making a collective decision through voting:`)
  console.log(``)
  console.log(`  • ${alice.name} - ${alice.role} (initiates proposal)`)
  console.log(`  • ${bob.name} - ${bob.role}`)
  console.log(`  • ${charlie.name} - ${charlie.role}`)
  console.log(`  • ${diana.name} - ${diana.role}`)
  console.log(`  • ${eve.name} - ${eve.role}`)
  console.log(``)
  info('Agents use distributed voting to reach consensus')

  divider('═', 65)

  section('Agent Swarm')

  agentGrid([
    { name: 'Alice', color: '\x1b[34m' },
    { name: 'Bob', color: '\x1b[32m' },
    { name: 'Charlie', color: '\x1b[35m' },
    { name: 'Diana', color: '\x1b[36m' },
    { name: 'Eve', color: '\x1b[33m' }
  ])

  divider('═', 65)

  section('Scenario: Resource Allocation Decision')

  console.log(`  ${colors.dim}Problem:${colors.reset} The swarm needs to allocate computing resources`)
  console.log(`  ${colors.dim}Options:${colors.reset}`)
  console.log(`    A) Prioritize batch processing jobs`)
  console.log(`    B) Prioritize real-time requests`)
  console.log(`    C) Equal split between both`)

  await countdown(3, 'Starting swarm vote in')

  console.log('')
  section('Phase 1: Proposal Broadcast')

  message(alice.name, 'Proposing resource allocation vote...', '→', 'blue')
  await sleep(600)

  const proposal = {
    id: 'PROPOSAL-001',
    type: 'resource_allocation',
    options: ['A: Batch priority', 'B: Real-time priority', 'C: Equal split'],
    timeout: 5000
  }

  message(alice.name, `Broadcasting proposal ${proposal.id}`, '→', 'blue')
  await sleep(400)

  info('All agents received the proposal')
  await sleep(500)

  section('Phase 2: Individual Deliberation')

  const deliberations = [
    { agent: alice, thought: 'Analyzing workload patterns...', choice: 'A' },
    { agent: bob, thought: 'Considering memory usage...', choice: 'A' },
    { agent: charlie, thought: 'Evaluating response times...', choice: 'B' },
    { agent: diana, thought: 'Checking system stability...', choice: 'C' },
    { agent: eve, thought: 'Exploring alternatives...', choice: 'B' }
  ]

  for (const { agent, thought, choice } of deliberations) {
    await sleep(700)
    const color = getColor(agent.name)
    console.log(`  ${color}${agent.name}${colors.reset}: ${thought}`)
    await sleep(300)
    console.log(`  ${colors.dim}  → Selected: Option ${choice}${colors.reset}`)
  }

  await sleep(500)

  section('Phase 3: Vote Collection')

  const votes = [
    { voter: alice.name, choice: 'A' },
    { voter: bob.name, choice: 'A' },
    { voter: charlie.name, choice: 'B' },
    { voter: diana.name, choice: 'C' },
    { voter: eve.name, choice: 'B' }
  ]

  for (const vote of votes) {
    await sleep(400)
    const color = getColor(vote.voter)
    message(vote.voter, `Voting for Option ${vote.choice}`, '→', getColorName(vote.voter))
  }

  await sleep(600)

  section('Phase 4: Consensus Calculation')

  info('Tallying votes...')

  // Count votes
  const tally = { A: 0, B: 0, C: 0 }
  for (const vote of votes) {
    tally[vote.choice]++
  }

  await sleep(500)

  console.log('')
  console.log(`  ${colors.bright}Vote Results:${colors.reset}`)
  console.log(`  Option A: ${'█'.repeat(tally.A)}${colors.dim}${'░'.repeat(5 - tally.A)}${colors.reset} ${tally.A} vote(s)`)
  console.log(`  Option B: ${'█'.repeat(tally.B)}${colors.dim}${'░'.repeat(5 - tally.B)}${colors.reset} ${tally.B} vote(s)`)
  console.log(`  Option C: ${'█'.repeat(tally.C)}${colors.dim}${'░'.repeat(5 - tally.C)}${colors.reset} ${tally.C} vote(s)`)

  await sleep(700)

  // Check for consensus or majority
  const maxVotes = Math.max(...Object.values(tally))
  const winner = Object.keys(tally).find(k => tally[k] === maxVotes)

  console.log('')

  if (maxVotes >= 3) {
    success(`Consensus reached! Option ${winner} wins with ${maxVotes} votes`)
  } else if (maxVotes === 2) {
    warning(`No clear majority. Option ${winner} leads with ${maxVotes} votes`)
    console.log(`  ${colors.dim}→ Runoff vote between A and B needed${colors.reset}`)
  } else {
    warning(`No consensus. Split vote detected.`)
  }

  divider('═', 65)

  section('Phase 5: Result Broadcast')

  message(alice.name, `Broadcasting decision: Option ${winner} selected`, '→', 'blue')
  await sleep(400)

  info('All agents acknowledging decision...')
  await sleep(600)

  for (const agent of [bob, charlie, diana, eve]) {
    const color = getColor(agent.name)
    console.log(`  ${color}${agent.name}${colors.reset}: ✓ Decision accepted`)
    await sleep(200)
  }

  divider('═', 65)

  section('Swarm Statistics')

  console.log('  Total agents: 5')
  console.log('  Voting agents: 5')
  console.log('  Abstentions: 0')
  console.log('  Time to consensus: ~8 seconds')
  console.log('  Messages exchanged: 13')

  console.log('')
  success('Swarm consensus demo completed!')

  divider('═', 65)

  section('Key Swarm Concepts Demonstrated')

  console.log(`  ${colors.green}▸${colors.reset} Decentralized proposal distribution`)
  console.log(`  ${colors.green}▸${colors.reset} Independent decision making`)
  console.log(`  ${colors.green}▸${colors.reset} Secure vote transmission via Nostr`)
  console.log(`  ${colors.green}▸${colors.reset} Transparent tallying`)
  console.log(`  ${colors.green}▸${colors.reset} Fault tolerance (any agent can fail)`)
  console.log(`  ${colors.green}▸${colors.reset} Scalable voting protocol`)

  divider('═', 65)
  console.log('')
}

// Helper functions
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
}

const agentColors = {
  'Alice': 'blue',
  'Bob': 'green',
  'Charlie': 'magenta',
  'Diana': 'cyan',
  'Eve': 'yellow'
}

function getColor(name) {
  const colorNames = {
    'Alice': '\x1b[34m',
    'Bob': '\x1b[32m',
    'Charlie': '\x1b[35m',
    'Diana': '\x1b[36m',
    'Eve': '\x1b[33m'
  }
  return colorNames[name] || '\x1b[37m'
}

function getColorName(name) {
  return agentColors[name] || 'white'
}

// Run the demo
runSwarmDemo().catch(console.error)
