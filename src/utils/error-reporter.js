/**
 * @fileoverview Agent-friendly error reporting module
 * Provides detailed error messages with actionable suggestions for AI agents
 */

/**
 * Error severity levels
 */
export const ErrorSeverity = {
  CRITICAL: 'critical',  // Operation cannot continue
  HIGH: 'high',          // Functionality broken
  MEDIUM: 'medium',      // Degraded experience
  LOW: 'low',            // Minor issue
  INFO: 'info'           // Informational
}

/**
 * Error categories for better classification
 */
export const ErrorCategory = {
  NETWORK: 'network',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  VALIDATION: 'validation',
  RESOURCE: 'resource',
  PROTOCOL: 'protocol',
  INTERNAL: 'internal'
}

/**
 * Agent-friendly error codes with suggestions
 */
export const ErrorCodes = {
  // Network errors (100-199)
  NETWORK_DISCONNECTED: {
    code: 100,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.NETWORK,
    message: 'Not connected to Nostr network',
    suggestion: 'Start the service with: agent-pulse start',
    retryable: true
  },
  NETWORK_SEND_FAILED: {
    code: 101,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.NETWORK,
    message: 'Failed to send message to network',
    suggestion: 'Check relay status with: agent-pulse relay-status',
    retryable: true
  },
  RELAY_ALL_FAILED: {
    code: 102,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.NETWORK,
    message: 'All relay connections failed',
    suggestion: 'Check internet connection and relay availability. Try: agent-pulse relay-status',
    retryable: true
  },
  RELAY_UNHEALTHY: {
    code: 103,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.NETWORK,
    message: 'Relay connection unhealthy',
    suggestion: 'Relay may be down. Consider adding backup relays.',
    retryable: true
  },

  // Service errors (200-299)
  SERVICE_NOT_RUNNING: {
    code: 200,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.RESOURCE,
    message: 'Background service not running',
    suggestion: 'Start the service with: agent-pulse start (or use --ephemeral for temporary mode)',
    retryable: false
  },
  SERVICE_ALREADY_RUNNING: {
    code: 201,
    severity: ErrorSeverity.LOW,
    category: ErrorCategory.RESOURCE,
    message: 'Service is already running',
    suggestion: 'Check status with: agent-pulse status. Stop first with: agent-pulse stop',
    retryable: false
  },
  SERVICE_START_FAILED: {
    code: 202,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.INTERNAL,
    message: 'Failed to start background service',
    suggestion: 'Check if another instance is running. View logs for details.',
    retryable: true
  },

  // Authentication/Authorization errors (300-399)
  INVALID_PUBKEY: {
    code: 300,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.VALIDATION,
    message: 'Invalid public key format',
    suggestion: 'Use 64-character hex key or npub format. Get your key with: agent-pulse me',
    retryable: false
  },
  INVALID_SIGNATURE: {
    code: 301,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.AUTHENTICATION,
    message: 'Message signature verification failed',
    suggestion: 'Message may be tampered. Verify sender identity.',
    retryable: false
  },
  UNAUTHORIZED: {
    code: 302,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.AUTHORIZATION,
    message: 'Operation not authorized',
    suggestion: 'Check permissions. For key export, set SECRET_KEY_EXPORT_AUTH environment variable.',
    retryable: false
  },

  // Group errors (400-499)
  GROUP_NOT_FOUND: {
    code: 400,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.RESOURCE,
    message: 'Group not found',
    suggestion: 'List groups with: agent-pulse groups. Verify group ID is correct.',
    retryable: false
  },
  GROUP_ALREADY_EXISTS: {
    code: 401,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.VALIDATION,
    message: 'Group already exists',
    suggestion: 'Use a different group name or join the existing group.',
    retryable: false
  },
  NOT_GROUP_OWNER: {
    code: 402,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.AUTHORIZATION,
    message: 'Only group owner can perform this action',
    suggestion: 'Only the group creator can transfer ownership. Check members with: agent-pulse group-members <id>',
    retryable: false
  },
  MEMBER_NOT_FOUND: {
    code: 403,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.RESOURCE,
    message: 'Member not found in group',
    suggestion: 'Verify member public key. List members with: agent-pulse group-members <id>',
    retryable: false
  },
  MEMBER_BANNED: {
    code: 404,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.AUTHORIZATION,
    message: 'Member is banned from this group',
    suggestion: 'Contact group owner to appeal ban.',
    retryable: false
  },
  MEMBER_MUTED: {
    code: 405,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.AUTHORIZATION,
    message: 'Member is temporarily muted',
    suggestion: 'Wait for mute to expire or contact group admin.',
    retryable: false
  },

  // Message errors (500-599)
  MESSAGE_EXPIRED: {
    code: 500,
    severity: ErrorSeverity.LOW,
    category: ErrorCategory.PROTOCOL,
    message: 'Message has expired',
    suggestion: 'Message was too old. Send a fresh message.',
    retryable: false
  },
  MESSAGE_RETRY_EXHAUSTED: {
    code: 501,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.NETWORK,
    message: 'Message delivery failed after all retries',
    suggestion: 'Network may be unreliable. Check: agent-pulse relay-status',
    retryable: true
  },
  MESSAGE_TOO_LARGE: {
    code: 502,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.VALIDATION,
    message: 'Message exceeds maximum size',
    suggestion: 'Reduce message size or split into multiple messages.',
    retryable: false
  },
  REPLAY_ATTACK_DETECTED: {
    code: 503,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.AUTHENTICATION,
    message: 'Duplicate/replay message detected',
    suggestion: 'Message nonce was already seen. This may indicate a replay attack.',
    retryable: false
  },

  // Validation errors (600-699)
  INVALID_ARGS: {
    code: 600,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.VALIDATION,
    message: 'Invalid command arguments',
    suggestion: 'Check command syntax. Use: agent-pulse help <command>',
    retryable: false
  },
  INVALID_TOPIC: {
    code: 601,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.VALIDATION,
    message: 'Invalid topic format',
    suggestion: 'Topic must be 1-100 alphanumeric characters, hyphens, or underscores.',
    retryable: false
  },
  INVALID_GROUP_ID: {
    code: 602,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.VALIDATION,
    message: 'Invalid group ID format',
    suggestion: 'Group ID must be 1-50 alphanumeric characters or hyphens.',
    retryable: false
  },

  // File system errors (700-799)
  FILE_ERROR: {
    code: 700,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.RESOURCE,
    message: 'File operation error',
    suggestion: 'Check file permissions and disk space.',
    retryable: true
  },
  STORAGE_CORRUPTED: {
    code: 701,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.INTERNAL,
    message: 'Local storage may be corrupted',
    suggestion: 'Try clearing .data directory and restart.',
    retryable: false
  },

  // Protocol errors (800-899)
  DECRYPTION_FAILED: {
    code: 800,
    severity: ErrorSeverity.MEDIUM,
    category: ErrorCategory.PROTOCOL,
    message: 'Failed to decrypt message',
    suggestion: 'Message may not be encrypted for your key. Verify sender identity.',
    retryable: false
  },
  ENCRYPTION_FAILED: {
    code: 801,
    severity: ErrorSeverity.HIGH,
    category: ErrorCategory.PROTOCOL,
    message: 'Failed to encrypt message',
    suggestion: 'Verify recipient public key is correct.',
    retryable: true
  },

  // Internal errors (900-999)
  UNKNOWN_COMMAND: {
    code: 900,
    severity: ErrorSeverity.LOW,
    category: ErrorCategory.VALIDATION,
    message: 'Unknown command',
    suggestion: 'Use: agent-pulse help to see available commands.',
    retryable: false
  },
  INTERNAL_ERROR: {
    code: 901,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.INTERNAL,
    message: 'Internal error occurred',
    suggestion: 'This is a bug. Please report with reproduction steps.',
    retryable: false
  }
}

/**
 * Enhanced error class for agent-friendly error reporting
 */
export class AgentError extends Error {
  constructor(codeKey, details = {}, cause = null) {
    const errorDef = ErrorCodes[codeKey] || ErrorCodes.INTERNAL_ERROR

    super(errorDef.message)
    this.name = 'AgentError'
    this.code = errorDef.code
    this.codeKey = codeKey
    this.severity = errorDef.severity
    this.category = errorDef.category
    this.suggestion = errorDef.suggestion
    this.retryable = errorDef.retryable
    this.details = details
    this.cause = cause
    this.timestamp = Date.now()
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      ok: false,
      error: {
        code: this.code,
        codeKey: this.codeKey,
        message: this.message,
        suggestion: this.suggestion,
        severity: this.severity,
        category: this.category,
        retryable: this.retryable,
        details: this.details,
        timestamp: this.timestamp
      }
    }
  }

  /**
   * Get user-friendly string representation
   */
  toString() {
    let msg = `Error ${this.code}: ${this.message}`
    if (this.suggestion) {
      msg += `\n  Suggestion: ${this.suggestion}`
    }
    if (this.details && Object.keys(this.details).length > 0) {
      msg += `\n  Details: ${JSON.stringify(this.details)}`
    }
    return msg
  }
}

/**
 * Create an error response object
 * @param {string} codeKey - Error code key
 * @param {Object} details - Additional details
 * @returns {Object} Error response object
 */
export function createErrorResponse(codeKey, details = {}) {
  const errorDef = ErrorCodes[codeKey] || ErrorCodes.INTERNAL_ERROR
  return {
    ok: false,
    error: {
      code: errorDef.code,
      codeKey,
      message: errorDef.message,
      suggestion: errorDef.suggestion,
      severity: errorDef.severity,
      category: errorDef.category,
      retryable: errorDef.retryable,
      details,
      timestamp: Date.now()
    }
  }
}

/**
 * Create a success response object
 * @param {Object} data - Response data
 * @returns {Object} Success response object
 */
export function createSuccessResponse(data = {}) {
  return {
    ok: true,
    ...data,
    timestamp: Date.now()
  }
}

/**
 * Wrap a function with error handling
 * @param {Function} fn - Function to wrap
 * @param {string} errorKey - Error code key if function throws
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(fn, errorKey = ErrorCodes.INTERNAL_ERROR) {
  return async function(...args) {
    try {
      return await fn(...args)
    } catch (err) {
      if (err instanceof AgentError) {
        return err.toJSON()
      }
      const agentErr = new AgentError(errorKey, { originalError: err.message }, err)
      return agentErr.toJSON()
    }
  }
}

/**
 * Format error for logging
 * @param {Object} error - Error object
 * @returns {string} Formatted error string
 */
export function formatErrorForLog(error) {
  if (error instanceof AgentError) {
    return `[${error.severity.toUpperCase()}] ${error.code} ${error.codeKey}: ${error.message}`
  }
  return `ERROR: ${error?.message || String(error)}`
}

// Export legacy error code mapping for backward compatibility
export const LegacyErrorCodeMapping = {
  'OK': null,
  'SERVICE_NOT_RUNNING': 'SERVICE_NOT_RUNNING',
  'SERVICE_ALREADY_RUNNING': 'SERVICE_ALREADY_RUNNING',
  'SERVICE_START_FAILED': 'SERVICE_START_FAILED',
  'NETWORK_DISCONNECTED': 'NETWORK_DISCONNECTED',
  'NETWORK_SEND_FAILED': 'NETWORK_SEND_FAILED',
  'RELAY_ALL_FAILED': 'RELAY_ALL_FAILED',
  'INVALID_ARGS': 'INVALID_ARGS',
  'INVALID_PUBKEY': 'INVALID_PUBKEY',
  'INVALID_SIGNATURE': 'INVALID_SIGNATURE',
  'GROUP_NOT_FOUND': 'GROUP_NOT_FOUND',
  'GROUP_ALREADY_EXISTS': 'GROUP_ALREADY_EXISTS',
  'NOT_GROUP_OWNER': 'NOT_GROUP_OWNER',
  'MEMBER_NOT_FOUND': 'MEMBER_NOT_FOUND',
  'MEMBER_BANNED': 'MEMBER_BANNED',
  'MEMBER_MUTED': 'MEMBER_MUTED',
  'MESSAGE_EXPIRED': 'MESSAGE_EXPIRED',
  'MESSAGE_RETRY_EXHAUSTED': 'MESSAGE_RETRY_EXHAUSTED',
  'FILE_ERROR': 'FILE_ERROR',
  'UNKNOWN_COMMAND': 'UNKNOWN_COMMAND',
  'INTERNAL_ERROR': 'INTERNAL_ERROR'
}
