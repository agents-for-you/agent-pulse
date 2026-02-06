/**
 * Error formatting utilities
 */
import { ErrorCode } from '../../service/shared.js';
import { ErrorCodes } from '../../utils/error-reporter.js';

/**
 * Format error with enhanced reporting
 * @param {string} code - Error code
 * @param {string} error - Error message
 * @returns {Object} Enhanced error response with suggestions
 */
export function formatError(code, error) {
  // Map legacy error codes to new error reporter
  const errorKeyMap = {
    SERVICE_NOT_RUNNING: 'SERVICE_NOT_RUNNING',
    SERVICE_ALREADY_RUNNING: 'SERVICE_ALREADY_RUNNING',
    SERVICE_START_FAILED: 'SERVICE_START_FAILED',
    NETWORK_DISCONNECTED: 'NETWORK_DISCONNECTED',
    NETWORK_SEND_FAILED: 'NETWORK_SEND_FAILED',
    RELAY_ALL_FAILED: 'RELAY_ALL_FAILED',
    INVALID_ARGS: 'INVALID_ARGS',
    INVALID_PUBKEY: 'INVALID_PUBKEY',
    INVALID_SIGNATURE: 'INVALID_SIGNATURE',
    GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
    GROUP_ALREADY_EXISTS: 'GROUP_ALREADY_EXISTS',
    NOT_GROUP_OWNER: 'NOT_GROUP_OWNER',
    MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
    MEMBER_BANNED: 'MEMBER_BANNED',
    MEMBER_MUTED: 'MEMBER_MUTED',
    MESSAGE_EXPIRED: 'MESSAGE_EXPIRED',
    MESSAGE_RETRY_EXHAUSTED: 'MESSAGE_RETRY_EXHAUSTED',
    FILE_ERROR: 'FILE_ERROR',
    UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
  };

  const errorKey = errorKeyMap[code] || 'INTERNAL_ERROR';
  const errorDef = ErrorCodes[errorKey];

  const response = {
    ok: false,
    code: errorDef?.code || 901,
    codeKey: errorKey,
    error: error || errorDef?.message || 'Unknown error',
    suggestion: errorDef?.suggestion || null,
    severity: errorDef?.severity || 'medium',
    category: errorDef?.category || 'internal',
    retryable: errorDef?.retryable || false,
    timestamp: Date.now()
  };

  return response;
}
