/**
 * Contacts commands: contacts, contacts-*
 */
import { getContacts } from '../../service/contacts.js';
import { ErrorCode } from '../../service/shared.js';
import { out } from '../utils/output.js';

export const commands = {
  // List all contacts
  contacts() {
    const contacts = getContacts();
    const list = contacts.list();
    out({ ok: true, count: list.length, contacts: list });
  },

  // Add contact: contacts-add <alias> <npub|hex> [name] [notes...]
  'contacts-add'(args) {
    const [alias, npub, ...rest] = args;

    if (!alias || !npub) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-add <alias> <npub|hex> [name] [notes...]'
      });
      return;
    }

    // Split name and notes (name is first word after npub, rest are notes)
    let name = '';
    let notes = '';
    if (rest.length > 0) {
      // Check if the first arg looks like the start of notes (contains spaces or special chars)
      // For simplicity, if there are multiple args, first is name, rest are notes
      name = rest[0] || '';
      if (rest.length > 1) {
        notes = rest.slice(1).join(' ');
      }
    }

    const contacts = getContacts();
    const result = contacts.add(alias, { npub, name, notes });
    out(result);
  },

  // Remove contact: contacts-remove <alias>
  'contacts-remove'(args) {
    const [alias] = args;

    if (!alias) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-remove <alias>'
      });
      return;
    }

    const contacts = getContacts();
    const result = contacts.remove(alias);
    out(result);
  },

  // Get contact: contacts-get <alias>
  'contacts-get'(args) {
    const [alias] = args;

    if (!alias) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-get <alias>'
      });
      return;
    }

    const contacts = getContacts();
    const contact = contacts.get(alias);

    if (!contact) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: `Contact not found: ${alias}`
      });
      return;
    }

    out({ ok: true, alias, contact });
  },

  // Export contacts: contacts-export [file]
  async 'contacts-export'(args) {
    const [file] = args;
    const contacts = getContacts();
    const data = contacts.export();

    if (file) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const fullPath = path.resolve(file);
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
        out({
          ok: true,
          exported: data,
          file: fullPath,
          count: Object.keys(data).length
        });
      } catch (err) {
        out({
          ok: false,
          code: ErrorCode.FILE_ERROR,
          error: err.message
        });
      }
    } else {
      out({ ok: true, contacts: data, count: Object.keys(data).length });
    }
  },

  // Import contacts: contacts-import <file>
  async 'contacts-import'(args) {
    const [file] = args;

    if (!file) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-import <file>'
      });
      return;
    }

    try {
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.resolve(file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const data = JSON.parse(content);

      const contacts = getContacts();
      const result = contacts.import(data);
      out(result);
    } catch (err) {
      out({
        ok: false,
        code: ErrorCode.FILE_ERROR,
        error: err.message
      });
    }
  },

  // Find contact by pubkey: contacts-find <npub|hex>
  'contacts-find'(args) {
    const [pubkey] = args;

    if (!pubkey) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: 'usage: contacts-find <npub|hex>'
      });
      return;
    }

    const contacts = getContacts();
    const result = contacts.getByPubkey(pubkey);

    if (!result) {
      out({
        ok: false,
        code: ErrorCode.INVALID_ARGS,
        error: `No contact found with pubkey: ${pubkey.slice(0, 16)}...`
      });
      return;
    }

    out({ ok: true, alias: result.alias, contact: result.contact });
  }
};
