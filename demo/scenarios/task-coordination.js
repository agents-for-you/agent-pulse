#!/usr/bin/env node
/**
 * Task Coordination Demo - Multi-Agent Task Delegation
 *
 * Demonstrates coordinated task processing across multiple agents
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
  agentCard,
  countdown,
  sleep,
  progress,
  table
} from '../utils/display.js'

// Import agent definitions
import { alice, bob, charlie } from '../agents/definitions.js'

/**
 * Simulate coordinated task processing
 */
async function runCoordinationDemo() {
  clear()

  header('AgentPulse Task Coordination Demo', 60)

  section('Overview')
  console.log(`  This demo shows three agents coordinating on a data processing pipeline:`)
  console.log(``)
  console.log(`  • ${alice.name} - ${alice.role}: Delegates tasks and aggregates results`)
  console.log(`  • ${bob.name} - ${bob.role}: Processes numerical data`)
  console.log(`  • ${charlie.name} - ${charlie.role}: Analyzes text content`)
  console.log(``)
  info('Agents work in parallel on different aspects of the same task')

  divider('═', 60)

  section('Agent Team')

  agentCard(alice.name, alice.role, alice.pubkey.slice(0, 16) + '...', 'blue')
  agentCard(bob.name, bob.role, bob.pubkey.slice(0, 16) + '...', 'green')
  agentCard(charlie.name, charlie.role, charlie.pubkey.slice(0, 16) + '...', 'magenta')

  divider('═', 60)

  section('Scenario: Data Processing Pipeline')

  info('Task: Process a dataset with mixed numerical and text data')
  console.log('')
  console.log('  Dataset contains:')
  console.log('  • 500 numerical records (sales figures)')
  console.log('  • 200 text records (customer reviews)')

  await countdown(3, 'Starting coordination in')

  console.log('')
  section('Phase 1: Task Distribution')

  // Alice delegates tasks
  message(alice.name, 'Starting task distribution...', '→', 'blue')
  await sleep(800)

  message(alice.name, `@${bob.name} Process 500 numerical records`, '→', 'blue')
  await sleep(600)

  message(alice.name, `@${charlie.name} Analyze 200 text reviews`, '→', 'blue')
  await sleep(600)

  console.log('')
  success('Tasks delegated successfully')

  section('Phase 2: Parallel Processing')

  // Bob processing
  message(bob.name, 'Task received. Starting numerical analysis...', '←', 'green')
  await sleep(500)

  for (let i = 1; i <= 10; i++) {
    await sleep(200)
    progress(i * 50, 500, 20, `  ${bob.name}: Processing records`)
  }

  console.log('')
  message(bob.name, 'Numerical analysis complete!', '→', 'green')
  message(bob.name, `Result: Mean=52.3, Median=48, Mode=45`, '→', 'green')

  await sleep(800)

  // Charlie processing
  message(charlie.name, 'Task received. Starting text analysis...', '←', 'magenta')
  await sleep(500)

  for (let i = 1; i <= 10; i++) {
    await sleep(150)
    progress(i * 20, 200, 20, `  ${charlie.name}: Analyzing reviews`)
  }

  console.log('')
  message(charlie.name, 'Text analysis complete!', '→', 'magenta')
  message(charlie.name, `Result: 78% positive, 15% neutral, 7% negative`, '→', 'magenta')

  await sleep(800)

  section('Phase 3: Result Aggregation')

  message(alice.name, 'Receiving results from workers...', '→', 'blue')
  await sleep(600)

  message(bob.name, 'Sending numerical results...', '→', 'green')
  await sleep(400)

  message(charlie.name, 'Sending text analysis results...', '→', 'magenta')
  await sleep(400)

  message(alice.name, 'All results received. Aggregating...', '→', 'blue')
  await sleep(800)

  console.log('')
  success('Aggregation complete!')

  divider('═', 60)

  section('Final Results')

  const headers = ['Metric', 'Value', 'Processed By']
  const rows = [
    ['Numerical Mean', '52.3', bob.name],
    ['Numerical Median', '48', bob.name],
    ['Positive Sentiment', '78%', charlie.name],
    ['Neutral Sentiment', '15%', charlie.name],
    ['Negative Sentiment', '7%', charlie.name],
    ['Total Records', '700', alice.name]
  ]

  table(headers, rows)

  divider('═', 60)

  section('Performance Metrics')

  console.log('  Coordination benefits:')
  console.log(`  • ${colors.green}Parallel processing${colors.reset}: 2.3x faster than sequential`)
  console.log(`  • ${colors.green}Specialization${colors.reset}: Each agent uses optimal algorithms`)
  console.log(`  • ${colors.green}Scalability${colors.reset}: Easy to add more workers`)
  console.log(`  • ${colors.green}Fault tolerance${colors.reset}: Failed tasks can be reassigned`)

  divider('═', 60)

  section('Message Flow Summary')

  console.log('  Total messages: 11')
  console.log('    • 3 task delegation messages')
  console.log('    • 2 progress updates')
  console.log('    • 2 result submissions')
  console.log('    • 4 status/acknowledgment messages')

  console.log('')
  success('Demo completed successfully!')

  console.log('')
  divider('═', 60)
  console.log('')
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m'
}

// Run the demo
runCoordinationDemo().catch(console.error)
