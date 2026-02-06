/**
 * @fileoverview Data directory and path constants
 * Centralizes all file paths and configuration constants
 */

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ Path constants ============
export const DATA_DIR = path.join(__dirname, '../../.data');
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
export const MSG_FILE = path.join(DATA_DIR, 'messages.jsonl');
export const CMD_FILE = path.join(DATA_DIR, 'commands.jsonl');
export const RESULT_FILE = path.join(DATA_DIR, 'results.jsonl');
export const HEALTH_FILE = path.join(DATA_DIR, 'health.json');
export const LOCK_FILE = path.join(DATA_DIR, '.lock');
export const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
export const STORAGE_KEY_FILE = path.join(DATA_DIR, '.storage_key');
export const OFFLINE_QUEUE_FILE = path.join(DATA_DIR, 'offline_queue.jsonl');
export const RELAY_STATS_FILE = path.join(DATA_DIR, 'relay_stats.json');
export const GROUP_HISTORY_DIR = path.join(DATA_DIR, 'group_history');

// ============ Configuration constants ============
export const CONFIG = {
  MAX_MSG_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_MESSAGES_KEEP: 1000,             // Max messages to keep
  DEDUP_CACHE_SIZE: 500,               // Dedup cache size
  CMD_POLL_INTERVAL: 500,              // Command poll interval ms
  HEALTH_UPDATE_INTERVAL: 5000,        // Health update interval ms
  START_TIMEOUT: 5000,                 // Start timeout ms
  START_POLL_INTERVAL: 100,            // Start poll interval ms

  // Message reliability
  MESSAGE_RETRY_COUNT: 3,              // Message retry count
  MESSAGE_RETRY_DELAY: 1000,           // Retry delay ms
  MESSAGE_RETRY_BACKOFF: 2,            // Exponential backoff factor
  MESSAGE_TTL: 24 * 60 * 60 * 1000,    // Message expiration 24h
  OFFLINE_QUEUE_FILE: 'offline_queue.jsonl', // Offline queue file
  MAX_QUEUE_SIZE: 10000,               // Maximum message queue size (prevents OOM)

  // Groups
  GROUP_HISTORY_LIMIT: 100,            // Group message history sync limit
  MEMBER_ACTIVITY_TIMEOUT: 5 * 60 * 1000, // Member activity timeout 5min
};

// ============ Error codes ============
export const ErrorCode = {
  // Success
  OK: 'OK',

  // Service related
  SERVICE_NOT_RUNNING: 'SERVICE_NOT_RUNNING',
  SERVICE_ALREADY_RUNNING: 'SERVICE_ALREADY_RUNNING',
  SERVICE_START_FAILED: 'SERVICE_START_FAILED',
  SERVICE_STOP_FAILED: 'SERVICE_STOP_FAILED',

  // Network related
  NETWORK_DISCONNECTED: 'NETWORK_DISCONNECTED',
  NETWORK_SEND_FAILED: 'NETWORK_SEND_FAILED',
  RELAY_ALL_FAILED: 'RELAY_ALL_FAILED',

  // Argument related
  INVALID_ARGS: 'INVALID_ARGS',
  INVALID_PUBKEY: 'INVALID_PUBKEY',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',

  // Group related
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  GROUP_ALREADY_EXISTS: 'GROUP_ALREADY_EXISTS',
  NOT_GROUP_OWNER: 'NOT_GROUP_OWNER',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  MEMBER_BANNED: 'MEMBER_BANNED',
  MEMBER_MUTED: 'MEMBER_MUTED',

  // Message related
  MESSAGE_EXPIRED: 'MESSAGE_EXPIRED',
  MESSAGE_RETRY_EXHAUSTED: 'MESSAGE_RETRY_EXHAUSTED',

  // System related
  FILE_ERROR: 'FILE_ERROR',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// ============ Utility functions ============

/**
 * Ensure data directory exists
 */
export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Ensure data directory exists (async version)
 */
export async function ensureDataDirAsync() {
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Generate unique ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
