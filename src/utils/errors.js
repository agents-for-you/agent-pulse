/**
 * @fileoverview Enhanced error handling utilities
 * Provides structured error types and handling helpers
 */

import { ErrorCode, createErrorResponseFromCode } from '../service/shared.js'

/**
 * Base Application Error
 */
export class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {Object} [details] - Additional error details
   */
  constructor(message, code = ErrorCode.INTERNAL_ERROR, details = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.details = details
    this.timestamp = Date.now()
    Error.captureStackTrace(this, this.constructor)
  }

  /**
   * Convert to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      ok: false,
      code: this.code,
      error: this.message,
      details: this.details,
      timestamp: this.timestamp
    }
  }

  /**
   * Get user-friendly error message with suggestion
   * @returns {string} Formatted error message
   */
  getFormattedMessage() {
    let msg = `Error: ${this.message}`
    if (this.suggestion) {
      msg += `\n\nSuggestion: ${this.suggestion}`
    }
    return msg
  }

  /**
   * Suggestion for recovery
   */
  get suggestion() {
    return this._suggestFix()
  }

  /**
   * Override in subclasses to provide suggestions
   * @protected
   */
  _suggestFix() {
    return null
  }
}

/**
 * Network Error
 */
export class NetworkError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorCode.NETWORK_DISCONNECTED, details)
  }

  _suggestFix() {
    return 'Check your internet connection and relay status with `agent-pulse relay-status`'
  }
}

/**
 * File System Error
 */
export class FileSystemError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorCode.FILE_ERROR, details)
  }

  _suggestFix() {
    const { operation, path } = this.details
    if (operation === 'write' && path) {
      return `Check directory permissions for: ${path}`
    }
    return 'Ensure the .data directory exists and is writable'
  }
}

/**
 * Validation Error
 */
export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorCode.INVALID_ARGS, details)
  }

  _suggestFix() {
    const { field, value } = this.details
    if (field === 'pubkey') {
      return 'Public key should be 64-character hex string or npub format'
    }
    if (field === 'topic') {
      return 'Topic must be 1-100 alphanumeric characters, hyphens, or underscores'
    }
    return 'Check the input format and try again'
  }
}

/**
 * Service Error
 */
export class ServiceError extends AppError {
  constructor(message, code, details = {}) {
    super(message, code, details)
  }

  _suggestFix() {
    if (this.code === ErrorCode.SERVICE_NOT_RUNNING) {
      return 'Start the service with `agent-pulse start`'
    }
    if (this.code === ErrorCode.SERVICE_ALREADY_RUNNING) {
      return 'Check status with `agent-pulse status` or stop with `agent-pulse stop`'
    }
    return null
  }
}

/**
 * Error Handler Utility
 */
export const errorHandler = {
  /**
   * Wrap an async function with error handling
   * @param {Function} fn - Async function to wrap
   * @param {Object} options - Options
   * @returns {Function} Wrapped function
   */
  async(fn, options = {}) {
    return async (...args) => {
      try {
        return await fn(...args)
      } catch (err) {
        return this.handleError(err, options)
      }
    }
  },

  /**
   * Handle error and return appropriate response
   * @param {Error} err - Error to handle
   * @param {Object} options - Options
   * @returns {Object} Error response
   */
  handleError(err, options = {}) {
    const { logErrors = true, context = '' } = options

    // Log error if enabled
    if (logErrors) {
      const logger = (await import('./logger.js')).default
      logger.error(`Error${context ? ` in ${context}` : ''}`, {
        message: err.message,
        code: err.code || 'UNKNOWN',
        stack: err.stack
      })
    }

    // Already an AppError, return as-is
    if (err instanceof AppError) {
      return err.toJSON()
    }

    // Node system errors
    if (err.code === 'ENOENT') {
      return new FileSystemError('File not found', { path: err.path }).toJSON()
    }
    if (err.code === 'EACCES') {
      return new FileSystemError('Permission denied', { path: err.path }).toJSON()
    }
    if (err.code === 'ECONNREFUSED') {
      return new NetworkError('Connection refused').toJSON()
    }

    // Generic error
    return createErrorResponseFromCode(ErrorCode.INTERNAL_ERROR, err.message || 'Unknown error')
  },

  /**
   * Parse error and extract useful information
   * @param {Error} err - Error to parse
   * @returns {Object} Parsed error info
   */
  parseError(err) {
    const info = {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack
    }

    // Extract common error patterns
    if (err.message.includes('ECONNREFUSED')) {
      info.type = 'connection_refused'
      info.suggestion = 'Check if the relay is accessible'
    } else if (err.message.includes('timeout')) {
      info.type = 'timeout'
      info.suggestion = 'Try increasing timeout or check network connection'
    } else if (err.message.includes('Invalid')) {
      info.type = 'invalid_input'
      info.suggestion = 'Check your input format'
    }

    return info
  },

  /**
   * Create error response
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {string} [suggestion] - Recovery suggestion
   * @returns {Object} Error response
   */
  createResponse(code, message, suggestion) {
    const response = { ok: false, code, error: message }
    if (suggestion) {
      response.suggestion = suggestion
    }
    return response
  }
}

/**
 * Retry utility with exponential backoff
 */
export class RetryHandler {
  /**
   * @param {Object} options - Configuration
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {number} [options.baseDelay=1000] - Base delay in ms
   * @param {number} [options.maxDelay=10000] - Maximum delay in ms
   * @param {number} [options.backoff=2] - Exponential backoff factor
   */
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3
    this.baseDelay = options.baseDelay || 1000
    this.maxDelay = options.maxDelay || 10000
    this.backoff = options.backoff || 2
  }

  /**
   * Execute function with retry
   * @param {Function} fn - Async function to execute
   * @param {Object} [context] - Context for logging
   * @returns {Promise<any>} Function result
   */
  async execute(fn, context = {}) {
    let lastError

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err

        // Don't retry if it's a validation error
        if (err instanceof ValidationError || err.code === ErrorCode.INVALID_ARGS) {
          throw err
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.baseDelay * Math.pow(this.backoff, attempt),
          this.maxDelay
        )

        const logger = (await import('./logger.js')).default
        logger.warn('Retry attempt', {
          attempt: attempt + 1,
          maxRetries: this.maxRetries + 1,
          delay,
          error: err.message,
          ...context
        })

        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  /**
   * Create a wrapped function with retry
   * @param {Function} fn - Function to wrap
   * @returns {Function} Wrapped function
   */
  wrap(fn) {
    return (...args) => this.execute(() => fn(...args))
  }
}

/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by stopping requests to failing services
 */
export class CircuitBreaker {
  /**
   * @param {Object} options - Configuration
   * @param {number} [options.threshold=5] - Failure threshold
   * @param {number} [options.timeout=60000] - Reset timeout in ms
   * @param {number} [options.halfOpenAttempts=1] - Attempts in half-open state
   */
  constructor(options = {}) {
    this.threshold = options.threshold || 5
    this.timeout = options.timeout || 60000 // 1 minute
    this.halfOpenAttempts = options.halfOpenAttempts || 1

    this.failureCount = 0
    this.state = 'closed' // closed, open, half-open
    this.nextAttempt = 0
    this.halfOpenCount = 0
  }

  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} Function result
   * @throws {Error} If circuit is open
   */
  async execute(fn) {
    // Check if circuit should reset
    if (this.state === 'open' && Date.now() >= this.nextAttempt) {
      this.state = 'half-open'
      this.halfOpenCount = 0
      const logger = (await import('./logger.js')).default
      logger.info('Circuit breaker entering half-open state')
    }

    // Reject if circuit is open
    if (this.state === 'open') {
      throw new Error('Circuit breaker is open - service unavailable')
    }

    try {
      const result = await fn()

      // Success - reset failure count
      this.onSuccess()

      return result
    } catch (err) {
      this.onFailure()
      throw err
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.failureCount = 0

    if (this.state === 'half-open') {
      this.halfOpenCount++
      if (this.halfOpenCount >= this.halfOpenAttempts) {
        this.state = 'closed'
        const logger = (await import('./logger.js')).default
        logger.info('Circuit breaker closed - service recovered')
      }
    }
  }

  /**
   * Handle failed execution
   */
  onFailure() {
    this.failureCount++

    if (this.failureCount >= this.threshold) {
      this.state = 'open'
      this.nextAttempt = Date.now() + this.timeout
      const logger = (await import('./logger.js')).default
      logger.warn('Circuit breaker opened - too many failures', {
        failureCount: this.failureCount,
        threshold: this.threshold
      })
    }
  }

  /**
   * Get current state
   * @returns {Object} State info
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt: this.nextAttempt,
      remainingTime: Math.max(0, this.nextAttempt - Date.now())
    }
  }

  /**
   * Reset circuit breaker
   */
  reset() {
    this.state = 'closed'
    this.failureCount = 0
    this.nextAttempt = 0
    this.halfOpenCount = 0
  }
}

export default {
  AppError,
  NetworkError,
  FileSystemError,
  ValidationError,
  ServiceError,
  errorHandler,
  RetryHandler,
  CircuitBreaker
}
