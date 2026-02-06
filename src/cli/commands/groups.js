/**
 * Group management commands: groups, group-*
 */
import {
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
  sendGroupMessage
} from '../../service/server.js';
import { ErrorCode } from '../../service/shared.js';
import { out } from '../utils/output.js';
import { normalizePubkey } from '../utils/args-parser.js';

export const commands = {
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
  }
};
