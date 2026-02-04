/**
 * @fileoverview Auto-update utility
 * Checks for and installs updates from GitHub
 */
import { spawn } from 'child_process'
import { logger } from './logger.js'

const log = logger.child('updater')

// Package info
const PACKAGE_NAME = 'agent-pulse'
const GITHUB_REPO = 'agents-for-you/agent-pulse'
const NPM_PACKAGE = 'agents-for-you/agent-pulse'

/**
 * Get current version from package.json
 * @returns {Promise<string>} Current version
 */
async function getCurrentVersion() {
  try {
    const pkg = await import('../../package.json', { with: { type: 'json' } })
    return pkg.default.version
  } catch {
    return 'unknown'
  }
}

/**
 * Fetch latest version from npm registry
 * @returns {Promise<string|null>} Latest version or null
 */
async function getLatestVersion() {
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}`)
    if (!response.ok) {
      throw new Error(`Registry response: ${response.status}`)
    }
    const data = await response.json()
    return data['dist-tags']?.latest || null
  } catch (err) {
    log.error('Failed to fetch latest version', { error: err.message })
    return null
  }
}

/**
 * Compare two version strings
 * @param {string} v1 - Version 1
 * @param {string} v2 - Version 2
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 < p2) return -1
    if (p1 > p2) return 1
  }
  return 0
}

/**
 * Check if update is available
 * @returns {Promise<Object>} Update status
 */
export async function checkForUpdates() {
  const current = await getCurrentVersion()
  const latest = await getLatestVersion()

  if (!latest) {
    return {
      ok: false,
      error: 'Unable to check for updates',
      current
    }
  }

  const comparison = compareVersions(latest, current)
  const updateAvailable = comparison > 0

  return {
    ok: true,
    current,
    latest,
    updateAvailable,
    canUpdate: comparison !== 0
  }
}

/**
 * Run a command with progress output
 * @param {string} command - Command to run
 * @param {string[]} args - Arguments
 * @param {Function} onOutput - Output callback
 * @returns {Promise<number>} Exit code
 */
function runCommand(command, args, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'pipe' })

    child.stdout.on('data', (data) => {
      if (onOutput) onOutput(data.toString(), 'stdout')
    })

    child.stderr.on('data', (data) => {
      if (onOutput) onOutput(data.toString(), 'stderr')
    })

    child.on('close', (code) => {
      resolve(code)
    })

    child.on('error', (err) => {
      log.error('Command failed', { error: err.message })
      resolve(-1)
    })
  })
}

/**
 * Perform self-update
 * @param {Object} options - Options
 * @param {boolean} [options.force=false] - Force update even if same version
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>} Update result
 */
export async function performUpdate(options = {}) {
  const { force = false, onProgress } = options

  // Check for updates
  const status = await checkForUpdates()

  if (!status.ok) {
    return status
  }

  if (!status.updateAvailable && !force) {
    return {
      ok: true,
      alreadyUpToDate: true,
      current: status.current,
      message: `Already up to date (v${status.current})`
    }
  }

  log.info('Starting update', {
    from: status.current,
    to: status.latest
  })

  if (onProgress) {
    onProgress('info', `Updating from v${status.current} to v${status.latest}...`)
  }

  // Perform update using npm
  const progressIndicator = (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      if (line.includes('agent-pulse')) {
        if (onProgress) {
          onProgress('info', line.trim())
        }
      }
    }
  }

  const exitCode = await runCommand('npm', ['install', '-g', NPM_PACKAGE, '--force'], progressIndicator)

  if (exitCode !== 0) {
    return {
      ok: false,
      error: 'Update failed',
      exitCode
    }
  }

  const newVersion = await getCurrentVersion()

  return {
    ok: true,
    updated: true,
    previous: status.current,
    current: newVersion,
    message: `Updated from v${status.current} to v${newVersion}`
  }
}

/**
 * Display update status
 * @param {Object} status - Status from checkForUpdates
 * @returns {string} Formatted status
 */
export function formatUpdateStatus(status) {
  if (!status.ok) {
    return `Update check failed: ${status.error}`
  }

  if (status.updateAvailable) {
    return `Update available: v${status.current} → v${status.latest}`
  }

  if (status.canUpdate) {
    return `Local version (v${status.current}) differs from latest (v${status.latest})`
  }

  return `Up to date (v${status.current})`
}

export default {
  checkForUpdates,
  performUpdate,
  formatUpdateStatus,
  getCurrentVersion,
  compareVersions
}
