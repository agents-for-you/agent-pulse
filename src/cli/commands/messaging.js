/**
 * Messaging commands: send, recv, peek, watch, result
 */
import {
  readMessages,
  sendMessage,
  getSendResult,
  readResults,
  isRunning,
  start as startService
} from '../../service/server.js';
import { ErrorCode } from '../../service/shared.js';
import { getContacts } from '../../service/contacts.js';
import { out, showProgress } from '../utils/output.js';
import { normalizePubkey, parseMessageOptions } from '../utils/args-parser.js';
import { ensureServiceRunning } from '../middleware/auto-start.js';

export const commands = {
  // Read messages (and clear) - supports filter options
  recv(args) {
    const options = parseMessageOptions(args);
    const messages = readMessages(true, options);
    out({ ok: true, count: messages.length, messages });
  },

  // View messages (don't clear) - supports filter options
  peek(args) {
    const options = parseMessageOptions(args);
    const messages = readMessages(false, options);
    out({ ok: true, count: messages.length, messages });
  },

  // Watch for new messages in real-time (streaming JSON lines)
  async watch(args) {
    const options = parseMessageOptions(args);

    // Parse watch-specific options
    let count = 0;
    let maxCount = Infinity;
    const countIndex = args.indexOf('--count');
    if (countIndex !== -1 && args[countIndex + 1]) {
      maxCount = parseInt(args[countIndex + 1], 10) || Infinity;
    }

    // Ensure service is running
    const { isRunning: runningCheck, start } = await import('../../service/server.js');
    if (!runningCheck()) {
      const progress = showProgress('Starting service for watch mode');
      const started = await start();
      progress.stop(started.ok ? 'Service started' : 'Failed to start');
      if (!started.ok) {
        out(started);
        return;
      }
      // Wait for service to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    out({ ok: true, watching: true, message: 'Streaming messages (Ctrl+C to stop)...' });

    // Poll for new messages
    const interval = setInterval(async () => {
      const messages = readMessages(false, options);
      if (messages.length > 0) {
        for (const msg of messages) {
          count++;
          if (count <= maxCount) {
            // Output as JSON lines for streaming
            console.log(JSON.stringify({ ...msg, _stream: true }));
          }
        }
        // Clear after processing
        readMessages(true, options);

        if (count >= maxCount) {
          clearInterval(interval);
          console.log(JSON.stringify({ _done: true, totalProcessed: count }));
          process.exit(0);
        }
      }
    }, 1000);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(JSON.stringify({ _done: true, totalProcessed: count }));
      process.exit(0);
    });
  },

  // Send message: send <pubkey|npub|@alias> <message>
  async send(args) {
    const [target, ...rest] = args;
    const content = rest.join(' ');

    if (!target || !content) {
      out({ ok: false, code: ErrorCode.INVALID_ARGS, error: 'usage: send <pubkey|npub|@alias> <message>' });
      return;
    }

    try {
      let normalizedTarget = target;

      // Handle @alias syntax
      if (target.startsWith('@')) {
        const alias = target.slice(1);
        const contacts = getContacts();
        const contact = contacts.get(alias);

        if (!contact) {
          out({ ok: false, code: ErrorCode.INVALID_ARGS, error: `Contact not found: @${alias}` });
          return;
        }

        normalizedTarget = contact.npub || contact.pubkey;
        // Update last used timestamp
        contacts.touch(alias);
      } else {
        normalizedTarget = normalizePubkey(target, 'public');
      }

      const result = await sendMessage(normalizedTarget, content, { autoStart: true });
      out(result);
    } catch (err) {
      out({ ok: false, code: ErrorCode.INVALID_PUBKEY, error: err.message });
    }
  },

  // Query send result: result <cmdId>
  result(args) {
    const [cmdId] = args;

    if (cmdId) {
      const result = getSendResult(cmdId);
      out(result || { ok: false, code: 'NOT_FOUND' });
    } else {
      // Read all results
      const results = readResults(true);
      out({ ok: true, count: results.length, results });
    }
  }
};
