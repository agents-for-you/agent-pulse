#!/usr/bin/env node
/**
 * AgentPulse CLI - Minimalist design
 * All outputs are JSON format for easy Agent parsing
 */
import {
  start,
  stop,
  getStatus,
  readMessages,
  sendMessage,
  getSendResult,
  readResults,
  isRunning,
  createGroup,
  joinGroup,
  leaveGroup,
  listGroups,
  getGroupMembers,
  kickGroupMember,
  banGroupMember,
  unbanGroupMember,
  muteGroupMember,
  unmuteGroupMember,
  setGroupAdmin,
  transferGroupOwnership,
  getGroupHistory,
  sendGroupMessage,
  getMessageQueueStatus,
  getRelayStatus,
  getRelayHealth,
  recoverRelay,
  blacklistRelay
} from './service/server.js';
import { loadOrCreateIdentity, getIdentityPublicKeyNpub } from './core/identity.js';
import { ErrorCode, createErrorResponseFromCode, ErrorCodes, createErrorResponse, createSuccessResponse } from './service/shared.js';
import { getContacts } from './service/contacts.js';
import * as nip19 from './core/nip19.js';
import * as updater from './utils/updater.js';
import { compressIfNeeded, decodeCompressed } from './utils/performance.js';

// JSON output
function out(data) {
  console.log(JSON.stringify(data));
}

/**
 * Progress indicator for long-running operations
 * @param {string} message - Progress message
 * @returns {Object} Progress controller
 */
function showProgress(message) {
  let dots = 0;
  const interval = setInterval(() => {
    dots = (dots + 1) % 4;
    process.stderr.write(`\r${message}${'.'.repeat(dots)}${' '.repeat(3 - dots)}`);
  }, 200);

  return {
    stop: (finalMessage) => {
      clearInterval(interval);
      process.stderr.write(`\r${finalMessage || message}\n`);
    }
  };
}

/**
 * Format error with enhanced reporting
 * @param {string} code - Error code (from ErrorCode enum)
 * @param {string} error - Error message
 * @returns {Object} Enhanced error response with suggestions
 */
function formatError(code, error) {
  return createErrorResponseFromCode(code, error);
}

/**
 * Normalize public key input - accepts npub, nsec, or hex format
 * @param {string} input - Public key (npub, hex, or nsec for private key operations)
 * @param {'public'|'private'} [keyType='public'] - Key type
 * @returns {string} Normalized hex public key
 */
function normalizePubkey(input, keyType = 'public') {
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

// Parse message filter options (with input validation)
function parseMessageOptions(args) {
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

// Command definitions
const commands = {
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
  status() {
    out(getStatus());
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
  },

  // Read messages (and clear) - supports filter options
  recv(args) {
    const options = parseMessageOptions(args);
    const messages = readMessages(true, options);
    out({ ok: true, count: messages.length, messages });
  },

  // View messages (don't clear) - supports filter options
  peek(args) {
    const options = parseMessageOptions(args);
    const messages = readMessages(false, options);
    out({ ok: true, count: messages.length, messages });
  },

  // Watch for new messages in real-time (streaming JSON lines)
  async watch(args) {
    const options = parseMessageOptions(args);

    // Parse watch-specific options
    let count = 0;
    let maxCount = Infinity;
    const countIndex = args.indexOf('--count');
    if (countIndex !== -1 && args[countIndex + 1]) {
      maxCount = parseInt(args[countIndex + 1], 10) || Infinity;
    }

    // Ensure service is running
    const { isRunning: runningCheck, start } = await import('./service/server.js');
    if (!runningCheck()) {
      const progress = showProgress('Starting service for watch mode');
      const started = await start();
      progress.stop(started.ok ? 'Service started' : 'Failed to start');
      if (!started.ok) {
        out(started);
        return;
      }
      // Wait for service to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    out({ ok: true, watching: true, message: 'Streaming messages (Ctrl+C to stop)...' });

    // Poll for new messages
    const interval = setInterval(async () => {
      const messages = readMessages(false, options);
      if (messages.length > 0) {
        for (const msg of messages) {
          count++;
          if (count <= maxCount) {
            // Output as JSON lines for streaming
            console.log(JSON.stringify({ ...msg, _stream: true }));
          }
        }
        // Clear after processing
        readMessages(true, options);

        if (count >= maxCount) {
          clearInterval(interval);
          console.log(JSON.stringify({ _done: true, totalProcessed: count }));
          process.exit(0);
        }
      }
    }, 1000);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(JSON.stringify({ _done: true, totalProcessed: count }));
      process.exit(0);
    });
  },

  // Send message: send <pubkey|npub|@alias> <message>
  async send(args) {
    const [target, ...rest] = args;
    const content = rest.join(' ');

    if (!target || !content) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: send <pubkey|npub|@alias> <message>' });
      return;
    }

    try {
      let normalizedTarget = target;

      // Handle @alias syntax
      if (target.startsWith('@')) {
        const alias = target.slice(1);
        const contacts = getContacts();
        const contact = contacts.get(alias);

        if (!contact) {
          out({ ok: false, code: ErrorCode.INVALID_ARGS, error: `Contact not found: @${alias}` });
          return;
        }

        normalizedTarget = contact.npub || contact.pubkey;
        // Update last used timestamp
        contacts.touch(alias);
      } else {
        normalizedTarget = normalizePubkey(target, 'public');
      }

      const result = await sendMessage(normalizedTarget, content, { autoStart: true });
      out(result);
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Query send result: result <cmdId>
  result(args) {
    const [cmdId] = args;

    if (cmdId) {
      const result = getSendResult(cmdId);
      out(result || { ok: false, code: 'NOT_FOUND' });
    } else {
      // Read all results
      const results = readResults(true);
      out({ ok: true, count: results.length, results });
    }
  },

  // Help
  help() {
    out({
      commands: {
        start: 'start [--ephemeral] - Start background service (use --ephemeral for temporary keys)',
        stop: 'Stop background service',
        status: 'View service status (including health info)',
        me: 'Get own public key (hex + npub format)',
        recv: 'recv [options] - Read messages (and clear queue)',
        peek: 'peek [options] - View messages (don\'t clear queue)',
        watch: 'watch [options] [--count N] - Stream messages in real-time',
        send: 'send <pubkey|npub|@alias> <message> - Send encrypted message',
        result: 'result [cmdId] - Query send result',
        'queue-status': 'View message queue status (pending/retry messages)',
        'relay-status': 'relay-status [--timeout ms] - Check relay connection status with latency',
        'check-update': 'Check for available updates',
        'update': 'update [--check] [--force] - Update to latest version',
        // Contacts commands
        contacts: 'List all contacts',
        'contacts-add': 'contacts-add <alias> <npub|hex> [name] [notes...] - Add/update contact',
        'contacts-remove': 'contacts-remove <alias> - Remove contact',
        'contacts-get': 'contacts-get <alias> - Get contact details',
        'contacts-export': 'contacts-export [file] - Export contacts (JSON)',
        'contacts-import': 'contacts-import <file> - Import contacts from file',
        'contacts-find': 'contacts-find <npub|hex> - Find contact by public key',
        // Group commands
        groups: 'List all groups',
        'group-create': 'group-create <name> - Create group',
        'group-join': 'group-join <groupId> <topic> [name] - Join group',
        'group-leave': 'group-leave <groupId> - Leave group',
        'group-send': 'group-send <groupId> <message> - Send group message',
        'group-members': 'group-members <groupId> - View group members',
        'group-kick': 'group-kick <groupId> <pubkey> - Kick member (requires admin permission)',
        'group-ban': 'group-ban <groupId> <pubkey> - Ban member',
        'group-unban': 'group-unban <groupId> <pubkey> - Unban member',
        'group-mute': 'group-mute <groupId> <pubkey> [duration] - Mute member (seconds)',
        'group-unmute': 'group-unmute <groupId> <pubkey> - Unmute member',
        'group-admin': 'group-admin <groupId> <pubkey> <true|false> - Set admin',
        'group-transfer': 'group-transfer <groupId> <pubkey> - Transfer ownership',
        'group-history': 'group-history <groupId> [limit] - View group message history'
      },
      messageOptions: {
        '--from': 'Filter by sender public key',
        '--since': 'Start timestamp (seconds)',
        '--until': 'End timestamp (seconds)',
        '--search': 'Search message content',
        '--limit': 'Return count limit',
        '--offset': 'Pagination offset',
        '--group': 'Only show group messages'
      },
      errorCodes: Object.keys(ErrorCode)
    });
  },

  // ============ Group commands ============

  // List groups
  groups() {
    out(listGroups());
  },

  // Create group: group-create <name>
  'group-create'(args) {
    const [name] = args;
    if (!name) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-create <name>' });
      return;
    }
    out(createGroup(name));
  },

  // Join group: group-join <groupId> <topic> [name]
  'group-join'(args) {
    const [groupId, topic, ...nameParts] = args;
    if (!groupId || !topic) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-join <groupId> <topic> [name]' });
      return;
    }
    out(joinGroup(groupId, topic, nameParts.join(' ') || ''));
  },

  // Leave group: group-leave <groupId>
  'group-leave'(args) {
    const [groupId] = args;
    if (!groupId) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-leave <groupId>' });
      return;
    }
    out(leaveGroup(groupId));
  },

  // Send group message: group-send <groupId> <message>
  'group-send'(args) {
    const [groupId, ...rest] = args;
    const content = rest.join(' ');
    if (!groupId || !content) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-send <groupId> <message>' });
      return;
    }
    out(sendGroupMessage(groupId, content));
  },

  // View group members: group-members <groupId>
  'group-members'(args) {
    const [groupId] = args;
    if (!groupId) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-members <groupId>' });
      return;
    }
    out(getGroupMembers(groupId));
  },

  // Kick member: group-kick <groupId> <pubkey|npub>
  'group-kick'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-kick <groupId> <pubkey|npub>' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      out(kickGroupMember(groupId, normalizedPubkey));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Ban member: group-ban <groupId> <pubkey|npub>
  'group-ban'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-ban <groupId> <pubkey|npub>' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      out(banGroupMember(groupId, normalizedPubkey));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Unban member: group-unban <groupId> <pubkey|npub>
  'group-unban'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-unban <groupId> <pubkey|npub>' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      out(unbanGroupMember(groupId, normalizedPubkey));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Mute member: group-mute <groupId> <pubkey|npub> [duration]
  'group-mute'(args) {
    const [groupId, pubkey, durationStr] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-mute <groupId> <pubkey|npub> [duration]' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      const duration = durationStr ? parseInt(durationStr, 10) : 3600; // Default 1 hour
      out(muteGroupMember(groupId, normalizedPubkey, duration));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Unmute member: group-unmute <groupId> <pubkey|npub>
  'group-unmute'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-unmute <groupId> <pubkey|npub>' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      out(unmuteGroupMember(groupId, normalizedPubkey));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Set admin: group-admin <groupId> <pubkey|npub> <true|false>
  'group-admin'(args) {
    const [groupId, pubkey, isAdminStr] = args;
    if (!groupId || !pubkey || !isAdminStr) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-admin <groupId> <pubkey|npub> <true|false>' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      const isAdmin = isAdminStr === 'true';
      out(setGroupAdmin(groupId, normalizedPubkey, isAdmin));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Transfer ownership: group-transfer <groupId> <pubkey|npub>
  'group-transfer'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-transfer <groupId> <pubkey|npub>' });
      return;
    }
    try {
      const normalizedPubkey = normalizePubkey(pubkey, 'public');
      out(transferGroupOwnership(groupId, normalizedPubkey));
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // View group message history: group-history <groupId> [limit]
  'group-history'(args) {
    const [groupId, limitStr] = args;
    if (!groupId) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-history <groupId> [limit]' });
      return;
    }
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    out(getGroupHistory(groupId, limit));
  },

  // View message queue status
  'queue-status'() {
    out(getMessageQueueStatus());
  },

  // ============ Relay status ============

  // Check relay connection status with latency
  async 'relay-status'(args) {
    // Parse timeout option
    let timeout = 5000;
    const timeoutIndex = args.indexOf('--timeout');
    if (timeoutIndex !== -1 && args[timeoutIndex + 1]) {
      const parsed = parseInt(args[timeoutIndex + 1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        timeout = parsed;
      }
    }

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

  // ============ Relay management commands ============

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
  },

  // ============ Update command ============

  // Check for updates
  async 'check-update'() {
    try {
      const status = await updater.checkForUpdates();

      if (!status.ok) {
        out({
          ok: false,
          error: status.error,
          suggestion: 'Check your internet connection'
        });
        return;
      }

      out({
        ok: true,
        current: status.current,
        latest: status.latest,
        updateAvailable: status.updateAvailable,
        message: updater.formatUpdateStatus(status)
      });
    } catch (err) {
      out({ ok: false, error: err.message });
    }
  },

  // Update to latest version
  async 'update'(args) {
    const force = args.includes('--force');
    const checkOnly = args.includes('--check');

    if (checkOnly) {
      try {
        const status = await updater.checkForUpdates();
        out(status);
      } catch (err) {
        out({ ok: false, error: err.message });
      }
      return;
    }

    const progress = showProgress('Checking for updates');
    try {
      const onProgress = (type, msg) => {
        if (type === 'info') {
          progress.stop(msg);
          // Start new progress
          progress.interval = setInterval(() => {
            process.stderr.write(`.`);
          }, 200);
        }
      };

      const result = await updater.performUpdate({ force, onProgress });

      if (result.updated) {
        progress.stop(`Updated: ${result.message}`);
      } else if (result.alreadyUpToDate) {
        progress.stop(result.message);
      } else {
        progress.stop('Update failed');
      }

      out(result);
    } catch (err) {
      progress.stop('Update failed');
      out({ ok: false, error: err.message });
    }
  },

  // ============ Contacts commands ============

  // List all contacts
  contacts() {
    const contacts = getContacts();
    const list = contacts.list();
    out({ ok: true, count: list.length, contacts: list });
  },

  // Add contact: contacts-add <alias> <npub|hex> [name] [notes...]
  'contacts-add'(args) {
    const [alias, npub, ...rest] = args;

    if (!alias || !npub) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-add <alias> <npub|hex> [name] [notes...]'
      });
      return;
    }

    // Split name and notes (name is first word after npub, rest are notes)
    let name = '';
    let notes = '';
    if (rest.length > 0) {
      // Check if the first arg looks like the start of notes (contains spaces or special chars)
      // For simplicity, if there are multiple args, first is name, rest are notes
      name = rest[0] || '';
      if (rest.length > 1) {
        notes = rest.slice(1).join(' ');
      }
    }

    const contacts = getContacts();
    const result = contacts.add(alias, { npub, name, notes });
    out(result);
  },

  // Remove contact: contacts-remove <alias>
  'contacts-remove'(args) {
    const [alias] = args;

    if (!alias) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-remove <alias>'
      });
      return;
    }

    const contacts = getContacts();
    const result = contacts.remove(alias);
    out(result);
  },

  // Get contact: contacts-get <alias>
  'contacts-get'(args) {
    const [alias] = args;

    if (!alias) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-get <alias>'
      });
      return;
    }

    const contacts = getContacts();
    const contact = contacts.get(alias);

    if (!contact) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: `Contact not found: ${alias}`
      });
      return;
    }

    out({ ok: true, alias, contact });
  },

  // Export contacts: contacts-export [file]
  async 'contacts-export'(args) {
    const [file] = args;
    const contacts = getContacts();
    const data = contacts.export();

    if (file) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const fullPath = path.resolve(file);
        await fs.promises.writeFile(fullPath, JSON.stringify(data, null, 2));
        out({
          ok: true,
          exported: data,
          file: fullPath,
          count: Object.keys(data).length
        });
      } catch (err) {
        out({
          ok: false,
          code: ErrorCode.FILE_ERROR,
          error: err.message
        });
      }
    } else {
      out({ ok: true, contacts: data, count: Object.keys(data).length });
    }
  },

  // Import contacts: contacts-import <file>
  async 'contacts-import'(args) {
    const [file] = args;

    if (!file) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-import <file>'
      });
      return;
    }

    try {
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.resolve(file);
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const data = JSON.parse(content);

      const contacts = getContacts();
      const result = contacts.import(data);
      out(result);
    } catch (err) {
      out({
        ok: false,
        code: ErrorCode.FILE_ERROR,
        error: err.message
      });
    }
  },

  // Find contact by pubkey: contacts-find <npub|hex>
  'contacts-find'(args) {
    const [pubkey] = args;

    if (!pubkey) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-find <npub|hex>'
      });
      return;
    }

    const contacts = getContacts();
    const result = contacts.getByPubkey(pubkey);

    if (!result) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: `No contact found with pubkey: ${pubkey.slice(0, 16)}...`
      });
      return;
    }

    out({ ok: true, alias: result.alias, contact: result.contact });
  }
};

// Main function
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    commands.help();
    process.exit(0);
  }

  if (commands[cmd]) {
    try {
      await commands[cmd](args);
    } catch (err) {
      // Distinguish different error types for debugging
      let errorCode = ErrorCode.INTERNAL_ERROR;
      let errorMsg = err.message;

      // Distinguish by error type
      if (err.name === 'TypeError') {
        errorCode = 'TYPE_ERROR';
      } else if (err.code === 'ENOENT') {
        errorCode = ErrorCode.FILE_ERROR;
      } else if (err.message.includes('ECONNREFUSED')) {
        errorCode = ErrorCode.NETWORK_DISCONNECTED;
      }

      out({ ok: false, code: errorCode, error: errorMsg });
    }
  } else {
    out({ ok: false, code: ErrorCode.UNKNOWN_COMMAND, error: `unknown: ${cmd}` });
  }

  process.exit(0);
}

main();
