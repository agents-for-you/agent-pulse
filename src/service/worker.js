#!/usr/bin/env node
/**
 * Background worker process - maintains Nostr connection
 * Features: message receiving, command processing, health check, message deduplication, file rotation, NIP-04 encryption, group encryption
 *          message signature verification, group permission check, message retry queue, rate limiting
 */
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';
import * as nip04 from 'nostr-tools/nip04';
import { NostrNetwork } from '../network/nostr-network.js';
import { loadOrCreateIdentity, generateIdentity } from '../core/identity.js';
import { DEFAULT_RELAYS, DEFAULT_TOPIC } from '../config/defaults.js';
import { logger } from '../utils/logger.js';
import { messageRateLimiter } from '../utils/rate-limiter.js';
import { validatePubkey, validateTopic } from '../utils/validation.js';
import {
  DATA_DIR, PID_FILE, MSG_FILE, CMD_FILE, RESULT_FILE, HEALTH_FILE, GROUPS_FILE,
  CONFIG, ErrorCode, createErrorResponseFromCode,
  ensureDataDirAsync, withLock, readJsonLinesAsync, appendJsonLineAsync, appendJsonLine, LRUCache, generateId,
  atomicWriteFile, safeUnlinkAsync, sleep, fileExistsAsync, getStatsAsync
} from './shared.js';
import { verifyMessageSignature, createSignedMessage } from '../core/message-signature.js';
import { groupManager } from './group-manager.js';
import { messageQueue } from './message-queue.js';
import { getReplayProtection, ReplayProtection } from '../utils/replay-protection.js';

let network = null;
let identity = null;
let isShuttingDown = false;

// Group subscription management
const groupSubscriptions = new Map(); // topic -> subscription

// Group key cache
const groupKeys = new Map(); // topic -> { key, salt }

// Message deduplication cache
const processedMessages = new LRUCache(CONFIG.DEDUP_CACHE_SIZE);

// Replay protection instance
const replayProtection = getReplayProtection();

// ============ Group encryption ============

/**
 * Derive group shared key from topic using GCM-compatible derivation
 * All members who know the topic can derive the same key
 * Uses proper random salt per group with topic binding
 * @param {string} topic - Group topic
 * @returns {{key: Buffer, salt: Buffer}} Key object with per-group salt
 */
function deriveGroupKey(topic) {
  if (groupKeys.has(topic)) {
    return groupKeys.get(topic);
  }

  // Validate topic format (prevent malicious input)
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > 200) {
    throw new Error('Invalid topic format')
  }

  // Derive a per-group salt from the topic using HKDF
  // This ensures each group has unique salt while remaining deterministic
  const APP_IDENTIFIER = 'agent-p2p-group-v3'
  const baseSalt = Buffer.from(APP_IDENTIFIER, 'utf8')
  const salt = crypto.hkdfSync('sha256', topic, baseSalt, 'salt', 32)

  // Derive the encryption key from topic + salt
  const key = crypto.hkdfSync('sha256', topic, Buffer.from(salt), 'encryption', 32)

  const keyObj = { key: Buffer.from(key), salt: Buffer.from(salt) }
  groupKeys.set(topic, keyObj)
  return keyObj
}

/**
 * Encrypt group message using AES-256-GCM
 * - Fully random 12-byte nonce for each message
 * - Topic as AAD (Additional Authenticated Data) for integrity binding
 * - Returns versioned format for backward compatibility
 * @param {string} topic - Group topic
 * @param {string} plaintext - Message to encrypt
 * @returns {string} Versioned encrypted message (v2:nonce:ciphertext:tag)
 */
function encryptGroupMessage(topic, plaintext) {
  const { key } = deriveGroupKey(topic);

  // Generate 12-byte random nonce for GCM (recommended size)
  const nonce = crypto.randomBytes(12);

  // Create cipher with GCM mode
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  // Set topic as AAD (Additional Authenticated Data)
  // This binds the ciphertext to the topic, preventing topic substitution attacks
  cipher.setAAD(Buffer.from(topic, 'utf8'), {
    plaintextLength: Buffer.byteLength(plaintext, 'utf8')
  });

  // Encrypt the message
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  // Get authentication tag (16 bytes for GCM)
  const authTag = cipher.getAuthTag();

  // Return format: v2:nonce(base64):encrypted(base64):tag(base64)
  const nonceB64 = nonce.toString('base64');
  const encryptedB64 = encrypted.toString('base64');
  const tagB64 = authTag.toString('base64');

  return `v2:${nonceB64}:${encryptedB64}:${tagB64}`;
}

/**
 * Decrypt group message with version detection
 * - v2: AES-256-GCM with proper authentication
 * - legacy (no version): AES-256-CBC for backward compatibility
 * @param {string} topic - Group topic
 * @param {string} ciphertext - Encrypted message (versioned or legacy)
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails or authentication tag invalid
 */
function decryptGroupMessage(topic, ciphertext) {
  const { key } = deriveGroupKey(topic);

  // Check version from format
  const parts = ciphertext.split(':');

  if (parts[0] === 'v2' && parts.length === 4) {
    // New GCM format: v2:nonce:encrypted:tag
    const [, nonceB64, encryptedB64, tagB64] = parts;

    const nonce = Buffer.from(nonceB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');

    // Validate nonce length (GCM standard is 12 bytes)
    if (nonce.length !== 12) {
      throw new Error('Invalid nonce length');
    }

    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);

    // Set authentication tag before decryption
    decipher.setAuthTag(authTag);

    // Set AAD (must match encryption)
    decipher.setAAD(Buffer.from(topic, 'utf8'), {
      plaintextLength: encrypted.length
    });

    // Decrypt
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }

  // Legacy format: ivRandom:encrypted (AES-256-CBC)
  // Try to decrypt old format for backward compatibility during migration
  try {
    return decryptLegacyGroupMessage(topic, ciphertext);
  } catch (err) {
    throw new Error(`Decryption failed (invalid format or authentication): ${err.message}`);
  }
}

/**
 * Decrypt legacy group message (AES-256-CBC format)
 * Used only for backward compatibility during migration
 * @param {string} topic - Group topic
 * @param {string} ciphertext - Legacy encrypted message
 * @returns {string} Decrypted plaintext
 */
function decryptLegacyGroupMessage(topic, ciphertext) {
  // Derive old format key for compatibility
  const APP_IDENTIFIER = 'agent-p2p-group-v2'
  const salt = Buffer.from(APP_IDENTIFIER, 'utf8')
  const key = crypto.hkdfSync('sha256', topic, salt, 'encryption', 32)
  const ivPrefix = crypto.hkdfSync('sha256', topic, salt, 'iv', 8)

  const [ivRandomB64, encrypted] = ciphertext.split(':');
  if (!ivRandomB64 || !encrypted) {
    throw new Error('Invalid legacy ciphertext format');
  }

  const ivRandom = Buffer.from(ivRandomB64, 'base64');
  const iv = Buffer.concat([Buffer.from(ivPrefix), ivRandom]);

  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ============ Message storage ============

/**
 * Save received message (with deduplication and rotation, supports decryption and signature verification)
 * Includes rate limiting to prevent message flooding
 * Includes replay protection to prevent duplicate message processing
 */
async function saveMessage(msg) {
  // Rate limiting check (per sender)
  const rateLimitResult = messageRateLimiter.tryRequest(msg.pubkey);
  if (!rateLimitResult.allowed) {
    logger.warn(`[Worker] Rate limit exceeded for sender: ${msg.pubkey.slice(0, 8)}...`, {
      retryAfter: rateLimitResult.retryAfter
    });
    stats.rateLimitedMessages++;
    return; // Drop the message
  }

  // Replay protection check using nonce
  const msgTimestamp = msg.ts || (msg.created_at ? msg.created_at * 1000 : Date.now());
  const msgNonce = msg.id || ReplayProtection.createMessageNonce(
    msg.content || '',
    msg.pubkey,
    msgTimestamp
  );

  const replayCheck = replayProtection.checkNonce(msgNonce, msgTimestamp);
  if (!replayCheck.allowed) {
    logger.warn(`[Worker] Message rejected: ${replayCheck.reason}`, {
      nonce: msgNonce.slice(0, 8) + '...',
      from: msg.pubkey.slice(0, 8) + '...'
    });
    stats.replayRejected++;
    return; // Drop the replayed message
  }

  // Deduplication check (legacy - kept for backward compatibility)
  const msgId = msg.id || `${msg.pubkey}-${msg.created_at}`;
  if (processedMessages.has(msgId)) {
    logger.debug(`[Worker] Skip duplicate message: ${msgId.slice(0, 8)}...`);
    return;
  }
  processedMessages.add(msgId);

  await ensureDataDirAsync();

  try {
    // Try NIP-04 decryption
    let content = msg.content;
    try {
      // Try decrypting first
      const decrypted = await nip04.decrypt(identity.secretKey, msg.pubkey, msg.content);
      content = decrypted;
      logger.debug(`[Worker] Message decrypted`);
      // Try parsing JSON
      try {
        content = JSON.parse(decrypted);
      } catch {}
    } catch {
      // Decryption failed, try parsing directly
      try {
        content = JSON.parse(msg.content);
      } catch {}
    }

    const record = {
      id: msgId,
      from: msg.pubkey,
      content: content,
      timestamp: msg.created_at * 1000,
      receivedAt: Date.now(),
      isGroup: msg.isGroup || false,
      groupId: msg.groupId || null,
      signatureValid: null // Will verify below
    };

    // Verify message signature (if present)
    if (typeof content === 'object' && content.signature) {
      try {
        record.signatureValid = verifyMessageSignature(content, msg.pubkey);
        if (!record.signatureValid) {
          logger.warn(`[Worker] Message signature verification failed: ${msgId.slice(0, 8)}...`);
        }
      } catch (err) {
        logger.debug(`[Worker] Signature verification error: ${err.message}`);
        record.signatureValid = false;
      }
    }

    // If group message, save to group history
    if (msg.isGroup && msg.groupId) {
      try {
        groupManager.saveMessageToHistory(msg.groupId, record);
      } catch (err) {
        logger.debug(`[Worker] Failed to save group history: ${err.message}`);
      }
    }

    // Check file size, need rotation
    await checkAndRotateFile(MSG_FILE);

    try {
      withLock(() => {
        // Encrypt stored message
        appendJsonLine(MSG_FILE, record, true);
      });
    } catch {
      await appendJsonLineAsync(MSG_FILE, record, true);
    }

    stats.messagesReceived++;
    logger.info(`[Worker] Received message: ${msgId.slice(0, 8)}...`);
  } catch (err) {
    logger.error(`[Worker] Failed to save message: ${err.message}`);
  }
}

/**
 * Check and rotate file (async version)
 */
async function checkAndRotateFile(filePath) {
  try {
    const stats = await getStatsAsync(filePath);
    if (!stats) return;

    if (stats.size > CONFIG.MAX_MSG_FILE_SIZE) {
      // Read latest messages, keep some
      const messages = await readJsonLinesAsync(filePath);
      const keep = messages.slice(-CONFIG.MAX_MESSAGES_KEEP);

      await atomicWriteFile(filePath, keep.map(m => JSON.stringify(m)).join('\n') + '\n');
      logger.info(`[Worker] File rotated: keeping ${keep.length} messages`);
    }
  } catch (err) {
    logger.error(`[Worker] File rotation failed: ${err.message}`);
  }
}

// ============ Command processing ============

/**
 * Process command queue (async version)
 */
async function processCommands() {
  const exists = await fileExistsAsync(CMD_FILE);
  if (!exists) return;

  let commands;
  try {
    commands = withLock(() => {
      const cmds = readJsonLines(CMD_FILE);
      if (cmds.length > 0) {
        // Truncate the file asynchronously
        fsPromises.writeFile(CMD_FILE, '').catch(err => {
          logger.error(`[Worker] Failed to truncate command file: ${err.message}`);
        });
      }
      return cmds;
    });
  } catch {
    return;
  }

  for (const cmd of commands) {
    try {
      await handleCommand(cmd);
      stats.commandsProcessed++;
    } catch (err) {
      logger.error(`[Worker] Command processing failed: ${err.message}`);
      await saveResult(cmd.id, false, ErrorCode.INTERNAL_ERROR, err.message);
      stats.errors++;
    }
  }
}

/**
 * Save command execution result (async version)
 */
async function saveResult(cmdId, success, code, message = null) {
  const result = {
    cmdId,
    success,
    code,
    message,
    timestamp: Date.now()
  };

  try {
    withLock(() => {
      appendJsonLine(RESULT_FILE, result);
    });
  } catch {
    await appendJsonLineAsync(RESULT_FILE, result);
  }
}

/**
 * Process retry queue (async version)
 */
async function processRetryQueue() {
  if (!network || !network.isConnected) return;

  const pending = messageQueue.getPendingMessages();
  const now = Date.now();

  for (const entry of pending) {
    // Check if retry time reached
    if (entry.nextRetry && entry.nextRetry > now) continue;

    // Check retry count
    if (entry.retryCount >= CONFIG.MESSAGE_RETRY_MAX) {
      logger.warn(`[Worker] Message retry count exhausted: ${entry.id}`);
      await messageQueue.markSuccess(entry.id); // Remove from queue
      await saveResult(entry.id, false, ErrorCode.MESSAGE_RETRY_EXHAUSTED, 'Retry count exhausted');
      continue;
    }

    logger.info(`[Worker] Retrying message: ${entry.id} (${entry.retryCount + 1}/${CONFIG.MESSAGE_RETRY_MAX})`);

    try {
      if (entry.type === 'send') {
        const plaintext = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
        const signedMessage = createSignedMessage(plaintext, identity.secretKey);
        const encrypted = await nip04.encrypt(identity.secretKey, entry.target, JSON.stringify(signedMessage));

        await network.sendTask(entry.target, encrypted);
        await messageQueue.markSuccess(entry.id);
        await saveResult(entry.id, true, ErrorCode.OK, 'Retry succeeded');
        stats.messagesSent++;
        logger.info(`[Worker] Retry succeeded: ${entry.id}`);
      }
    } catch (err) {
      await messageQueue.markFailure(entry.id, err.message);
      logger.error(`[Worker] Retry failed: ${entry.id} - ${err.message}`);
    }
  }
}

/**
 * Handle single command (async version)
 */
async function handleCommand(cmd) {
  switch (cmd.type) {
    case 'send':
      if (!network || !network.isConnected) {
        logger.error('[Worker] Network disconnected, adding to retry queue');
        await messageQueue.enqueue('send', cmd.target, cmd.content, { id: cmd.id });
        await saveResult(cmd.id, false, ErrorCode.NETWORK_DISCONNECTED, 'Added to retry queue');
        return;
      }

      try {
        // NIP-04 encrypt message
        const plaintext = typeof cmd.content === 'string' ? cmd.content : JSON.stringify(cmd.content);

        // Create signed message
        const signedMessage = createSignedMessage(plaintext, identity.secretKey);
        const encrypted = await nip04.encrypt(identity.secretKey, cmd.target, JSON.stringify(signedMessage));

        await network.sendTask(cmd.target, encrypted);
        logger.info(`[Worker] Encrypted message sent to ${cmd.target.slice(0, 8)}...`);
        await messageQueue.markSuccess(cmd.id);
        await saveResult(cmd.id, true, ErrorCode.OK);
        stats.messagesSent++;
      } catch (err) {
        logger.error(`[Worker] Send failed: ${err.message}`);

        // Add to retry queue
        await messageQueue.enqueue('send', cmd.target, cmd.content, { id: cmd.id });
        await messageQueue.markFailure(cmd.id, err.message);

        const queueEntry = messageQueue.getMessage(cmd.id);
        if (queueEntry && queueEntry.retryCount >= CONFIG.MESSAGE_RETRY_MAX) {
          await saveResult(cmd.id, false, ErrorCode.MESSAGE_RETRY_EXHAUSTED, err.message);
        } else {
          await saveResult(cmd.id, false, ErrorCode.NETWORK_SEND_FAILED, `Retrying (${queueEntry?.retryCount || 0}/${CONFIG.MESSAGE_RETRY_MAX})`);
        }
        stats.errors++;
      }
      break;

    case 'join_group':
      try {
        await subscribeToGroup(cmd.groupId, cmd.topic);
        logger.info(`[Worker] Joined group: ${cmd.groupId}`);
        await saveResult(cmd.id, true, ErrorCode.OK);
      } catch (err) {
        logger.error(`[Worker] Failed to join group: ${err.message}`);
        await saveResult(cmd.id, false, ErrorCode.INTERNAL_ERROR, err.message);
      }
      break;

    case 'leave_group':
      try {
        unsubscribeFromGroup(cmd.topic);
        logger.info(`[Worker] Left group: ${cmd.groupId}`);
        await saveResult(cmd.id, true, ErrorCode.OK);
      } catch (err) {
        logger.error(`[Worker] Failed to leave group: ${err.message}`);
      }
      break;

    case 'group_send':
      if (!network || !network.isConnected) {
        logger.error('[Worker] Network disconnected');
        await saveResult(cmd.id, false, ErrorCode.NETWORK_DISCONNECTED);
        return;
      }

      // Permission check
      const canSend = groupManager.canSendMessage(cmd.groupId, identity.publicKey);
      if (!canSend.ok) {
        logger.warn(`[Worker] Group message send rejected: ${canSend.reason}`);
        await saveResult(cmd.id, false, canSend.code, canSend.reason);
        return;
      }

      try {
        // Use shared key to encrypt group message
        const encryptedContent = encryptGroupMessage(cmd.topic, cmd.content);
        await network.broadcastToTopic(cmd.topic, encryptedContent);
        logger.info(`[Worker] Encrypted group message sent to ${cmd.groupId}`);

        // Save to group history
        groupManager.saveMessageToHistory(cmd.groupId, {
          id: cmd.id,
          from: identity.publicKey,
          content: cmd.content,
          timestamp: Date.now()
        });

        await saveResult(cmd.id, true, ErrorCode.OK);
      } catch (err) {
        logger.error(`[Worker] Group message send failed: ${err.message}`);
        await saveResult(cmd.id, false, ErrorCode.NETWORK_SEND_FAILED, err.message);
      }
      break;

    case 'stop':
      await shutdown();
      break;

    default:
      logger.warn(`[Worker] Unknown command type: ${cmd.type}`);
      await saveResult(cmd.id, false, ErrorCode.UNKNOWN_COMMAND);
  }
}

// ============ Health check ============

// Health statistics
const stats = {
  messagesSent: 0,
  messagesReceived: 0,
  commandsProcessed: 0,
  errors: 0,
  rateLimitedMessages: 0,
  replayRejected: 0,
  startTime: Date.now()
};

/**
 * Update health status (async version)
 */
async function updateHealth() {
  const memUsage = process.memoryUsage();
  const pendingMessages = messageQueue.getPendingMessages();
  const health = {
    pid: process.pid,
    uptime: process.uptime(),
    connected: network?.isConnected || false,
    relayCount: network?.relays?.length || 0,
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    },
    stats: {
      messagesSent: stats.messagesSent,
      messagesReceived: stats.messagesReceived,
      commandsProcessed: stats.commandsProcessed,
      errors: stats.errors,
      rateLimitedMessages: stats.rateLimitedMessages,
      replayRejected: stats.replayRejected,
      processedCacheSize: processedMessages.size,
      replayCacheSize: replayProtection.getStats().cacheSize,
      groupCount: groupSubscriptions.size,
      pendingQueueSize: pendingMessages.length
    },
    timestamp: Date.now()
  };

  try {
    await atomicWriteFile(HEALTH_FILE, JSON.stringify(health, null, 2));
  } catch (err) {
    logger.error(`[Worker] Failed to update health status: ${err.message}`);
    stats.errors++;
  }
}

// ============ Lifecycle ============

/**
 * Graceful shutdown (async version with flush)
 */
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('[Worker] Shutting down...');

  // Flush any pending message queue saves
  try {
    await messageQueue.flush();
  } catch (err) {
    logger.debug(`[Worker] Failed to flush message queue: ${err.message}`);
  }

  // Close group subscriptions
  for (const sub of groupSubscriptions.values()) {
    try { sub.close(); } catch (err) {
      logger.debug(`[Worker] Failed to close group subscription: ${err.message}`);
    }
  }
  groupSubscriptions.clear();

  if (network) {
    try {
      await network.close();
    } catch (err) {
      logger.debug(`[Worker] Failed to close network connection: ${err.message}`);
    }
  }

  // Safely clean up files
  await safeUnlinkAsync(PID_FILE, (msg) => logger.debug(msg));
  await safeUnlinkAsync(HEALTH_FILE, (msg) => logger.debug(msg));

  process.exit(0);
}

// ============ Group management ============

/**
 * Subscribe to group
 */
async function subscribeToGroup(groupId, topic) {
  if (groupSubscriptions.has(topic)) {
    logger.debug(`[Worker] Group already subscribed: ${topic}`);
    return;
  }

  // Create subscription
  const sub = await network.subscribeToTopic(topic, (message) => {
    // Ignore own messages
    if (message.from === identity.publicKey) return;

    // Decrypt group message
    let decryptedContent;
    try {
      decryptedContent = decryptGroupMessage(topic, message.content);
    } catch (err) {
      logger.debug(`[Worker] Group message decryption failed, may be old format or non-group message: ${err.message}`);
      // Compatible with old unencrypted messages
      decryptedContent = message.content;
    }

    // Save group message
    saveMessage({
      id: message.id || generateId(),
      pubkey: message.from,
      content: decryptedContent,
      created_at: Math.floor(message.ts / 1000),
      groupId: groupId,
      isGroup: true
    });
  });

  groupSubscriptions.set(topic, sub);
  logger.info(`[Worker] Subscribed to group: ${groupId} (${topic})`);
}

/**
 * Unsubscribe from group
 */
function unsubscribeFromGroup(topic) {
  const sub = groupSubscriptions.get(topic);
  if (sub) {
    try { sub.close(); } catch {}
    groupSubscriptions.delete(topic);
    logger.info(`[Worker] Unsubscribed from group: ${topic}`);
  }
}

/**
 * Load existing groups and subscribe (async version)
 */
async function loadExistingGroups() {
  const exists = await fileExistsAsync(GROUPS_FILE);
  if (!exists) return;

  try {
    const data = JSON.parse(await fsPromises.readFile(GROUPS_FILE, 'utf8'));
    for (const [groupId, group] of Object.entries(data.groups || {})) {
      try {
        await subscribeToGroup(groupId, group.topic);
      } catch (err) {
        logger.error(`[Worker] Failed to load group: ${groupId} - ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`[Worker] Failed to read groups file: ${err.message}`);
  }
}

/**
 * Main function (async version)
 */
async function main() {
  await ensureDataDirAsync();

  // Write PID file
  await fsPromises.writeFile(PID_FILE, process.pid.toString());

  logger.info(`[Worker] Starting... PID: ${process.pid}`);

  // Load identity (use ephemeral mode if flag is set)
  const isEphemeral = process.env.AGENT_PULSE_EPHEMERAL === 'true';
  if (isEphemeral) {
    identity = generateIdentity();
    logger.info(`[Worker] Using ephemeral identity (not saved to disk)`);
  } else {
    identity = loadOrCreateIdentity();
  }
  const myPubkey = identity.publicKey;

  logger.info(`[Worker] Public key: ${myPubkey}`);

  // Create network instance
  network = new NostrNetwork({
    relays: DEFAULT_RELAYS,
    topic: DEFAULT_TOPIC,
    identity: identity
  });

  // Connect to network
  await network.connect((message) => {
    // Ignore own messages
    if (message.from === myPubkey) return;

    // Only process messages sent to self
    if (message.to && message.to !== myPubkey) return;

    saveMessage({
      id: message.id || generateId(),
      pubkey: message.from,
      content: JSON.stringify(message),
      created_at: Math.floor(message.ts / 1000)
    });
  });

  logger.info(`[Worker] Running, listening for messages...`);

  // Load existing groups
  await loadExistingGroups();

  // Periodic tasks
  setInterval(processCommands, CONFIG.CMD_POLL_INTERVAL);
  setInterval(updateHealth, CONFIG.HEALTH_UPDATE_INTERVAL);
  setInterval(processRetryQueue, CONFIG.MESSAGE_RETRY_DELAY); // Process retry queue
  setInterval(() => messageQueue.cleanExpired(), 60000); // Clean expired messages every minute

  // Update health status immediately
  await updateHealth();

  // Signal handling
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('uncaughtException', (err) => {
    logger.error(`[Worker] Uncaught exception: ${err.message}`);
    shutdown();
  });
}

main().catch(err => {
  logger.error(`[Worker] Failed to start: ${err.message}`);
  safeUnlinkAsync(PID_FILE).catch(() => {});
  process.exit(1);
});
