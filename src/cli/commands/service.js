/**
 * Service control commands: start, stop, status, me
 */
import {
  start,
  stop,
  getStatus
} from '../../service/server.js';
import { loadOrCreateIdentity, getIdentityPublicKeyNpub } from '../../core/identity.js';
import { ErrorCode } from '../../service/shared.js';
import { out, showProgress } from '../utils/output.js';
import { formatError } from '../utils/error-formatter.js';

export const commands = {
  // Start background service
  async start(args) {
    // Check for --ephemeral flag
    const ephemeral = args.includes('--ephemeral');
    const progress = showProgress('Starting AgentPulse service');
    try {
      const result = await start({ ephemeral });
      progress.stop(result.ok ? 'AgentPulse service started' : 'Failed to start service');
      out(result);
    } catch (err) {
      progress.stop('Service start failed');
      out(formatError(ErrorCode.INTERNAL_ERROR, err.message));
    }
  },

  // Stop background service
  async stop() {
    const progress = showProgress('Stopping AgentPulse service');
    try {
      const result = await stop();
      progress.stop(result.ok ? 'AgentPulse service stopped' : 'Failed to stop service');
      out(result);
    } catch (err) {
      progress.stop('Service stop failed');
      out(formatError(ErrorCode.INTERNAL_ERROR, err.message));
    }
  },

  // View service status (including health info)
  async status() {
    out(await getStatus());
  },

  // Get own public key (returns both hex and npub format)
  me() {
    try {
      const identity = loadOrCreateIdentity();
      const npub = getIdentityPublicKeyNpub(identity);
      out({ ok: true, pubkey: identity.publicKey, npub });
    } catch (err) {
      out({ ok: false, code: ErrorCode.INTERNAL_ERROR, error: err.message });
    }
  }
};
