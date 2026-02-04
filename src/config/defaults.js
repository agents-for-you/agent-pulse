/**
 * @fileoverview Default configuration
 * Centralized management of all default configuration items
 */

/**
 * Default identity file path
 * @constant {string}
 */
export const DEFAULT_IDENTITY_FILE = '.agent-identity.json'

/**
 * Default Nostr Relay list
 * @constant {string[]}
 */
export const DEFAULT_RELAYS = [
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://nostr-pub.wellorder.net',
  'wss://offchain.pub',
  'wss://nostr.mutinywallet.com'
]

/**
 * Default topic/channel
 * @constant {string}
 */
export const DEFAULT_TOPIC = 'agent-nostr-v1'

/**
 * Default Agent metadata
 * @constant {Object}
 */
export const DEFAULT_AGENT = {
  name: 'Agent',
  version: '0.4.0'
}

/**
 * Network configuration
 * @constant {Object}
 */
export const NETWORK_CONFIG = {
  /** Connection timeout (ms) */
  CONNECTION_TIMEOUT: 10000,

  /** Auto reconnect */
  AUTO_RECONNECT: true,

  /** Reconnect interval (ms) */
  RECONNECT_INTERVAL: 5000,

  /** Maximum peer cache size */
  MAX_PEERS: 100,

  /** Message history time window (seconds) */
  MESSAGE_HISTORY_SECONDS: 300
}

/**
 * CLI configuration
 * @constant {Object}
 */
export const CLI_CONFIG = {
  /** peers command wait time (ms) */
  PEERS_WAIT_TIME: 2000
}
