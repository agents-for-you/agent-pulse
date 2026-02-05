#!/usr/bin/env node
/**
 * Run All Demos
 *
 * Executes all AgentPulse demos in sequence with option to skip
 */

import * as path from 'path'
import { fileURLToPath } from 'url'
import * as readline from 'readline'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const demos = [
  { name: 'Chat Demo', file: 'chat-demo.js', description: 'Simple 1-on-1 conversation' },
  { name: 'Task Coordination', file: 'task-coordination.js', description: 'Multi-agent task delegation' },
  { name: 'Swarm Intelligence', file: 'swarm-intelligence.js', description: 'Collective decision making' }
]

/**
 * Ask user a question
 */
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

/**
 * Run a single demo
 */
async function runDemo(demo) {
  console.log('')
  console.log(`\x1b[36m\x1b[1m▶ Running: ${demo.name}\x1b[0m`)
  console.log(`\x1b[2m  ${demo.description}\x1b[0m`)

  try {
    const demoPath = path.join(__dirname, demo.file)
    await import(`file://${demoPath}`)
    return true
  } catch (err) {
    console.error(`\x1b[31m✗ Demo failed: ${err.message}\x1b[0m`)
    return false
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('')
  console.log('\x1b[36m\x1b[1m┌─────────────────────────────────────────────┐\x1b[0m')
  console.log('\x1b[36m\x1b[1m│     AgentPulse Demo Gallery - All Demos    │\x1b[0m')
  console.log('\x1b[36m\x1b[1m└─────────────────────────────────────────────┘\x1b[0m')
  console.log('')

  console.log('Available demos:')
  for (let i = 0; i < demos.length; i++) {
    console.log(`  ${i + 1}. ${demos[i].name}`)
    console.log(`     \x1b[2m${demos[i].description}\x1b[0m`)
  }

  console.log('')
  const answer = await ask('Run all demos? (Y/n/s to skip): ')

  if (answer === 's' || answer === 'skip') {
    const num = await ask('Which demo? (1-3): ')
    const idx = parseInt(num) - 1
    if (idx >= 0 && idx < demos.length) {
      await runDemo(demos[idx])
    } else {
      console.log('\x1b[31mInvalid selection\x1b[0m')
    }
    return
  }

  if (answer === 'n' || answer === 'no') {
    console.log('Cancelled.')
    return
  }

  // Run all demos
  const results = []
  for (const demo of demos) {
    const success = await runDemo(demo)
    results.push({ demo, success })

    if (demo !== demos[demos.length - 1]) {
      console.log('')
      const cont = await ask('Continue to next demo? (Y/n): ')
      if (cont === 'n' || cont === 'no') {
        break
      }
    }
  }

  // Summary
  console.log('')
  console.log('\x1b[1mDemo Run Summary\x1b[0m')
  console.log('────────────────')

  for (const { demo, success } of results) {
    const status = success ? '\x1b[32m✓ Passed\x1b[0m' : '\x1b[31m✗ Failed\x1b[0m'
    console.log(`  ${status} - ${demo.name}`)
  }

  const passed = results.filter(r => r.success).length
  console.log('')
  console.log(`\x1b[1mTotal: ${passed}/${results.length} demos successful\x1b[0m`)
  console.log('')
}

main().catch(console.error)
