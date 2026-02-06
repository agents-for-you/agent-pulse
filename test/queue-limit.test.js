/**
 * @fileoverview Message queue size limit tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MessageQueue } from '../src/service/message-queue.js';
import { CONFIG } from '../src/service/shared.js';
import { safeUnlinkAsync } from '../src/utils/json-file.js';
import path from 'path';
import { DATA_DIR } from '../src/service/shared.js';

describe('MessageQueue - Size Limit', () => {
  let originalMaxSize;

  beforeEach(async () => {
    originalMaxSize = CONFIG.MAX_QUEUE_SIZE;
    // Clear offline queue file to ensure clean state
    try {
      await safeUnlinkAsync(path.join(DATA_DIR, 'offline_queue.jsonl'));
    } catch {}
  });

  afterEach(() => {
    CONFIG.MAX_QUEUE_SIZE = originalMaxSize;
  });

  it('should enforce maximum queue size', async () => {
    const queue = new MessageQueue();
    await queue.init(); // Initialize before clear
    await queue.clear(); // Clear any pre-loaded messages

    CONFIG.MAX_QUEUE_SIZE = 5;

    // Add 10 messages
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const id = await queue.enqueue('test', `target-${i}`, `content-${i}`);
      ids.push(id);
    }

    // Queue should only have 5 messages (the limit)
    assert.strictEqual(queue.queue.size, 5);

    // The oldest 5 messages should have been dropped
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(queue.getMessage(ids[i]), null);
    }

    // The newest 5 messages should be present
    for (let i = 5; i < 10; i++) {
      const msg = queue.getMessage(ids[i]);
      assert.notStrictEqual(msg, null);
      assert.strictEqual(msg.content, `content-${i}`);
    }

    await queue.clear();
  });

  it('should drop oldest message when queue is full', async () => {
    const queue = new MessageQueue();
    await queue.init();
    await queue.clear();

    CONFIG.MAX_QUEUE_SIZE = 3;

    const id1 = await queue.enqueue('test', 'target', 'msg1');
    const id2 = await queue.enqueue('test', 'target', 'msg2');
    const id3 = await queue.enqueue('test', 'target', 'msg3');

    // Queue is full
    assert.strictEqual(queue.queue.size, 3);

    // Add one more - should drop msg1
    const id4 = await queue.enqueue('test', 'target', 'msg4');

    assert.strictEqual(queue.queue.size, 3);
    assert.strictEqual(queue.getMessage(id1), null); // msg1 dropped
    assert.notStrictEqual(queue.getMessage(id2), null);
    assert.notStrictEqual(queue.getMessage(id3), null);
    assert.notStrictEqual(queue.getMessage(id4), null);

    await queue.clear();
  });

  it('should maintain queue size at limit', async () => {
    const queue = new MessageQueue();
    await queue.init();
    await queue.clear();

    CONFIG.MAX_QUEUE_SIZE = 3;

    // Add 100 messages - queue should never exceed limit
    for (let i = 0; i < 100; i++) {
      await queue.enqueue('test', 'target', `msg${i}`);
      const currentSize = queue.queue.size;
      assert.ok(currentSize <= 3, `Queue size ${currentSize} should not exceed limit after ${i + 1} messages`);
    }

    // Final check: queue should be exactly at limit
    assert.strictEqual(queue.queue.size, 3);

    await queue.clear();
  });
});
