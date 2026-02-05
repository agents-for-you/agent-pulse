/**
 * Tests for contacts/address book feature
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ContactsManager } from '../src/service/contacts.js';

const TEST_DATA_DIR = join(process.cwd(), '.data');
const TEST_CONTACTS_FILE = join(TEST_DATA_DIR, '.agent-contacts.json');

describe('ContactsManager', () => {
  let contacts;

  beforeEach(() => {
    // Clean up test data file first
    if (existsSync(TEST_CONTACTS_FILE)) {
      rmSync(TEST_CONTACTS_FILE);
    }
    // Create new instance (will load empty data since file was deleted)
    contacts = new ContactsManager();
    // Also clear the in-memory map for safety
    contacts._resetForTesting();
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_CONTACTS_FILE)) {
      rmSync(TEST_CONTACTS_FILE);
    }
    // Clear the contacts map to prevent interference
    if (contacts) {
      contacts._resetForTesting();
    }
  });

  describe('Add Contact', () => {
    it('should add a new contact', () => {
      const result = contacts.add('alice', {
        npub: 'npub1test123',
        name: 'Alice',
        notes: 'Test contact'
      });

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.alias, 'alice');
      assert.strictEqual(result.updated, false);
      assert.strictEqual(result.contact.name, 'Alice');
      assert.strictEqual(result.contact.npub, 'npub1test123');
    });

    it('should validate alias format', () => {
      // Invalid characters
      const result1 = contacts.add('alice@bob', { npub: 'npub1test' });
      assert.strictEqual(result1.ok, false);
      assert.ok(result1.error.includes('letters, numbers, underscore, dash'));

      // Empty alias
      const result2 = contacts.add('', { npub: 'npub1test' });
      assert.strictEqual(result2.ok, false);
    });

    it('should allow valid alias formats', () => {
      const validAliases = ['alice', 'alice_bob', 'alice-bob', 'Alice123', 'a1_b2-c3'];

      for (const alias of validAliases) {
        const result = contacts.add(alias, { npub: 'npub1test' });
        assert.strictEqual(result.ok, true, `Alias ${alias} should be valid`);
      }
    });

    it('should update existing contact', () => {
      contacts.add('alice', { npub: 'npub1test123', name: 'Alice' });

      const result = contacts.add('alice', {
        npub: 'npub1newkey',
        name: 'Alice Updated',
        notes: 'Updated notes'
      });

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.updated, true);
      assert.strictEqual(result.contact.name, 'Alice Updated');
      assert.strictEqual(result.contact.npub, 'npub1newkey');
      assert.strictEqual(result.contact.notes, 'Updated notes');
    });

    it('should preserve createdAt when updating', () => {
      const result1 = contacts.add('alice', { npub: 'npub1test', name: 'Alice' });
      const originalCreatedAt = result1.contact.createdAt;

      // Wait a bit to ensure timestamp would differ
      const startTime = Date.now();
      while (Date.now() - startTime < 10) { /* busy wait */ }

      const result2 = contacts.add('alice', { npub: 'npub1test', name: 'Alice Updated' });

      assert.strictEqual(result2.contact.createdAt, originalCreatedAt);
    });
  });

  describe('Get Contact', () => {
    it('should get contact by alias', () => {
      contacts.add('bob', { npub: 'npub1bob', name: 'Bob' });

      const contact = contacts.get('bob');

      assert.ok(contact);
      assert.strictEqual(contact.name, 'Bob');
      assert.strictEqual(contact.npub, 'npub1bob');
    });

    it('should return null for non-existent alias', () => {
      const contact = contacts.get('nonexistent');
      assert.strictEqual(contact, null);
    });

    it('should find contact by npub', () => {
      contacts.add('charlie', { npub: 'npub1charlie', name: 'Charlie' });

      const result = contacts.getByPubkey('npub1charlie');

      assert.ok(result);
      assert.strictEqual(result.alias, 'charlie');
      assert.strictEqual(result.contact.name, 'Charlie');
    });

    it('should find contact by hex pubkey', () => {
      const hexPubkey = 'abcdef1234567890';
      contacts.add('dave', { npub: hexPubkey, name: 'Dave' });

      const result = contacts.getByPubkey(hexPubkey);

      assert.ok(result);
      assert.strictEqual(result.alias, 'dave');
    });

    it('should return null when pubkey not found', () => {
      const result = contacts.getByPubkey('npub1nonexistent');
      assert.strictEqual(result, null);
    });
  });

  describe('Remove Contact', () => {
    it('should remove existing contact', () => {
      contacts.add('eve', { npub: 'npub1eve', name: 'Eve' });

      const result = contacts.remove('eve');

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.removed, true);
      assert.strictEqual(contacts.get('eve'), null);
    });

    it('should handle removing non-existent contact', () => {
      const result = contacts.remove('nonexistent');

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.removed, false);
    });
  });

  describe('List Contacts', () => {
    it('should return empty array when no contacts', () => {
      const list = contacts.list();

      assert.ok(Array.isArray(list));
      assert.strictEqual(list.length, 0);
    });

    it('should list all contacts with alias', () => {
      contacts.add('alice', { npub: 'npub1alice', name: 'Alice' });
      contacts.add('bob', { npub: 'npub1bob', name: 'Bob' });

      const list = contacts.list();

      assert.strictEqual(list.length, 2);
      assert.ok(list.some(c => c.alias === 'alice'));
      assert.ok(list.some(c => c.alias === 'bob'));
    });

    it('should include alias in listed contacts', () => {
      contacts.add('frank', { npub: 'npub1frank', name: 'Frank' });

      const list = contacts.list();

      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].alias, 'frank');
      assert.strictEqual(list[0].name, 'Frank');
    });
  });

  describe('Export/Import', () => {
    it('should export contacts as object', () => {
      contacts.add('grace', { npub: 'npub1grace', name: 'Grace' });
      contacts.add('henry', { npub: 'npub1henry', name: 'Henry' });

      const exported = contacts.export();

      assert.ok(typeof exported === 'object');
      assert.ok(exported.grace);
      assert.ok(exported.henry);
      assert.strictEqual(exported.grace.name, 'Grace');
      assert.strictEqual(exported.henry.name, 'Henry');
    });

    it('should import contacts from object', () => {
      const data = {
        ian: { npub: 'npub1ian', name: 'Ian', notes: 'Test', createdAt: Date.now(), lastUsed: null },
        jane: { npub: 'npub1jane', name: 'Jane', notes: '', createdAt: Date.now(), lastUsed: null }
      };

      const result = contacts.import(data);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.imported, 2);
      assert.strictEqual(result.errors.length, 0);

      assert.ok(contacts.get('ian'));
      assert.ok(contacts.get('jane'));
    });

    it('should handle import errors gracefully', () => {
      const data = {
        kate: { npub: 'npub1kate', name: 'Kate' },
        // Missing npub
        leo: { name: 'Leo' }
      };

      const result = contacts.import(data);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.imported, 1);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes('leo'));
    });

    it('should handle invalid import data', () => {
      const result1 = contacts.import(null);
      assert.strictEqual(result1.ok, false);

      const result2 = contacts.import('not an object');
      assert.strictEqual(result2.ok, false);
    });
  });

  describe('Touch (Update Last Used)', () => {
    it('should update last used timestamp', () => {
      contacts.add('mary', { npub: 'npub1mary', name: 'Mary' });

      const beforeContact = contacts.get('mary');
      assert.strictEqual(beforeContact.lastUsed, null);

      contacts.touch('mary');

      const afterContact = contacts.get('mary');
      assert.ok(typeof afterContact.lastUsed === 'number');
      assert.ok(afterContact.lastUsed > 0);
    });

    it('should handle touching non-existent contact', () => {
      // Should not throw
      contacts.touch('nonexistent');
    });
  });

  describe('Count', () => {
    it('should return zero when empty', () => {
      const count = contacts.count();
      assert.strictEqual(count.total, 0);
    });

    it('should return correct count', () => {
      contacts.add('nick', { npub: 'npub1nick' });
      contacts.add('olivia', { npub: 'npub1olivia' });
      contacts.add('peter', { npub: 'npub1peter' });

      const count = contacts.count();
      assert.strictEqual(count.total, 3);
    });
  });

  describe('Persistence', () => {
    it('should save and load contacts from file', () => {
      const contacts1 = new ContactsManager();
      contacts1.add('quinn', { npub: 'npub1quinn', name: 'Quinn', notes: 'Test notes' });

      // Create new instance to test loading
      const contacts2 = new ContactsManager();

      const loaded = contacts2.get('quinn');
      assert.ok(loaded);
      assert.strictEqual(loaded.name, 'Quinn');
      assert.strictEqual(loaded.notes, 'Test notes');
    });
  });
});
