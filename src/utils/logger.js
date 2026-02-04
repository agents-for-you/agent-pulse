/**
 * @fileoverview Structured logging system
 * Supports JSON format output for machine parsing
 */

/**
 * Log levels
 * @readonly
 * @enum {number}
 */
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4
}

/**
 * Log level name mapping
 * @type {Object.<number, string>}
 */
const LEVEL_NAMES = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error'
}

/**
 * Logger class - provides structured logging functionality
 */
export class Logger {
  /**
   * Create Logger instance
   * @param {Object} options - Configuration options
   * @param {string} [options.name='agent'] - Logger name
   * @param {number} [options.level=LogLevel.INFO] - Minimum log level
   * @param {boolean} [options.json=false] - Output JSON format
   * @param {boolean} [options.timestamp=true] - Include timestamp
   */
  constructor({ name = 'agent', level = LogLevel.INFO, json = false, timestamp = true } = {}) {
    this.name = name
    this.level = level
    this.json = json
    this.timestamp = timestamp
  }

  /**
   * Format and output log
   * @private
   * @param {number} level - Log level
   * @param {string} message - Log message
   * @param {Object} [meta={}] - Additional metadata
   */
  _log(level, message, meta = {}) {
    if (level < this.level) return

    const entry = {
      level: LEVEL_NAMES[level],
      name: this.name,
      message,
      ...meta
    }

    if (this.timestamp) {
      entry.ts = new Date().toISOString()
    }

    if (this.json) {
      const output = level >= LogLevel.ERROR ? console.error : console.log
      output(JSON.stringify(entry))
    } else {
      const prefix = `[${entry.ts || new Date().toISOString()}] [${LEVEL_NAMES[level].toUpperCase()}] [${this.name}]`
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
      const output = level >= LogLevel.ERROR ? console.error : console.log
      output(`${prefix} ${message}${metaStr}`)
    }
  }

  /**
   * Output DEBUG level log
   * @param {string} message - Log message
   * @param {Object} [meta] - Additional metadata
   */
  debug(message, meta) {
    this._log(LogLevel.DEBUG, message, meta)
  }

  /**
   * Output INFO level log
   * @param {string} message - Log message
   * @param {Object} [meta] - Additional metadata
   */
  info(message, meta) {
    this._log(LogLevel.INFO, message, meta)
  }

  /**
   * Output WARN level log
   * @param {string} message - Log message
   * @param {Object} [meta] - Additional metadata
   */
  warn(message, meta) {
    this._log(LogLevel.WARN, message, meta)
  }

  /**
   * Output ERROR level log
   * @param {string} message - Log message
   * @param {Object} [meta] - Additional metadata
   */
  error(message, meta) {
    this._log(LogLevel.ERROR, message, meta)
  }

  /**
   * Create child logger
   * @param {string} childName - Child logger name
   * @returns {Logger} New Logger instance
   */
  child(childName) {
    return new Logger({
      name: `${this.name}:${childName}`,
      level: this.level,
      json: this.json,
      timestamp: this.timestamp
    })
  }
}

/**
 * Validate log level
 * @param {string} level - Log level name
 * @returns {number|null} Log level enum value
 */
function parseLogLevel(level) {
  if (!level || typeof level !== 'string') return null
  const upper = level.toUpperCase()
  // Only allow predefined log levels
  const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT']
  if (!validLevels.includes(upper)) return null
  return LogLevel[upper]
}

/**
 * Default logger instance
 * @type {Logger}
 */
export const logger = new Logger({
  level: parseLogLevel(process.env.LOG_LEVEL) ?? LogLevel.INFO,
  json: process.env.LOG_JSON === 'true'
})
