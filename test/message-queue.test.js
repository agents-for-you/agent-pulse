/**
 * Message queue tests
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Message Queue', () => {
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-test-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('MessageQueue class', () => {
    it('should be importable', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      assert.ok(MessageQueue);
    });

    it('should create instance with default options', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();

      assert.ok(queue);
      assert.ok(queue.queue instanceof Map);
    });
  });

  describe('enqueue', () => {
    it('should add message to queue and return id', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();
      const sizeBefore = queue.queue.size;

      const id = await queue.enqueue('send', 'pubkey123', 'Hello');

      assert.ok(id);
      assert.equal(typeof id, 'string');
      assert.equal(queue.queue.size, sizeBefore + 1);
    });

    it('should create entry with correct fields', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();

      const id = await queue.enqueue('send', 'target123', 'content123');
      const entry = queue.queue.get(id);

      assert.ok(entry);
      assert.equal(entry.type, 'send');
      assert.equal(entry.target, 'target123');
      assert.equal(entry.content, 'content123');
      assert.equal(entry.retryCount, 0);
      assert.ok(entry.createdAt);
    });
  });

  describe('markSuccess', () => {
    it('should remove message from queue', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();

      const id = await queue.enqueue('send', 'target', 'content');
      assert.ok(queue.queue.has(id));

      await queue.markSuccess(id);
      assert.ok(!queue.queue.has(id));
    });
  });

  describe('markFailure', () => {
    it('should increment retry count', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();

      const id = await queue.enqueue('send', 'target', 'content');

      await queue.markFailure(id, 'Network error');

      const entry = queue.queue.get(id);
      assert.equal(entry.retryCount, 1);
      assert.equal(entry.lastError, 'Network error');
    });

    it('should set next retry time with delay', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();

      const id = await queue.enqueue('send', 'target', 'content');
      const before = Date.now();

      await queue.markFailure(id, 'Error');

      const entry = queue.queue.get(id);
      assert.ok(entry.nextRetryAt >= before);
    });

    it('should return false when retry exhausted', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();

      const id = await queue.enqueue('send', 'target', 'content');

      // Fail multiple times until retries exhausted
      let canRetry = true;
      for (let i = 0; i < 10 && canRetry; i++) {
        canRetry = await queue.markFailure(id, `Error ${i}`);
      }

      assert.equal(canRetry, false);
    });
  });

  describe('getPendingMessages', () => {
    it('should return messages ready for retry', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init();
      await queue.clear();

      // Add immediately retryable messages
      await queue.enqueue('send', 'target1', 'content1');
      await queue.enqueue('send', 'target2', 'content2');

      const pending = queue.getPendingMessages();
      assert.ok(pending.length >= 2);
    });
  });

  describe('getStatus', () => {
    it('should return queue status', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();

      const status = queue.getStatus();

      assert.ok('total' in status);
      assert.ok('pending' in status);
      assert.ok('waiting' in status);
    });
  });

  describe('cleanExpired', () => {
    it('should remove expired messages', async () => {
      const { MessageQueue } = await import('../src/service/message-queue.js');
      const queue = new MessageQueue();
      await queue.init(); // Initialize first

      // Add expired message
      const expiredId = 'expired-' + Date.now();
      queue.queue.set(expiredId, {
        id: expiredId,
        type: 'send',
        target: 'x',
        content: 'y',
        createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        retryCount: 0,
        nextRetryAt: Date.now()
      });

      const removed = await queue.cleanExpired();

      assert.ok(removed >= 1);
      assert.ok(!queue.queue.has(expiredId));
    });
  });

  describe('messageQueue singleton', () => {
    it('should export singleton instance', async () => {
      const { messageQueue } = await import('../src/service/message-queue.js');

      assert.ok(messageQueue);
      assert.ok(typeof messageQueue.enqueue === 'function');
      assert.ok(typeof messageQueue.markSuccess === 'function');
      assert.ok(typeof messageQueue.markFailure === 'function');
    });
  });
});
