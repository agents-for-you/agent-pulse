/**
 * Background service management - CLI call layer
 * Provides start/stop/status/send/recv and other features
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DATA_DIR, PID_FILE, MSG_FILE, CMD_FILE, RESULT_FILE, HEALTH_FILE, GROUPS_FILE,
  CONFIG, ErrorCode,
  ensureDataDir, withLock, readJsonLines, appendJsonLine, generateId, sleep, safeUnlink
} from './shared.js';
import { groupManager } from './group-manager.js';
import { messageQueue } from './message-queue.js';
import { logger } from '../utils/logger.js';

const log = logger.child('server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ Service status check ============

/**
 * Check if service is running
 * @returns {number|false} PID or false
 */
export function isRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    safeUnlink(PID_FILE);
    return false;
  }
}

// ============ Service control ============

/**
 * Ensure service is running (auto-start if not running)
 * @param {Object} options - Start options
 * @param {boolean} [options.ephemeral] - Use ephemeral keys
 * @param {boolean} [options.autoStart=true] - Auto-start if not running
 * @returns {Promise<Object>} Status
 */
export async function ensureRunning(options = {}) {
  const { autoStart = true } = options

  if (isRunning()) {
    return { ok: true, running: true, autoStarted: false }
  }

  if (!autoStart) {
    return { ok: false, running: false, code: ErrorCode.SERVICE_NOT_RUNNING }
  }

  log.info('Service not running, auto-starting...')
  return await start(options)
}

/**
 * Start background service
 * @param {Object} options - Start options
 * @param {boolean} [options.ephemeral] - Use ephemeral keys (not saved to disk)
 * @returns {Promise<Object>} Start result
 */
export async function start(options = {}) {
  if (isRunning()) {
    return { ok: false, code: ErrorCode.SERVICE_ALREADY_RUNNING };
  }

  ensureDataDir();

  const serverScript = path.join(__dirname, 'worker.js');
  const env = { ...process.env };
  if (options.ephemeral) {
    env.AGENT_PULSE_EPHEMERAL = 'true';
  }

  const child = spawn('node', [serverScript], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '../..'),
    env
  });

  child.unref();

  // Poll waiting for start
  const startTime = Date.now();
  while (Date.now() - startTime < CONFIG.START_TIMEOUT) {
    await new Promise(r => setTimeout(r, CONFIG.START_POLL_INTERVAL));
    const pid = isRunning();
    if (pid) {
      return { ok: true, pid, ephemeral: !!options.ephemeral };
    }
  }

  return { ok: false, code: ErrorCode.SERVICE_START_FAILED };
}

/**
 * Stop background service
 * @returns {Promise<Object>} Stop result
 */
export async function stop() {
  const pid = isRunning();
  if (!pid) {
    return { ok: false, code: ErrorCode.SERVICE_NOT_RUNNING };
  }

  try {
    process.kill(pid, 'SIGTERM');

    const start = Date.now();
    while (Date.now() - start < 2000 && isRunning()) {
      // Use async wait instead of busy wait
      await sleep(50);
    }

    // Clean up safely
    safeUnlink(PID_FILE);

    return { ok: true };
  } catch (err) {
    return { ok: false, code: ErrorCode.SERVICE_STOP_FAILED, error: err.message };
  }
}

/**
 * Get service status
 * @returns {Object} Status information
 */
export function getStatus() {
  const pid = isRunning();
  const messages = readMessages(false);

  // Read health status
  let health = null;
  if (fs.existsSync(HEALTH_FILE)) {
    try {
      health = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
    } catch {}
  }

  return {
    running: !!pid,
    pid: pid || null,
    pendingMessages: messages.length,
    health: health
  };
}

// ============ Message operations ============

/**
 * Read received messages (supports filtering and pagination)
 * @param {boolean} clear - Whether to clear
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max return count
 * @param {number} [options.offset] - Offset
 * @param {string} [options.from] - Filter by sender
 * @param {number} [options.since] - Start timestamp
 * @param {number} [options.until] - End timestamp
 * @param {string} [options.search] - Search keyword
 * @param {boolean} [options.isGroup] - Only return group messages
 * @returns {Object} Message list and pagination info
 */
export function readMessages(clear = false, options = {}) {
  ensureDataDir();

  const { limit, offset = 0, from, since, until, search, isGroup } = options;

  try {
    return withLock(() => {
      // Decrypt read messages
      let messages = readJsonLines(MSG_FILE, true);
      const totalCount = messages.length;

      // Apply filters
      if (from) {
        messages = messages.filter(m => m.from === from);
      }

      if (since) {
        messages = messages.filter(m => m.timestamp >= since);
      }

      if (until) {
        messages = messages.filter(m => m.timestamp <= until);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        messages = messages.filter(m => {
          const content = typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content);
          return content.toLowerCase().includes(searchLower);
        });
      }

      if (isGroup !== undefined) {
        messages = messages.filter(m => !!m.isGroup === isGroup);
      }

      const filteredCount = messages.length;

      // Apply pagination
      if (offset > 0) {
        messages = messages.slice(offset);
      }

      if (limit && limit > 0) {
        messages = messages.slice(0, limit);
      }

      if (clear && messages.length > 0) {
        fs.writeFileSync(MSG_FILE, '');
      }

      // For simple call (no options), return array for compatibility
      if (Object.keys(options).length === 0) {
        return messages;
      }

      return {
        messages,
        pagination: {
          total: totalCount,
          filtered: filteredCount,
          returned: messages.length,
          offset,
          limit: limit || null
        }
      };
    });
  } catch {
    // Lock acquisition failed, read directly
    const messages = readJsonLines(MSG_FILE, true);
    if (Object.keys(options).length === 0) {
      return messages;
    }
    return { messages, pagination: { total: messages.length, returned: messages.length } };
  }
}

/**
 * Send message to specified target (auto-starts service if needed)
 * @param {string} targetPubkey - Target public key
 * @param {string} content - Message content
 * @param {Object} options - Options
 * @param {boolean} [options.autoStart=true] - Auto-start service
 * @returns {Promise<Object>} Send result
 */
export async function sendMessage(targetPubkey, content, options = {}) {
  const { autoStart = true } = options

  // Auto-start if not running
  if (!isRunning()) {
    if (!autoStart) {
      return { ok: false, code: ErrorCode.SERVICE_NOT_RUNNING };
    }
    const started = await ensureRunning()
    if (!started.ok) {
      return started
    }
    // Wait for service to be ready
    await sleep(500)
  }

  // Normalize npub to hex if needed
  let target = targetPubkey
  if (targetPubkey.startsWith('npub')) {
    try {
      const { decodePublicKey } = await import('../core/nip19.js')
      target = decodePublicKey(targetPubkey)
    } catch (err) {
      return { ok: false, code: ErrorCode.INVALID_PUBKEY, error: 'Invalid npub format' }
    }
  }

  // Validate public key format
  if (!target || !/^[0-9a-f]{64}$/i.test(target)) {
    return { ok: false, code: ErrorCode.INVALID_PUBKEY };
  }

  const cmdId = generateId();
  const command = {
    id: cmdId,
    type: 'send',
    target: target,
    content: content,
    timestamp: Date.now()
  };

  try {
    withLock(() => {
      appendJsonLine(CMD_FILE, command);
    });
  } catch {
    appendJsonLine(CMD_FILE, command);
  }

  return { ok: true, cmdId };
}

/**
 * Query send result
 * @param {string} cmdId - Command ID
 * @returns {Object|null} Send result
 */
export function getSendResult(cmdId) {
  const results = readJsonLines(RESULT_FILE);
  return results.find(r => r.cmdId === cmdId) || null;
}

/**
 * Read all send results
 * @param {boolean} clear - Whether to clear
 * @returns {Array} Result list
 */
export function readResults(clear = false) {
  ensureDataDir();

  try {
    return withLock(() => {
      const results = readJsonLines(RESULT_FILE);

      if (clear && results.length > 0) {
        fs.writeFileSync(RESULT_FILE, '');
      }

      return results;
    });
  } catch {
    return readJsonLines(RESULT_FILE);
  }
}

// ============ Group operations ============

/**
 * Create group
 * @param {string} name - Group name
 * @param {string} [ownerPubkey] - Group owner public key
 * @returns {Object} Creation result
 */
export function createGroup(name, ownerPubkey = '') {
  const result = groupManager.createGroup(name, ownerPubkey);

  if (result.ok && isRunning()) {
    // Notify worker to subscribe to new group
    const cmdId = generateId();
    appendJsonLine(CMD_FILE, {
      id: cmdId,
      type: 'join_group',
      groupId: result.groupId,
      topic: result.topic,
      timestamp: Date.now()
    });
  }

  return result;
}

/**
 * Join group
 * @param {string} groupId - Group ID
 * @param {string} topic - Group topic
 * @param {string} [name] - Group name
 * @param {string} [pubkey] - Member public key
 * @returns {Object} Join result
 */
export function joinGroup(groupId, topic, name = '', pubkey = '') {
  const result = groupManager.joinGroup(groupId, topic, pubkey, name);

  if (result.ok && isRunning()) {
    // Notify worker to subscribe
    const cmdId = generateId();
    appendJsonLine(CMD_FILE, {
      id: cmdId,
      type: 'join_group',
      groupId,
      topic,
      timestamp: Date.now()
    });
  }

  return result;
}

/**
 * Leave group
 * @param {string} groupId - Group ID
 * @param {string} [pubkey] - Member public key
 * @returns {Object} Leave result
 */
export function leaveGroup(groupId, pubkey = '') {
  const group = groupManager.getGroup(groupId);
  if (!group) {
    return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
  }

  const topic = group.topic;
  const result = groupManager.leaveGroup(groupId, pubkey);

  if (result.ok && isRunning()) {
    // Notify worker to unsubscribe
    const cmdId = generateId();
    appendJsonLine(CMD_FILE, {
      id: cmdId,
      type: 'leave_group',
      groupId,
      topic,
      timestamp: Date.now()
    });
  }

  return result;
}

/**
 * List all groups
 * @returns {Object} Group list
 */
export function listGroups() {
  return groupManager.listGroups();
}

/**
 * Get group member list
 * @param {string} groupId - Group ID
 * @returns {Object} Member list
 */
export function getGroupMembers(groupId) {
  return groupManager.getMembers(groupId);
}

/**
 * Kick group member
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Operator public key
 * @param {string} targetPubkey - Target member public key
 * @returns {Object}
 */
export function kickGroupMember(groupId, operatorPubkey, targetPubkey) {
  return groupManager.kickMember(groupId, operatorPubkey, targetPubkey);
}

/**
 * Ban group member
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Operator public key
 * @param {string} targetPubkey - Target member public key
 * @returns {Object}
 */
export function banGroupMember(groupId, operatorPubkey, targetPubkey) {
  return groupManager.banMember(groupId, operatorPubkey, targetPubkey);
}

/**
 * Unban group member
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Operator public key
 * @param {string} targetPubkey - Target member public key
 * @returns {Object}
 */
export function unbanGroupMember(groupId, operatorPubkey, targetPubkey) {
  return groupManager.unbanMember(groupId, operatorPubkey, targetPubkey);
}

/**
 * Mute group member
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Operator public key
 * @param {string} targetPubkey - Target member public key
 * @param {number} [duration] - Mute duration (ms)
 * @returns {Object}
 */
export function muteGroupMember(groupId, operatorPubkey, targetPubkey, duration = 0) {
  return groupManager.muteMember(groupId, operatorPubkey, targetPubkey, duration);
}

/**
 * Unmute group member
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Operator public key
 * @param {string} targetPubkey - Target member public key
 * @returns {Object}
 */
export function unmuteGroupMember(groupId, operatorPubkey, targetPubkey) {
  return groupManager.unmuteMember(groupId, operatorPubkey, targetPubkey);
}

/**
 * Set group admin
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Operator public key
 * @param {string} targetPubkey - Target member public key
 * @param {boolean} isAdmin - Whether to set as admin
 * @returns {Object}
 */
export function setGroupAdmin(groupId, operatorPubkey, targetPubkey, isAdmin) {
  return groupManager.setAdmin(groupId, operatorPubkey, targetPubkey, isAdmin);
}

/**
 * Transfer group ownership
 * @param {string} groupId - Group ID
 * @param {string} operatorPubkey - Current group owner public key
 * @param {string} newOwnerPubkey - New group owner public key
 * @returns {Object}
 */
export function transferGroupOwnership(groupId, operatorPubkey, newOwnerPubkey) {
  return groupManager.transferOwnership(groupId, operatorPubkey, newOwnerPubkey);
}

/**
 * Get group message history
 * @param {string} groupId - Group ID
 * @param {Object} [options] - Query options
 * @returns {Object}
 */
export function getGroupHistory(groupId, options = {}) {
  return groupManager.getMessageHistory(groupId, options);
}

/**
 * Send group message (broadcast)
 * @param {string} groupId - Group ID
 * @param {string} content - Message content
 * @param {string} [senderPubkey] - Sender public key
 * @returns {Object} Send result
 */
export function sendGroupMessage(groupId, content, senderPubkey = '') {
  if (!isRunning()) {
    return { ok: false, code: ErrorCode.SERVICE_NOT_RUNNING };
  }

  const group = groupManager.getGroup(groupId);
  if (!group) {
    return { ok: false, code: ErrorCode.GROUP_NOT_FOUND };
  }

  // Check send permission
  if (senderPubkey) {
    const canSend = groupManager.canSendMessage(groupId, senderPubkey);
    if (!canSend.ok) {
      return canSend;
    }
  }

  const cmdId = generateId();
  const command = {
    id: cmdId,
    type: 'group_send',
    groupId,
    topic: group.topic,
    content,
    timestamp: Date.now()
  };

  try {
    withLock(() => {
      appendJsonLine(CMD_FILE, command);
    });
  } catch {
    appendJsonLine(CMD_FILE, command);
  }

  return { ok: true, cmdId };
}

// ============ Message queue status ============

/**
 * Get offline message queue status
 * @returns {Object}
 */
export function getMessageQueueStatus() {
  return { ok: true, ...messageQueue.getStatus() };
}

// ============ Relay status ============

/**
 * Check relay connection status with latency
 * @param {string[]} relays - Relay list to check
 * @param {number} timeout - Connection timeout per relay (ms)
 * @returns {Promise<Array>} Relay status list
 */
async function checkRelayStatus(relays, timeout = 5000) {
  const WebSocket = (await import('ws')).default;
  const results = [];

  for (const relay of relays) {
    const startTime = Date.now();
    let status = 'disconnected';
    let latency = null;
    let error = null;

    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(relay);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Timeout'));
        }, timeout);

        ws.on('open', () => {
          clearTimeout(timer);
          latency = Date.now() - startTime;
          status = 'connected';
          ws.close();
          resolve();
        });

        ws.on('error', (err) => {
          clearTimeout(timer);
          error = err.message;
          reject(err);
        });

        ws.on('close', () => {
          clearTimeout(timer);
        });
      });
    } catch (err) {
      status = 'error';
      error = error || err.message;
    }

    results.push({
      relay,
      status,
      latency,
      error
    });
  }

  return results;
}

/**
 * Get relay status with latency check
 * @param {Object} options - Options
 * @param {string[]} [options.relays] - Custom relay list
 * @param {number} [options.timeout] - Connection timeout
 * @returns {Promise<Object>} Relay status result
 */
export async function getRelayStatus(options = {}) {
  const { DEFAULT_RELAYS } = await import('../config/defaults.js');
  const relays = options.relays || DEFAULT_RELAYS;
  const timeout = options.timeout || 5000;

  const results = await checkRelayStatus(relays, timeout);

  // Calculate summary
  const connected = results.filter(r => r.status === 'connected').length;
  const avgLatency = connected > 0
    ? Math.round(results.filter(r => r.latency !== null).reduce((sum, r) => sum + r.latency, 0) / connected)
    : null;

  return {
    ok: true,
    summary: {
      total: results.length,
      connected,
      disconnected: results.length - connected,
      avgLatency
    },
    relays: results
  };
}
