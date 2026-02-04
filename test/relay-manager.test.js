/**
 * Relay manager tests
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('Relay Manager', () => {
  describe('RelayManager class', () => {
    it('should be importable', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      assert.ok(RelayManager);
    });

    it('should create instance with default relays', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const relays = ['wss://relay1.test', 'wss://relay2.test'];
      const manager = new RelayManager(relays);

      assert.ok(manager);
      assert.equal(manager.relays.size, 2);
    });
  });

  describe('recordSuccess', () => {
    it('should record successful connection', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://test.relay']);

      manager.recordSuccess('wss://test.relay', 100);

      const stats = manager.relays.get('wss://test.relay');
      assert.ok(stats.successCount >= 1);
    });

    it('should track latency', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://new.latency.relay']);

      manager.recordSuccess('wss://new.latency.relay', 150);

      const stats = manager.relays.get('wss://new.latency.relay');
      assert.ok(stats.totalLatency >= 150);
    });
  });

  describe('recordFailure', () => {
    it('should record failed connection', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://fail.test.relay']);

      manager.recordFailure('wss://fail.test.relay');

      const stats = manager.relays.get('wss://fail.test.relay');
      assert.ok(stats.failureCount >= 1);
    });
  });

  describe('getScore', () => {
    it('should calculate score based on success rate', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://good.relay', 'wss://bad.relay']);

      // Good relay: 10 successes
      for (let i = 0; i < 10; i++) {
        manager.recordSuccess('wss://good.relay', 100);
      }

      // Bad relay: 2 successes, 8 failures
      for (let i = 0; i < 2; i++) {
        manager.recordSuccess('wss://bad.relay', 100);
      }
      for (let i = 0; i < 8; i++) {
        manager.recordFailure('wss://bad.relay');
      }

      const goodScore = manager.getScore('wss://good.relay');
      const badScore = manager.getScore('wss://bad.relay');

      assert.ok(goodScore > badScore, 'Good relay should have higher score');
    });

    it('should factor in latency', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://fast.relay', 'wss://slow.relay']);

      // Both succeed equally but different latency
      for (let i = 0; i < 5; i++) {
        manager.recordSuccess('wss://fast.relay', 50);  // 50ms
        manager.recordSuccess('wss://slow.relay', 500); // 500ms
      }

      const fastScore = manager.getScore('wss://fast.relay');
      const slowScore = manager.getScore('wss://slow.relay');

      assert.ok(fastScore > slowScore, 'Fast relay should have higher score');
    });

    it('should return default score for unknown relay', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager([]);

      const score = manager.getScore('wss://unknown.relay');
      assert.equal(score, 0);
    });

    it('should return 0.5 for new relay with no data', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://new.relay']);

      const score = manager.getScore('wss://new.relay');
      assert.equal(score, 0.5);
    });
  });

  describe('getHealthyRelays', () => {
    it('should return relays sorted by score', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager([
        'wss://best.relay',
        'wss://good.relay',
        'wss://bad.relay'
      ]);

      // Setup different success patterns
      for (let i = 0; i < 10; i++) {
        manager.recordSuccess('wss://best.relay', 50);
      }
      for (let i = 0; i < 7; i++) {
        manager.recordSuccess('wss://good.relay', 100);
      }
      for (let i = 0; i < 3; i++) {
        manager.recordFailure('wss://good.relay');
      }
      for (let i = 0; i < 2; i++) {
        manager.recordSuccess('wss://bad.relay', 200);
      }
      for (let i = 0; i < 8; i++) {
        manager.recordFailure('wss://bad.relay');
      }

      const healthy = manager.getHealthyRelays();

      assert.ok(healthy.length > 0);
      assert.equal(healthy[0], 'wss://best.relay');
    });
  });

  describe('getBestRelay', () => {
    it('should return relay with highest score', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager([
        'wss://best.relay',
        'wss://good.relay'
      ]);

      for (let i = 0; i < 10; i++) {
        manager.recordSuccess('wss://best.relay', 50);
      }
      for (let i = 0; i < 5; i++) {
        manager.recordSuccess('wss://good.relay', 100);
      }

      const best = manager.getBestRelay();
      assert.equal(best, 'wss://best.relay');
    });

    it('should return null when no relays', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager([]);

      const best = manager.getBestRelay();
      assert.equal(best, null);
    });
  });

  describe('addRelay', () => {
    it('should add new relay', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager([]);

      manager.addRelay('wss://new.relay');

      assert.equal(manager.relays.size, 1);
      assert.ok(manager.relays.has('wss://new.relay'));
    });

    it('should not duplicate existing relay', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://existing.relay']);

      manager.addRelay('wss://existing.relay');

      assert.equal(manager.relays.size, 1);
    });
  });

  describe('removeRelay', () => {
    it('should remove relay', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://remove.relay', 'wss://keep.relay']);

      manager.removeRelay('wss://remove.relay');

      assert.equal(manager.relays.size, 1);
      assert.ok(!manager.relays.has('wss://remove.relay'));
      assert.ok(manager.relays.has('wss://keep.relay'));
    });
  });

  describe('getAllRelayStatus', () => {
    it('should return status for all relays', async () => {
      const { RelayManager } = await import('../src/network/relay-manager.js');
      const manager = new RelayManager(['wss://relay1', 'wss://relay2']);

      manager.recordSuccess('wss://relay1', 100);
      manager.recordFailure('wss://relay2');

      const status = manager.getAllRelayStatus();

      assert.equal(status.length, 2);
      assert.ok(status.every(s => 'relay' in s && 'healthy' in s && 'score' in s));
    });
  });
});
