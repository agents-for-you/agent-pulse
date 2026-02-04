/**
 * @fileoverview Enhanced group management module
 * Member management, permission control, history sync
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  GROUPS_FILE, GROUP_HISTORY_DIR, CONFIG, ErrorCode,
  ensureDataDir, atomicWriteFileSync, generateId
} from '../service/shared.js';
import { logger } from '../utils/logger.js';

const log = logger.child('group-manager');

/**
 * @typedef {Object} GroupMember
 * @property {string} pubkey - Member public key
 * @property {string} role - Role (owner|admin|member)
 * @property {number} joinedAt - Join time
 * @property {number} lastSeen - Last active time
 * @property {boolean} isMuted - Whether muted
 * @property {number} [mutedUntil] - Mute expiration time
 * @property {boolean} isBanned - Whether banned
 */

/**
 * @typedef {Object} Group
 * @property {string} id - Group ID
 * @property {string} name - Group name
 * @property {string} topic - Nostr topic
 * @property {string} owner - Group owner public key
 * @property {Object<string, GroupMember>} members - Member list
 * @property {number} createdAt - Creation time
 * @property {Object} settings - Group settings
 */

/**
 * Group manager
 */
export class GroupManager {
  constructor() {
    this.groups = {};
    this._load();
  }

  /**
   * Load group data
   */
  _load() {
    ensureDataDir();

    try {
      if (fs.existsSync(GROUPS_FILE)) {
        const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
        this.groups = data.groups || {};

        // Migrate old format
        for (const [id, group] of Object.entries(this.groups)) {
          if (!group.members) {
            group.members = {};
          }
          if (!group.owner && group.createdBy) {
            group.owner = group.createdBy;
          }
        }
      }
    } catch (err) {
      log.error('Failed to load groups', { error: err.message });
    }
  }

  /**
   * Save group data
   */
  _save() {
    try {
      atomicWriteFileSync(GROUPS_FILE, JSON.stringify({ groups: this.groups }, null, 2));
    } catch (err) {
      log.error('Failed to save groups', { error: err.message });
    }
  }

  /**
   * Create group
   * @param {string} name - Group name
   * @param {string} ownerPubkey - Group owner public key
   * @returns {Object} Creation result
   */
  createGroup(name, ownerPubkey) {
    if (!name || name.length < 2) {
      return { ok: false, code: ErrorCode.INVALID_ARGS, error: 'name too short' };
    }

    const groupId = generateId();
    const topic = `group-${groupId}`;

    const group = {
      id: groupId,
      name,
      topic,
      owner: ownerPubkey,
      members: {
        [ownerPubkey]: {
          pubkey: ownerPubkey,
          role: 'owner',
          joinedAt: Date.now(),
          lastSeen: Date.now(),
          isMuted: false,
          isBanned: false
        }
      },
      createdAt: Date.now(),
      settings: {
        isPublic: false,
        allowInvite: true,
        historyVisible: true
      }
    };

    this.groups[groupId] = group;
    this._save();

    log.info('Group created', { groupId, name, owner: ownerPubkey.slice(0, 16) });
    return { ok: true, groupId, topic };
  }

  /**
   * Join group
   * @param {string} groupId - Group ID
   * @param {string} topic - Group topic
   * @param {string} pubkey - Member public key
   * @param {string} [name] - Group name
   * @returns {Object} Join result
   */
  joinGroup(groupId, topic, pubkey, name = '') {
    if (!groupId || !topic) {
      return { ok: false, code: ErrorCode.INVALID_ARGS };
    }

    let group = this.groups[groupId];

    if (!group) {
      // Create new group record (invited join)
      group = {
        id: groupId,
        name: name || `Group ${groupId.slice(0, 6)}`,
        topic,
        owner: null, // Unknown owner
        members: {},
        createdAt: Date.now(),
        settings: {
          isPublic: false,
          allowInvite: true,
          historyVisible: true
        }
      };
      this.groups[groupId] = group;
    }

    // Check if banned
    const existingMember = group.members[pubkey];
    if (existingMember?.isBanned) {
      return { ok: false, code: ErrorCode.MEMBER_BANNED };
    }

    // Add/update member
    group.members[pubkey] = {
      pubkey,
      role: existingMember?.role || 'member',
      joinedAt: existingMember?.joinedAt || Date.now(),
      lastSeen: Date.now(),
      isMuted: existingMember?.isMuted || false,
      isBanned: false
    };

    this._save();
    log.info('Member joined group', { groupId, pubkey: pubkey.slice(0, 16) });
    return { ok: true, groupId };
  }

  /**
   * Leave group
   * @param {string} groupId - Group ID
   * @param {string} pubkey - Member public key
   * @returns {Object} Leave result
   */
  leaveGroup(groupId, pubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    // Owner cannot leave directly, need to transfer first
    if (group.owner === pubkey) {
      const otherMembers = Object.keys(group.members).filter(k => k !== pubkey);
      if (otherMembers.length > 0) {
        return { ok: false, code: ErrorCode.NOT_GROUP_OWNER, error: 'Transfer ownership first' };
      }
      // Last person, delete group
      delete this.groups[groupId];
    } else {
      delete group.members[pubkey];
    }

    this._save();
    log.info('Member left group', { groupId, pubkey: pubkey.slice(0, 16) });
    return { ok: true };
  }

  /**
   * Get group
   * @param {string} groupId - Group ID
   * @returns {Group|null}
   */
  getGroup(groupId) {
    return this.groups[groupId] || null;
  }

  /**
   * List all groups
   * @returns {Object} Group list
   */
  listGroups() {
    const result = {};
    for (const [id, group] of Object.entries(this.groups)) {
      result[id] = {
        name: group.name,
        topic: group.topic,
        owner: group.owner,
        memberCount: Object.keys(group.members).length,
        createdAt: group.createdAt
      };
    }
    return { ok: true, groups: result };
  }

  /**
   * Get group member list
   * @param {string} groupId - Group ID
   * @returns {Object} Member list
   */
  getMembers(groupId) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    const now = Date.now();
    const members = Object.values(group.members).map(m => ({
      pubkey: m.pubkey,
      role: m.role,
      joinedAt: m.joinedAt,
      lastSeen: m.lastSeen,
      isOnline: now - m.lastSeen < CONFIG.MEMBER_ACTIVITY_TIMEOUT,
      isMuted: m.isMuted && (!m.mutedUntil || m.mutedUntil > now),
      isBanned: m.isBanned
    }));

    return {
      ok: true,
      groupId,
      owner: group.owner,
      memberCount: members.length,
      members
    };
  }

  /**
   * Update member activity time
   * @param {string} groupId - Group ID
   * @param {string} pubkey - Member public key
   */
  updateMemberActivity(groupId, pubkey) {
    const group = this.groups[groupId];
    if (group?.members[pubkey]) {
      group.members[pubkey].lastSeen = Date.now();
      // Don't save immediately, reduce I/O
    }
  }

  // ============ Owner permissions ============

  /**
   * Check if has admin permission
   * @param {string} groupId - Group ID
   * @param {string} pubkey - Operator public key
   * @returns {boolean}
   */
  hasAdminPermission(groupId, pubkey) {
    const group = this.groups[groupId];
    if (!group) return false;

    const member = group.members[pubkey];
    return member && (member.role === 'owner' || member.role === 'admin');
  }

  /**
   * Kick member
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Operator public key
   * @param {string} targetPubkey - Target member public key
   * @returns {Object}
   */
  kickMember(groupId, operatorPubkey, targetPubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    if (!this.hasAdminPermission(groupId, operatorPubkey)) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (!group.members[targetPubkey]) {
      return { ok: false, code: ErrorCode.MEMBER_NOT_FOUND };
    }

    // Cannot kick owner
    if (group.owner === targetPubkey) {
      return { ok: false, code: ErrorCode.INVALID_ARGS, error: 'Cannot kick owner' };
    }

    delete group.members[targetPubkey];
    this._save();

    log.info('Member kicked', { groupId, target: targetPubkey.slice(0, 16), by: operatorPubkey.slice(0, 16) });
    return { ok: true };
  }

  /**
   * Ban member
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Operator public key
   * @param {string} targetPubkey - Target member public key
   * @returns {Object}
   */
  banMember(groupId, operatorPubkey, targetPubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    if (!this.hasAdminPermission(groupId, operatorPubkey)) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (group.owner === targetPubkey) {
      return { ok: false, code: ErrorCode.INVALID_ARGS, error: 'Cannot ban owner' };
    }

    // Create or update member record
    if (!group.members[targetPubkey]) {
      group.members[targetPubkey] = {
        pubkey: targetPubkey,
        role: 'member',
        joinedAt: Date.now(),
        lastSeen: 0,
        isMuted: false,
        isBanned: true
      };
    } else {
      group.members[targetPubkey].isBanned = true;
    }

    this._save();
    log.info('Member banned', { groupId, target: targetPubkey.slice(0, 16) });
    return { ok: true };
  }

  /**
   * Unban member
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Operator public key
   * @param {string} targetPubkey - Target member public key
   * @returns {Object}
   */
  unbanMember(groupId, operatorPubkey, targetPubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    if (!this.hasAdminPermission(groupId, operatorPubkey)) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (group.members[targetPubkey]) {
      group.members[targetPubkey].isBanned = false;
      this._save();
    }

    return { ok: true };
  }

  /**
   * Mute member
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Operator public key
   * @param {string} targetPubkey - Target member public key
   * @param {number} [duration] - Mute duration (ms), 0 means permanent
   * @returns {Object}
   */
  muteMember(groupId, operatorPubkey, targetPubkey, duration = 0) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    if (!this.hasAdminPermission(groupId, operatorPubkey)) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (!group.members[targetPubkey]) {
      return { ok: false, code: ErrorCode.MEMBER_NOT_FOUND };
    }

    if (group.owner === targetPubkey) {
      return { ok: false, code: ErrorCode.INVALID_ARGS, error: 'Cannot mute owner' };
    }

    group.members[targetPubkey].isMuted = true;
    group.members[targetPubkey].mutedUntil = duration > 0 ? Date.now() + duration : 0;

    this._save();
    log.info('Member muted', { groupId, target: targetPubkey.slice(0, 16), duration });
    return { ok: true };
  }

  /**
   * Unmute member
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Operator public key
   * @param {string} targetPubkey - Target member public key
   * @returns {Object}
   */
  unmuteMember(groupId, operatorPubkey, targetPubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    if (!this.hasAdminPermission(groupId, operatorPubkey)) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (group.members[targetPubkey]) {
      group.members[targetPubkey].isMuted = false;
      group.members[targetPubkey].mutedUntil = 0;
      this._save();
    }

    return { ok: true };
  }

  /**
   * Set admin
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Operator public key (must be owner)
   * @param {string} targetPubkey - Target member public key
   * @param {boolean} isAdmin - Whether to set as admin
   * @returns {Object}
   */
  setAdmin(groupId, operatorPubkey, targetPubkey, isAdmin) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    // Only owner can set admin
    if (group.owner !== operatorPubkey) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (!group.members[targetPubkey]) {
      return { ok: false, code: ErrorCode.MEMBER_NOT_FOUND };
    }

    group.members[targetPubkey].role = isAdmin ? 'admin' : 'member';
    this._save();

    log.info('Admin status changed', { groupId, target: targetPubkey.slice(0, 16), isAdmin });
    return { ok: true };
  }

  /**
   * Transfer ownership
   * @param {string} groupId - Group ID
   * @param {string} operatorPubkey - Current owner public key
   * @param {string} newOwnerPubkey - New owner public key
   * @returns {Object}
   */
  transferOwnership(groupId, operatorPubkey, newOwnerPubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    if (group.owner !== operatorPubkey) {
      return { ok: false, code: ErrorCode.NOT_GROUP_OWNER };
    }

    if (!group.members[newOwnerPubkey]) {
      return { ok: false, code: ErrorCode.MEMBER_NOT_FOUND };
    }

    // Update roles
    group.members[operatorPubkey].role = 'admin';
    group.members[newOwnerPubkey].role = 'owner';
    group.owner = newOwnerPubkey;

    this._save();
    log.info('Ownership transferred', { groupId, from: operatorPubkey.slice(0, 16), to: newOwnerPubkey.slice(0, 16) });
    return { ok: true };
  }

  // ============ Message history ============

  /**
   * Save group message to history
   * @param {string} groupId - Group ID
   * @param {Object} message - Message object
   */
  saveMessageToHistory(groupId, message) {
    try {
      const historyDir = GROUP_HISTORY_DIR;
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }

      const historyFile = path.join(historyDir, `${groupId}.jsonl`);
      fs.appendFileSync(historyFile, JSON.stringify({
        ...message,
        savedAt: Date.now()
      }) + '\n');
    } catch (err) {
      log.error('Failed to save message to history', { groupId, error: err.message });
    }
  }

  /**
   * Get group message history
   * @param {string} groupId - Group ID
   * @param {Object} options - Query options
   * @returns {Object}
   */
  getMessageHistory(groupId, options = {}) {
    const { limit = CONFIG.GROUP_HISTORY_LIMIT, before, after } = options;

    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    // Validate groupId format, prevent path traversal attack
    if (!/^[a-zA-Z0-9_-]+$/.test(groupId)) {
      return { ok: false, code: ErrorCode.INVALID_ARGS, error: 'Invalid group ID format' };
    }

    // Use path.join and verify result is within data directory
    const historyFile = path.join(GROUP_HISTORY_DIR, `${groupId}.jsonl`);

    // Verify path hasn't escaped data directory
    const resolvedPath = path.resolve(historyFile);
    const resolvedDir = path.resolve(GROUP_HISTORY_DIR);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      return { ok: false, code: ErrorCode.INVALID_ARGS, error: 'Path traversal detected' };
    }

    if (!fs.existsSync(historyFile)) {
      return { ok: true, messages: [] };
    }

    try {
      const content = fs.readFileSync(historyFile, 'utf8').trim();
      if (!content) return { ok: true, messages: [] };

      let messages = content.split('\n')
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);

      // Time filter
      if (before) {
        messages = messages.filter(m => m.timestamp < before);
      }
      if (after) {
        messages = messages.filter(m => m.timestamp > after);
      }

      // Take latest limit items
      messages = messages.slice(-limit);

      return { ok: true, messages, count: messages.length };
    } catch (err) {
      log.error('Failed to read message history', { groupId, error: err.message });
      return { ok: false, code: ErrorCode.FILE_ERROR };
    }
  }

  /**
   * Check if member can send message
   * @param {string} groupId - Group ID
   * @param {string} pubkey - Member public key
   * @returns {{ok: boolean, code?: string}}
   */
  canSendMessage(groupId, pubkey) {
    const group = this.groups[groupId];
    if (!group) {
      return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
    }

    const member = group.members[pubkey];
    if (!member) {
      return { ok: false, code: ErrorCode.MEMBER_NOT_FOUND };
    }

    if (member.isBanned) {
      return { ok: false, code: ErrorCode.MEMBER_BANNED };
    }

    if (member.isMuted) {
      // Check if mute expired
      if (!member.mutedUntil || member.mutedUntil > Date.now()) {
        return { ok: false, code: ErrorCode.MEMBER_MUTED };
      }
      // Mute expired, auto unmute
      member.isMuted = false;
      member.mutedUntil = 0;
    }

    return { ok: true };
  }
}

// Singleton
export const groupManager = new GroupManager();
