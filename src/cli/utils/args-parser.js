/**
 * Argument parsing utilities
 */
import * as nip19 from '../../core/nip19.js';

/**
 * Normalize public key input - accepts npub, nsec, or hex format
 * @param {string} input - Public key (npub, hex, or nsec for private key operations)
 * @param {'public'|'private'} [keyType='public'] - Key type
 * @returns {string} Normalized hex public key
 */
export function normalizePubkey(input, keyType = 'public') {
  if (!input) return input;

  // Detect npub/nsec format using NIP-19
  if (input.startsWith('npub')) {
    if (keyType !== 'public') {
      throw new Error('Key type mismatch: npub is a public key format');
    }
    return nip19.decodePublicKey(input);
  }

  if (input.startsWith('nsec')) {
    if (keyType === 'public') {
      throw new Error('Key type mismatch: nsec is a private key format');
    }
    // For nsec, we need to derive the public key
    // This is handled by the identity module
    throw new Error('nsec format not supported for this command');
  }

  // Assume hex format (will be validated by downstream functions)
  return input;
}

/**
 * Parse message filter options (with input validation)
 * @param {string[]} args - Command arguments
 * @returns {Object} Parsed options
 */
export function parseMessageOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    // Validate option value exists
    if (['--from', '--since', '--until', '--search', '--limit', '--offset'].includes(arg)) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        // Option missing value, skip
        continue;
      }
    }

    switch (arg) {
      case '--from':
        // Accept npub or hex format
        try {
          options.from = normalizePubkey(next, 'public');
        } catch {
          // Invalid format, skip
        }
        i++;
        break;
      case '--since': {
        const val = parseInt(next, 10);
        if (!isNaN(val) && val > 0) {
          options.since = val;
        }
        i++;
        break;
      }
      case '--until': {
        const val = parseInt(next, 10);
        if (!isNaN(val) && val > 0) {
          options.until = val;
        }
        i++;
        break;
      }
      case '--search':
        // Limit search string length
        if (next && next.length <= 500) {
          options.search = next;
        }
        i++;
        break;
      case '--limit': {
        const val = parseInt(next, 10);
        if (!isNaN(val) && val > 0 && val <= 10000) {
          options.limit = val;
        }
        i++;
        break;
      }
      case '--offset': {
        const val = parseInt(next, 10);
        if (!isNaN(val) && val >= 0) {
          options.offset = val;
        }
        i++;
        break;
      }
      case '--group':
        options.isGroup = true;
        break;
    }
  }
  return options;
}

/**
 * Parse timeout option from args
 * @param {string[]} args - Command arguments
 * @param {number} [defaultTimeout=5000] - Default timeout in ms
 * @returns {number} Parsed timeout value
 */
export function parseTimeout(args, defaultTimeout = 5000) {
  let timeout = defaultTimeout;
  const timeoutIndex = args.indexOf('--timeout');
  if (timeoutIndex !== -1 && args[timeoutIndex + 1]) {
    const parsed = parseInt(args[timeoutIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      timeout = parsed;
    }
  }
  return timeout;
}
