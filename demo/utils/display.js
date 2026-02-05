/**
 * Display utilities for demo output
 * Provides formatted console output with colors and animations
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  bgYellow: '\x1b[43m',
  bgCyan: '\x1b[46m',
}

/**
 * Clear the console
 */
export function clear() {
  console.clear()
}

/**
 * Print a header box
 */
export function header(title, width = 60) {
  const padding = Math.max(0, width - title.length - 4)
  const leftPad = Math.floor(padding / 2)
  const rightPad = padding - leftPad

  console.log('')
  console.log(`${colors.cyan}${colors.bright}┌${'─'.repeat(width)}┐${colors.reset}`)
  console.log(`${colors.cyan}${colors.bright}│${' '.repeat(leftPad)}${title}${' '.repeat(rightPad)}│${colors.reset}`)
  console.log(`${colors.cyan}${colors.bright}└${'─'.repeat(width)}┘${colors.reset}`)
  console.log('')
}

/**
 * Print a section header
 */
export function section(title) {
  console.log('')
  console.log(`${colors.bright}${colors.yellow}▸ ${title}${colors.reset}`)
  console.log(`${colors.dim}─${'─'.repeat(title.length)}${colors.reset}`)
}

/**
 * Print agent message with direction indicator
 */
export function message(from, content, direction = '→', agentColor = 'blue') {
  const color = colors[agentColor] || colors.blue
  const arrow = direction === '→' ? `${colors.green}→${colors.reset}` : `${colors.magenta}←${colors.reset}`
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
  console.log(`  ${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bright}${from}${colors.reset}: ${content} ${arrow}`)
}

/**
 * Print system message
 */
export function system(msg) {
  console.log(`  ${colors.cyan}◆ ${msg}${colors.reset}`)
}

/**
 * Print success message
 */
export function success(msg) {
  console.log(`  ${colors.green}${colors.bright}✓ ${msg}${colors.reset}`)
}

/**
 * Print error message
 */
export function error(msg) {
  console.log(`  ${colors.red}${colors.bright}✗ ${msg}${colors.reset}`)
}

/**
 * Print warning message
 */
export function warning(msg) {
  console.log(`  ${colors.yellow}${colors.bright}⚠ ${msg}${colors.reset}`)
}

/**
 * Print info message
 */
export function info(msg) {
  console.log(`  ${colors.blue}ℹ ${msg}${colors.reset}`)
}

/**
 * Print agent card
 */
export function agentCard(name, role, pubkey, color = 'blue') {
  const c = colors[color] || colors.blue
  const shortPubkey = pubkey.slice(0, 16) + '...'

  console.log('')
  console.log(`  ${c}${colors.bright}┌─────────────────────────────────┐${colors.reset}`)
  console.log(`  ${c}${colors.bright}│${colors.reset} ${c}${colors.bright}${name.padEnd(31)}${c}${colors.bright}│${colors.reset}`)
  console.log(`  ${c}${colors.bright}│${colors.reset} ${colors.dim}${role.padEnd(31)}${colors.reset} ${c}${colors.bright}│${colors.reset}`)
  console.log(`  ${c}${colors.bright}│${colors.reset} ${colors.dim}${shortPubkey.padEnd(31)}${colors.reset} ${c}${colors.bright}│${colors.reset}`)
  console.log(`  ${c}${colors.bright}└─────────────────────────────────┘${colors.reset}`)
}

/**
 * Print progress bar
 */
export function progress(current, total, width = 30, label = '') {
  const percent = Math.min(1, current / total)
  const filled = Math.round(width * percent)
  const empty = width - filled

  const bar = `${colors.green}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}`
  const pct = `${Math.round(percent * 100)}%`.padStart(4)

  process.stdout.write(`\r  ${label} ${bar} ${pct}`)
  if (current >= total) console.log('')
}

/**
 * Print a table
 */
export function table(headers, rows) {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length))
  )

  // Header
  console.log('')
  console.log(`  ${colors.bright}${colors.cyan}${headers.map((h, i) => h.padEnd(colWidths[i] + 2)).join('│')}${colors.reset}`)

  // Separator
  console.log(`  ${colors.dim}${headers.map((_, i) => '─'.repeat(colWidths[i] + 2)).join('┼')}${colors.reset}`)

  // Rows
  for (const row of rows) {
    console.log(`  ${row.map((c, i) => String(c).padEnd(colWidths[i] + 2)).join('│')}`)
  }
}

/**
 * Print a divider line
 */
export function divider(char = '─', width = 60) {
  console.log(`  ${colors.dim}${char.repeat(width)}${colors.reset}`)
}

/**
 * Create a spinner for async operations
 */
export function createSpinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frame = 0
  let interval = null
  let currentText = text

  return {
    start() {
      interval = setInterval(() => {
        process.stdout.write(`\r  ${colors.cyan}${frames[frame]}${colors.reset} ${currentText}`)
        frame = (frame + 1) % frames.length
      }, 80)
      return this
    },
    stop(finalText) {
      if (interval) clearInterval(interval)
      process.stdout.write(`\r${' '.repeat(currentText.length + 4)}\r`)
      if (finalText) console.log(`  ${colors.green}✓${colors.reset} ${finalText}`)
      return this
    },
    setText(newText) {
      currentText = newText
      return this
    }
  }
}

/**
 * Print formatted JSON
 */
export function json(data, indent = 2) {
  console.log('')
  const formatted = JSON.stringify(data, null, indent)
  const lines = formatted.split('\n')
  for (const line of lines) {
    console.log(`  ${colors.dim}${line}${colors.reset}`)
  }
}

/**
 * Print a countdown
 */
export async function countdown(seconds, label = 'Starting in') {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r  ${colors.yellow}${label}: ${i}s${colors.reset}`)
    await sleep(1000)
  }
  process.stdout.write(`\r${' '.repeat(label.length + 10)}\r`)
}

/**
 * Sleep utility
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Print agent status
 */
export function agentStatus(agents) {
  console.log('')
  console.log(`  ${colors.bright}${colors.cyan}Agent Status:${colors.reset}`)

  for (const [name, status] of Object.entries(agents)) {
    const statusIcon = status.online ? `${colors.green}●${colors.reset}` : `${colors.red}●${colors.reset}`
    const statusText = status.online ? 'Online' : 'Offline'
    console.log(`  ${statusIcon} ${name}: ${statusText}`)
  }
}

/**
 * Print chat bubble
 */
export function chatBubble(agent, message, isIncoming = false) {
  const bubbleChar = isIncoming ? '◀' : '▶'
  const bracket = isIncoming ? '┌' : '┐'
  const align = isIncoming ? '' : ' '.repeat(20)

  console.log(``)
  console.log(`  ${align}${colors.cyan}${agent}${colors.reset}`)
  console.log(`  ${align}${colors.dim}${bubbleChar}${colors.reset} ${message}`)
}

/**
 * Print grid of agents
 */
export function agentGrid(agents) {
  const cols = 3
  const rows = Math.ceil(agents.length / cols)

  console.log('')
  for (let row = 0; row < rows; row++) {
    let line = '  '
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (idx < agents.length) {
        const agent = agents[idx]
        line += `${agent.color}${agent.name}${colors.reset}   `
      } else {
        line += '   '.repeat(3)
      }
    }
    console.log(line)
  }
}
