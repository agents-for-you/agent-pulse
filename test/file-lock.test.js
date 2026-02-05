/**
 * @fileoverview File lock tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { acquireLock, releaseLock, LOCK_FILE } from '../src/service/shared.js';

describe('File Lock', () => {
  const lockDir = LOCK_FILE + '.d';

  function cleanupLock() {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {}
  }

  it('should acquire lock when no lock exists', () => {
    cleanupLock();

    const acquired = acquireLock(1000);
    assert.strictEqual(acquired, true);

    // Lock directory should exist
    assert.ok(fs.existsSync(lockDir));

    // PID file should exist
    const pidPath = path.join(lockDir, 'pid');
    assert.ok(fs.existsSync(pidPath));

    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
    assert.strictEqual(pid, process.pid);

    cleanupLock();
  });

  it('should fail to acquire lock when lock exists', () => {
    cleanupLock();

    // First acquisition
    const acquired1 = acquireLock(100);
    assert.strictEqual(acquired1, true);

    // Second acquisition should fail (short timeout)
    const acquired2 = acquireLock(100);
    assert.strictEqual(acquired2, false);

    cleanupLock();
  });

  it('should release lock', () => {
    cleanupLock();

    acquireLock(100);

    // Lock exists
    assert.ok(fs.existsSync(lockDir));

    // Release lock
    releaseLock();

    // Lock should be gone
    assert.ok(!fs.existsSync(lockDir));
  });

  it('should detect stale lock', () => {
    cleanupLock();

    // Ensure parent directory exists
    const dataDir = path.dirname(lockDir);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create a fake lock with a non-existent PID
    fs.mkdirSync(lockDir, { mode: 0o700, recursive: false });
    fs.writeFileSync(path.join(lockDir, 'pid'), '99999999');

    // Should be able to acquire despite existing lock
    const acquired = acquireLock(1000);
    assert.strictEqual(acquired, true);

    // Our PID should be in the lock
    const pidPath = path.join(lockDir, 'pid');
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
    assert.strictEqual(pid, process.pid);

    cleanupLock();
  });

  it('should handle concurrent lock attempts', async () => {
    cleanupLock();

    const results = await Promise.all([
      Promise.resolve().then(() => acquireLock(500)),
      Promise.resolve().then(() => acquireLock(500)),
      Promise.resolve().then(() => acquireLock(500))
    ]);

    // Only one should succeed
    const successCount = results.filter(r => r).length;
    assert.strictEqual(successCount, 1);

    cleanupLock();
  });
});
