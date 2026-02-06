#!/usr/bin/env node
/**
 * AgentPulse CLI - Modular entry point
 * All outputs are JSON format for easy Agent parsing
 */
import { ErrorCode } from '../service/shared.js';
import { out } from './utils/output.js';

// Import command modules
import { commands as serviceCommands } from './commands/service.js';
import { commands as messagingCommands } from './commands/messaging.js';
import { commands as contactsCommands } from './commands/contacts.js';
import { commands as groupsCommands } from './commands/groups.js';
import { commands as relayCommands } from './commands/relay.js';
import { commands as updateCommands } from './commands/update.js';
import { help } from './commands/help.js';

// Combine all commands into a single registry
const commands = {
  ...serviceCommands,
  ...messagingCommands,
  ...contactsCommands,
  ...groupsCommands,
  ...relayCommands,
  ...updateCommands,
  help
};

// Main function
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    help();
    process.exit(0);
  }

  if (commands[cmd]) {
    try {
      await commands[cmd](args);
    } catch (err) {
      // Distinguish different error types for debugging
      let errorCode = ErrorCode.INTERNAL_ERROR;
      let errorMsg = err.message;

      // Distinguish by error type
      if (err.name === 'TypeError') {
        errorCode = 'TYPE_ERROR';
      } else if (err.code === 'ENOENT') {
        errorCode = ErrorCode.FILE_ERROR;
      } else if (err.message.includes('ECONNREFUSED')) {
        errorCode = ErrorCode.NETWORK_DISCONNECTED;
      }

      out({ ok: false, code: errorCode, error: errorMsg });
    }
  } else {
    out({ ok: false, code: ErrorCode.UNKNOWN_COMMAND, error: `unknown: ${cmd}` });
  }

  process.exit(0);
}

main();
