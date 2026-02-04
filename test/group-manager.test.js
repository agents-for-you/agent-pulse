/**
 * Group manager tests
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Group Manager', () => {
  describe('GroupManager class', () => {
    it('should be importable', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      assert.ok(GroupManager);
    });

    it('should create instance', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();
      assert.ok(manager);
      assert.ok(typeof manager.createGroup === 'function');
    });
  });

  describe('createGroup', () => {
    it('should create a new group', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const result = manager.createGroup('Test Group', 'owner123');

      assert.equal(result.ok, true);
      assert.ok(result.groupId);
      assert.ok(result.topic);
    });

    it('should reject short name', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const result = manager.createGroup('X', 'owner123');

      assert.equal(result.ok, false);
    });
  });

  describe('getMembers', () => {
    it('should return members of a group', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      const members = manager.getMembers(createResult.groupId);

      assert.equal(members.ok, true);
      assert.equal(members.memberCount, 1);
      assert.ok(members.members.find(m => m.pubkey === 'owner123'));
    });

    it('should return error for non-existent group', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const result = manager.getMembers('non-existent');
      assert.equal(result.ok, false);
    });
  });

  describe('hasAdminPermission', () => {
    it('should return true for owner', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');

      assert.equal(manager.hasAdminPermission(createResult.groupId, 'owner123'), true);
    });

    it('should return false for regular member', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member456');

      assert.equal(manager.hasAdminPermission(createResult.groupId, 'member456'), false);
    });

    it('should return false for non-existent group', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      assert.equal(manager.hasAdminPermission('non-existent', 'anyone'), false);
    });
  });

  describe('canSendMessage', () => {
    it('should allow owner to send', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      const canSend = manager.canSendMessage(createResult.groupId, 'owner123');

      assert.equal(canSend.ok, true);
    });

    it('should allow member to send', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member456');

      const canSend = manager.canSendMessage(createResult.groupId, 'member456');
      assert.equal(canSend.ok, true);
    });

    it('should block banned member', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'badguy');
      manager.banMember(createResult.groupId, 'owner123', 'badguy');

      const canSend = manager.canSendMessage(createResult.groupId, 'badguy');
      assert.equal(canSend.ok, false);
    });

    it('should block muted member', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'muteduser');
      manager.muteMember(createResult.groupId, 'owner123', 'muteduser', 3600);

      const canSend = manager.canSendMessage(createResult.groupId, 'muteduser');
      assert.equal(canSend.ok, false);
    });
  });

  describe('kickMember', () => {
    it('should allow admin to kick member', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member456');

      const result = manager.kickMember(createResult.groupId, 'owner123', 'member456');
      assert.equal(result.ok, true);
    });

    it('should not allow regular member to kick', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member1');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member2');

      const result = manager.kickMember(createResult.groupId, 'member1', 'member2');
      assert.equal(result.ok, false);
    });

    it('should not allow kicking owner', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'admin456');
      manager.setAdmin(createResult.groupId, 'owner123', 'admin456', true);

      const result = manager.kickMember(createResult.groupId, 'admin456', 'owner123');
      assert.equal(result.ok, false);
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership to another member', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'newowner');

      const result = manager.transferOwnership(createResult.groupId, 'owner123', 'newowner');
      assert.equal(result.ok, true);

      // Verify new owner
      const group = manager.getGroup(createResult.groupId);
      assert.equal(group.owner, 'newowner');
    });

    it('should only allow owner to transfer', async () => {
      const { GroupManager } = await import('../src/service/group-manager.js');
      const manager = new GroupManager();

      const createResult = manager.createGroup('Test Group', 'owner123');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member1');
      manager.joinGroup(createResult.groupId, createResult.topic, 'member2');

      const result = manager.transferOwnership(createResult.groupId, 'member1', 'member2');
      assert.equal(result.ok, false);
    });
  });

  describe('groupManager singleton', () => {
    it('should export singleton instance', async () => {
      const { groupManager } = await import('../src/service/group-manager.js');

      assert.ok(groupManager);
      assert.ok(typeof groupManager.createGroup === 'function');
      assert.ok(typeof groupManager.getMembers === 'function');
    });
  });
});
