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
 * Curated list of verified reliable public relays
 * Last updated: 2026-02-05 (tested for connectivity)
 * @constant {string[]}
 */
export const DEFAULT_RELAYS = [
  // Primary relays (verified working, high uptime)
  'wss://relay.nostr.band',        // NostrBand - full index, spam filtered ✓
  'wss://nos.lol',                  // nos.lol - popular, stable ✓
  'wss://relay.damus.io',           // Damus - iOS app relay ✓
  'wss://relay.snort.social',       // Snort - web client relay ✓

  // Community relays with good uptime
  'wss://purplepag.es',             // purplepages ✓
  'wss://nostr-pub.wellorder.net',  // wellorder ✓
  'wss://relay.primal.net',         // Primal web app ✓

  // Additional backup relays
  'wss://relay.nostr.wine',         // alternative wine relay
  'wss://relay.jdmac.org'           // community relay
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
  MESSAGE_HISTORY_SECONDS: 300,

  /** Minimum healthy relays required */
  MIN_HEALTHY_RELAYS: 2,

  /** Multi-path: publish to N relays simultaneously */
  MULTI_PATH_COUNT: 3,

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 60000,

  /** Relay blacklist threshold (consecutive failures before blacklist) */
  BLACKLIST_THRESHOLD: 10,

  /** Relay recovery attempts (attempts to recover a blacklisted relay) */
  RECOVERY_ATTEMPTS: 3
}

/**
 * CLI configuration
 * @constant {Object}
 */
export const CLI_CONFIG = {
  /** peers command wait time (ms) */
  PEERS_WAIT_TIME: 2000
}
