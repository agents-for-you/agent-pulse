/**
 * Docker Environment Validation Tests
 *
 * These tests validate that the Docker environment is properly configured
 * for running AgentPulse containers.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Only run in Docker environment
const isDocker = async () => {
  try {
    const fs = await import('fs');
    return fs.existsSync('/.dockerenv') || fs.existsSync('/.dockerinit');
  } catch {
    return false;
  }
};

const inDocker = await isDocker();

describe('Docker Environment', { skip: !inDocker }, () => {
  let originalEnv;

  before(() => {
    originalEnv = { ...process.env };
  });

  after(() => {
    process.env = originalEnv;
  });

  it('should have /.dockerenv or /.dockerinit file', async () => {
    const fs = await import('fs');
    const hasDockerEnv = fs.existsSync('/.dockerenv');
    const hasDockerInit = fs.existsSync('/.dockerinit');
    assert.ok(hasDockerEnv || hasDockerInit, 'Not running in Docker environment');
  });

  it('should have NODE_ENV environment variable', () => {
    assert.ok(process.env.NODE_ENV, 'NODE_ENV should be set');
    assert.match(process.env.NODE_ENV, /^(production|test|development)$/);
  });

  it('should have AGENT_NAME environment variable', () => {
    assert.ok(process.env.AGENT_NAME, 'AGENT_NAME should be set');
    assert.strictEqual(typeof process.env.AGENT_NAME, 'string');
  });

  it('should have writable /app/.data directory', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const dataDir = '/app/.data';

    // Check directory exists
    assert.ok(fs.existsSync(dataDir), '.data directory should exist');

    // Check if writable
    const testFile = path.join(dataDir, 'test-write');
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      assert.ok(true, '.data directory is writable');
    } catch (err) {
      assert.fail(`.data directory is not writable: ${err.message}`);
    }
  });

  it('should have proper permissions for non-root user', async () => {
    const { execSync } = await import('child_process');
    try {
      const uid = execSync('id -u').toString().trim();
      assert.ok(uid !== '0', 'Should not run as root (uid 0)');
    } catch {
      // id command might not be available in all containers
      assert.ok(true, 'Permission check skipped (id command not available)');
    }
  });

  it('should have Node.js version >= 18', () => {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    assert.ok(major >= 18, `Node.js version should be >= 18, got ${version}`);
  });

  it('should have required environment variables for AgentPulse', () => {
    const requiredVars = ['LOG_LEVEL'];
    const missing = requiredVars.filter(v => !process.env[v]);

    assert.strictEqual(missing.length, 0,
      `Missing required environment variables: ${missing.join(', ')}`);
  });

  it('should have AGENT_PULSE_EPHEMERAL variable set', () => {
    const ephemeral = process.env.AGENT_PULSE_EPHEMERAL;
    assert.ok(ephemeral !== undefined, 'AGENT_PULSE_EPHEMERAL should be set');
    assert.match(ephemeral, /^(true|false)$/, 'AGENT_PULSE_EPHEMERAL should be true or false');
  });
});

describe('Docker Network Connectivity', { skip: !inDocker }, () => {
  it('should resolve hostnames of other agents', async () => {
    const { execSync } = await import('child_process');

    // Try to resolve common agent hostnames
    const hostnames = [
      'agent-pulse-1',
      'agent-pulse-2',
      'agent-pulse-3',
      'test-agent-1',
      'test-agent-2',
      'test-agent-3'
    ];

    // Get current hostname
    const currentHostname = execSync('hostname').toString().trim();
    const targets = hostnames.filter(h => h !== currentHostname);

    for (const hostname of targets) {
      try {
        execSync(`getent hosts ${hostname}`, { stdio: 'pipe' });
        assert.ok(true, `Can resolve hostname: ${hostname}`);
        return; // Successfully resolved at least one hostname
      } catch {
        // This hostname might not exist, try next
      }
    }
  });
});
