#!/usr/bin/env node
/**
 * Docker Integration Test for AgentPulse
 *
 * This test validates agent-to-agent communication in a Docker environment.
 * It should be run from within a Docker container using docker-compose.test.yml
 *
 * Usage (from host):
 *   docker-compose -f test/docker/docker-compose.test.yml up --abort-on-container-exit
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { describe, it } from 'node:test';
import assert from 'node:assert';

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

// Check if we're running in Docker environment
async function isRunningInDocker() {
  try {
    await fs.access('/.dockerenv');
    return true;
  } catch {
    return false;
  }
}

async function runCommand(container, command) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      container,
      'sh', '-c',
      command
    ];

    const proc = spawn('docker', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

async function waitForAgent(container, timeout = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = await runCommand(container, 'test -f /app/.data/server.pid && cat /app/.data/server.pid');
      if (result.stdout) {
        return true;
      }
    } catch {
      // PID file not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Agent ${container} failed to start within ${timeout}ms`);
}

async function getAgentPubkey(container) {
  const result = await runCommand(container, 'node -e "import(\'./src/core/identity.js\').then(m => { const id = m.loadOrCreateIdentity(); console.log(id.pubkey); })"');
  return result.stdout.trim();
}

async function sendDirectMessage(fromContainer, toPubkey, message) {
  const result = await runCommand(
    fromContainer,
    `node index.js send ${toPubkey} "${message}"`
  );
  return result.stdout;
}

async function receiveMessages(container, clear = true) {
  const clearFlag = clear ? ' true' : '';
  const result = await runCommand(
    container,
    `node -e "import('./src/service/server.js').then(m => m.readMessages(${clearFlag}).then(r => console.log(JSON.stringify(r))))"`
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

async function checkAgentHealth(container) {
  try {
    const result = await runCommand(container, 'node index.js status');
    return result.stdout.includes('"running":true') || result.stdout.includes('running: true');
  } catch {
    return false;
  }
}

// Define tests using node:test
describe('Docker Integration Tests', { skip: !(await isRunningInDocker()) }, () => {
  const AGENT_COUNT = 3;
  const TEST_MESSAGE = `Docker integration test message at ${Date.now()}`;

  it('should have all agents running', async () => {
    log('\n============================================================', colors.cyan);
    log('Test: Verifying all agents are healthy', colors.cyan);
    log('============================================================', colors.cyan);

    for (let i = 1; i <= AGENT_COUNT; i++) {
      const container = `agent-pulse-test-${i}`;
      log(`  Checking ${container}...`, colors.blue);
      const isHealthy = await checkAgentHealth(container);
      assert.ok(isHealthy, `${container} should be healthy`);
      log(`  PASS: ${container} is healthy`, colors.green);
    }
  });

  it('should get agent pubkeys', async () => {
    log('\n============================================================', colors.cyan);
    log('Test: Getting agent pubkeys', colors.cyan);
    log('============================================================', colors.cyan);

    const pubkeys = {};
    for (let i = 1; i <= AGENT_COUNT; i++) {
      const container = `agent-pulse-test-${i}`;
      const pubkey = await getAgentPubkey(container);
      log(`  ${container}: ${pubkey.slice(0, 16)}...`, colors.blue);
      pubkeys[container] = pubkey;
      assert.ok(pubkey && pubkey.length === 64, `${container} should have valid pubkey`);
    }
    log('  PASS: All pubkeys retrieved', colors.green);
  });

  it('should send direct message between agents', async () => {
    log('\n============================================================', colors.cyan);
    log('Test: Direct message communication', colors.cyan);
    log('============================================================', colors.cyan);

    const pubkey1 = await getAgentPubkey('agent-pulse-test-1');
    const pubkey2 = await getAgentPubkey('agent-pulse-test-2');

    // Agent 1 sends message to Agent 2
    log(`  Sending message from agent-1 to agent-2...`, colors.blue);
    await sendDirectMessage('agent-pulse-test-1', pubkey2, TEST_MESSAGE);

    // Wait for message to propagate
    await new Promise(r => setTimeout(r, 5000));

    // Agent 2 receives messages
    log(`  Checking messages on agent-2...`, colors.blue);
    const messages = await receiveMessages('agent-pulse-test-2');

    const found = messages.some(m =>
      m.from === pubkey1 &&
      m.content === TEST_MESSAGE
    );

    assert.ok(found, 'Agent 2 should receive message from Agent 1');
    log('  PASS: Message received successfully', colors.green);
  });

  it('should verify network connectivity', async () => {
    log('\n============================================================', colors.cyan);
    log('Test: Network connectivity', colors.cyan);
    log('============================================================', colors.cyan);

    const result = await runCommand(
      'agent-pulse-test-1',
      'ping -c 2 agent-pulse-test-2'
    );

    assert.ok(
      result.stdout.includes('2 packets received') || result.stdout.includes('2 received'),
      'Network connectivity should work'
    );
    log('  PASS: Network connectivity verified', colors.green);
  });

  it('should verify persistent storage', async () => {
    log('\n============================================================', colors.cyan);
    log('Test: Persistent storage across restart', colors.cyan);
    log('============================================================', colors.cyan);

    const pubkeyBefore = await getAgentPubkey('agent-pulse-test-1');

    // Restart container
    log('  Restarting agent-pulse-test-1...', colors.blue);
    await runCommand('', 'docker restart agent-pulse-test-1');

    // Wait for restart
    await new Promise(r => setTimeout(r, 5000));

    const pubkeyAfter = await getAgentPubkey('agent-pulse-test-1');

    assert.strictEqual(pubkeyBefore, pubkeyAfter, 'Identity should persist across restart');
    log('  PASS: Persistent storage verified', colors.green);
  });
});
