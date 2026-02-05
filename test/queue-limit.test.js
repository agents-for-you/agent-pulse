/**
 * @fileoverview Message queue size limit tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MessageQueue } from '../src/service/message-queue.js';
import { CONFIG } from '../src/service/shared.js';

describe('MessageQueue - Size Limit', () => {
  it('should enforce maximum queue size', () => {
    const queue = new MessageQueue();
    queue.clear(); // Clear any pre-loaded messages

    const originalMaxSize = CONFIG.MAX_QUEUE_SIZE;
    CONFIG.MAX_QUEUE_SIZE = 5;

    // Add 10 messages
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const id = queue.enqueue('test', `target-${i}`, `content-${i}`);
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

    CONFIG.MAX_QUEUE_SIZE = originalMaxSize;
    queue.clear();
  });

  it('should drop oldest message when queue is full', () => {
    const queue = new MessageQueue();
    queue.clear();

    const originalMaxSize = CONFIG.MAX_QUEUE_SIZE;
    CONFIG.MAX_QUEUE_SIZE = 3;

    const id1 = queue.enqueue('test', 'target', 'msg1');
    const id2 = queue.enqueue('test', 'target', 'msg2');
    const id3 = queue.enqueue('test', 'target', 'msg3');

    // Queue is full
    assert.strictEqual(queue.queue.size, 3);

    // Add one more - should drop msg1
    const id4 = queue.enqueue('test', 'target', 'msg4');

    assert.strictEqual(queue.queue.size, 3);
    assert.strictEqual(queue.getMessage(id1), null); // msg1 dropped
    assert.notStrictEqual(queue.getMessage(id2), null);
    assert.notStrictEqual(queue.getMessage(id3), null);
    assert.notStrictEqual(queue.getMessage(id4), null);

    CONFIG.MAX_QUEUE_SIZE = originalMaxSize;
    queue.clear();
  });

  it('should maintain queue size at limit', () => {
    const queue = new MessageQueue();
    queue.clear();

    const originalMaxSize = CONFIG.MAX_QUEUE_SIZE;
    CONFIG.MAX_QUEUE_SIZE = 3;

    // Add 100 messages - queue should never exceed limit
    for (let i = 0; i < 100; i++) {
      queue.enqueue('test', 'target', `msg${i}`);
      const currentSize = queue.queue.size;
      assert.ok(currentSize <= 3, `Queue size ${currentSize} should not exceed limit after ${i + 1} messages`);
    }

    // Final check: queue should be exactly at limit
    assert.strictEqual(queue.queue.size, 3);

    CONFIG.MAX_QUEUE_SIZE = originalMaxSize;
    queue.clear();
  });
});
