#!/usr/bin/env node
/**
 * Agent P2P CLI - Minimalist design
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
  getMessageQueueStatus
} from './service/server.js';
import { loadOrCreateIdentity } from './core/identity.js';
import { ErrorCode } from './service/shared.js';

// JSON output
function out(data) {
  console.log(JSON.stringify(data));
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
        // Validate public key format (64-character hex)
        if (/^[0-9a-fA-F]{64}$/.test(next)) {
          options.from = next;
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
  async start() {
    const result = await start();
    out(result);
  },

  // Stop background service
  async stop() {
    const result = await stop();
    out(result);
  },

  // View service status (including health info)
  status() {
    out(getStatus());
  },

  // Get own public key
  me() {
    try {
      const identity = loadOrCreateIdentity();
      out({ ok: true, pubkey: identity.publicKey });
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

  // Send message: send <pubkey> <message>
  send(args) {
    const [target, ...rest] = args;
    const content = rest.join(' ');

    if (!target || !content) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: send <pubkey> <message>' });
      return;
    }

    out(sendMessage(target, content));
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
        start: 'Start background service',
        stop: 'Stop background service',
        status: 'View service status (including health info)',
        me: 'Get own public key',
        recv: 'recv [options] - Read messages (and clear queue)',
        peek: 'peek [options] - View messages (don\'t clear queue)',
        send: 'send <pubkey> <message> - Send encrypted message',
        result: 'result [cmdId] - Query send result',
        'queue-status': 'View message queue status (pending/retry messages)',
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

  // Kick member: group-kick <groupId> <pubkey>
  'group-kick'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-kick <groupId> <pubkey>' });
      return;
    }
    out(kickGroupMember(groupId, pubkey));
  },

  // Ban member: group-ban <groupId> <pubkey>
  'group-ban'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-ban <groupId> <pubkey>' });
      return;
    }
    out(banGroupMember(groupId, pubkey));
  },

  // Unban member: group-unban <groupId> <pubkey>
  'group-unban'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-unban <groupId> <pubkey>' });
      return;
    }
    out(unbanGroupMember(groupId, pubkey));
  },

  // Mute member: group-mute <groupId> <pubkey> [duration]
  'group-mute'(args) {
    const [groupId, pubkey, durationStr] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-mute <groupId> <pubkey> [duration]' });
      return;
    }
    const duration = durationStr ? parseInt(durationStr, 10) : 3600; // Default 1 hour
    out(muteGroupMember(groupId, pubkey, duration));
  },

  // Unmute member: group-unmute <groupId> <pubkey>
  'group-unmute'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-unmute <groupId> <pubkey>' });
      return;
    }
    out(unmuteGroupMember(groupId, pubkey));
  },

  // Set admin: group-admin <groupId> <pubkey> <true|false>
  'group-admin'(args) {
    const [groupId, pubkey, isAdminStr] = args;
    if (!groupId || !pubkey || !isAdminStr) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-admin <groupId> <pubkey> <true|false>' });
      return;
    }
    const isAdmin = isAdminStr === 'true';
    out(setGroupAdmin(groupId, pubkey, isAdmin));
  },

  // Transfer ownership: group-transfer <groupId> <pubkey>
  'group-transfer'(args) {
    const [groupId, pubkey] = args;
    if (!groupId || !pubkey) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: group-transfer <groupId> <pubkey>' });
      return;
    }
    out(transferGroupOwnership(groupId, pubkey));
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
