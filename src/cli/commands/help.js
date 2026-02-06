/**
 * Help command
 */
import { ErrorCode } from '../../service/shared.js';
import { out } from '../utils/output.js';

export function help() {
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
}
