/**
 * Relay management commands: relay-status, relay-health, relay-recover, relay-blacklist, queue-status
 */
import {
  getMessageQueueStatus,
  getRelayStatus,
  getRelayHealth,
  recoverRelay,
  blacklistRelay
} from '../../service/server.js';
import { ErrorCode } from '../../service/shared.js';
import { out, showProgress } from '../utils/output.js';
import { formatError } from '../utils/error-formatter.js';
import { parseTimeout } from '../utils/args-parser.js';

export const commands = {
  // View message queue status
  'queue-status'() {
    out(getMessageQueueStatus());
  },

  // Check relay connection status with latency
  async 'relay-status'(args) {
    const timeout = parseTimeout(args, 5000);

    const progress = showProgress('Checking relay connections');
    try {
      const result = await getRelayStatus({ timeout });
      const connected = result.summary?.connected || 0;
      progress.stop(`Relay status: ${connected}/${result.summary?.total || 0} connected`);
      out(result);
    } catch (err) {
      progress.stop('Relay check failed');
      out(formatError(ErrorCode.INTERNAL_ERROR, err.message));
    }
  },

  // Get detailed relay health information
  async 'relay-health'() {
    try {
      const result = await getRelayHealth();
      out(result);
    } catch (err) {
      out(formatError(ErrorCode.INTERNAL_ERROR, err.message));
    }
  },

  // Recover blacklisted relay
  async 'relay-recover'(args) {
    const relay = args[0];
    if (!relay) {
      out({
        ok: false,
        code: 600,
        error: 'Relay URL required',
        suggestion: 'Usage: agent-pulse relay-recover <relay-url>'
      });
      return;
    }

    try {
      const result = await recoverRelay(relay);
      out(result);
    } catch (err) {
      out(formatError(ErrorCode.INTERNAL_ERROR, err.message));
    }
  },

  // Blacklist a relay manually
  async 'relay-blacklist'(args) {
    const relay = args[0];
    if (!relay) {
      out({
        ok: false,
        code: 600,
        error: 'Relay URL required',
        suggestion: 'Usage: agent-pulse relay-blacklist <relay-url>'
      });
      return;
    }

    try {
      const result = await blacklistRelay(relay);
      out(result);
    } catch (err) {
      out(formatError(ErrorCode.INTERNAL_ERROR, err.message));
    }
  }
};
