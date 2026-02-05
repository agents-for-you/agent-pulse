/**
 * @fileoverview Contacts/Address book management
 * Manage contact list with aliases for Nostr pubkeys
 */

import fs from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJson } from '../service/shared.js';

const CONTACTS_FILE = '.agent-contacts.json';

/**
 * @typedef {Object} Contact
 * @property {string} name - Display name
 * @property {string} npub - Nostr public key (npub format)
 * @property {string} pubkey - Hex public key
 * @property {string} [notes] - Optional notes
 * @property {number} createdAt - Creation timestamp
 * @property {number} lastUsed - Last used timestamp
 */

/**
 * Contacts manager
 */
class ContactsManager {
  constructor() {
    /** @type {Map<string, Contact>} */
    this.contacts = new Map();
    this._loadContacts();
  }

  /**
   * Reset contacts map (for testing)
   * @private
   */
  _resetForTesting() {
    this.contacts.clear();
  }

  /**
   * Load contacts from file
   * @private
   */
  _loadContacts() {
    ensureDataDir();
    const data = readJson(CONTACTS_FILE);
    if (data && typeof data === 'object') {
      for (const [alias, contact] of Object.entries(data)) {
        this.contacts.set(alias, contact);
      }
    }
  }

  /**
   * Save contacts to file
   * @private
   */
  _saveContacts() {
    const data = Object.fromEntries(this.contacts.entries());
    writeJson(CONTACTS_FILE, data);
  }

  /**
   * Add or update a contact
   * @param {string} alias - Unique alias (e.g., "alice")
   * @param {Object} contact - Contact data
   * @param {string} contact.npub - Nostr public key (npub or hex)
   * @param {string} [contact.name] - Display name
   * @param {string} [contact.notes] - Notes
   * @returns {{ok: boolean, alias: string, contact: Object}}
   */
  add(alias, { npub, name, notes = '' }) {
    if (!alias || typeof alias !== 'string') {
      return { ok: false, error: 'Invalid alias' };
    }

    // Validate alias format (alphanumeric, underscore, dash)
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
      return { ok: false, error: 'Alias must contain only letters, numbers, underscore, dash' };
    }

    // Normalize pubkey (handle npub format)
    let pubkey = npub;
    if (pubkey.startsWith('npub1') && pubkey.length === 63) {
      // Could validate npub, but for now just store it
    }

    const contact = {
      name: name || alias,
      npub,
      pubkey,
      notes,
      createdAt: Date.now(),
      lastUsed: null
    };

    // Check if updating existing contact
    const existing = this.contacts.get(alias);
    if (existing) {
      contact.createdAt = existing.createdAt;
    }

    this.contacts.set(alias, contact);
    this._saveContacts();

    return {
      ok: true,
      alias,
      contact,
      updated: !!existing
    };
  }

  /**
   * Remove a contact
   * @param {string} alias - Contact alias
   * @returns {{ok: boolean, removed: boolean}}
   */
  remove(alias) {
    const existed = this.contacts.delete(alias);
    if (existed) {
      this._saveContacts();
    }
    return { ok: true, removed: existed };
  }

  /**
   * Get a contact by alias
   * @param {string} alias - Contact alias
   * @returns {Contact|null}
   */
  get(alias) {
    return this.contacts.get(alias) || null;
  }

  /**
   * Get contact by npub or pubkey
   * @param {string} pubkey - Public key (npub or hex)
   * @returns {{alias: string, contact: Contact}|null}
   */
  getByPubkey(pubkey) {
    // Try exact match first
    for (const [alias, contact] of this.contacts) {
      if (contact.npub === pubkey || contact.pubkey === pubkey) {
        return { alias, contact };
      }
    }
    return null;
  }

  /**
   * List all contacts
   * @returns {Contact[]}
   */
  list() {
    return Array.from(this.contacts.entries()).map(([alias, contact]) => ({
      alias,
      ...contact
    }));
  }

  /**
   * Export contacts as JSON
   * @returns {Object} Contacts data
   */
  export() {
    return Object.fromEntries(this.contacts.entries());
  }

  /**
   * Import contacts from JSON
   * @param {Object} data - Contacts data
   * @returns {{ok: boolean, imported: number, errors: string[]}}
   */
  import(data) {
    let imported = 0;
    const errors = [];

    if (!data || typeof data !== 'object') {
      return { ok: false, imported: 0, errors: ['Invalid data'] };
    }

    for (const [alias, contact] of Object.entries(data)) {
      // Validate contact structure
      if (!contact.npub && !contact.pubkey) {
        errors.push(`${alias}: missing npub/pubkey`);
        continue;
      }

      try {
        this.add(alias, contact);
        imported++;
      } catch (err) {
        errors.push(`${alias}: ${err.message}`);
      }
    }

    return { ok: true, imported, errors };
  }

  /**
   * Update last used timestamp for an alias
   * @param {string} alias - Contact alias
   */
  touch(alias) {
    const contact = this.contacts.get(alias);
    if (contact) {
      contact.lastUsed = Date.now();
      this._saveContacts();
    }
  }

  /**
   * Get contacts count
   * @returns {{total: number}}
   */
  count() {
    return { total: this.contacts.size };
  }
}

// Singleton
let contactsInstance = null;

export function getContacts() {
  if (!contactsInstance) {
    contactsInstance = new ContactsManager();
  }
  return contactsInstance;
}

export { ContactsManager };
