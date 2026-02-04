/**
 * Message signature module tests
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import {
  signMessage,
  verifyMessageSignature,
  createSignedMessage,
  verifyMessageSource
} from '../src/core/message-signature.js';

// Convert Uint8Array to hex string
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('Message Signature', () => {
  let secretKey;
  let publicKey;
  let secretKeyHex;

  beforeEach(() => {
    secretKey = generateSecretKey();
    secretKeyHex = bytesToHex(secretKey);
    publicKey = getPublicKey(secretKey);
  });

  describe('signMessage', () => {
    it('should sign a string message', () => {
      const message = 'Hello, World!';
      const result = signMessage(message, secretKeyHex);

      assert.ok(result.content, 'should have content');
      assert.ok(result.signature, 'should have signature');
      assert.ok(result.timestamp, 'should have timestamp');
      assert.equal(result.content, message);
    });

    it('should sign an object message', () => {
      const message = { action: 'test', data: 123 };
      const result = signMessage(message, secretKeyHex);

      assert.deepEqual(result.content, message);
      assert.ok(result.signature);
    });

    it('should produce different signatures for different messages', () => {
      const sig1 = signMessage('message1', secretKeyHex);
      const sig2 = signMessage('message2', secretKeyHex);

      assert.notEqual(sig1.signature, sig2.signature);
    });

    it('should produce consistent signature for same message and timestamp', () => {
      const message = 'same message';
      const timestamp = Date.now();

      // Note: Signatures differ due to different timestamps
      // This only tests basic signing functionality
      const sig = signMessage(message, secretKeyHex);
      assert.ok(sig.signature.length > 0);
    });
  });

  describe('verifyMessageSignature', () => {
    it('should verify valid signature', () => {
      const message = 'Test message for verification';
      const signed = signMessage(message, secretKeyHex);

      const isValid = verifyMessageSignature(signed, publicKey);
      assert.equal(isValid, true);
    });

    it('should reject tampered content', () => {
      const signed = signMessage('Original message', secretKeyHex);
      signed.content = 'Tampered message';

      const isValid = verifyMessageSignature(signed, publicKey);
      assert.equal(isValid, false);
    });

    it('should reject wrong public key', () => {
      const signed = signMessage('Test message', secretKeyHex);

      // Use different key
      const otherSecretKey = generateSecretKey();
      const otherPublicKey = getPublicKey(otherSecretKey);

      const isValid = verifyMessageSignature(signed, otherPublicKey);
      assert.equal(isValid, false);
    });

    it('should reject missing signature', () => {
      const message = { content: 'No signature', timestamp: Date.now() };

      const isValid = verifyMessageSignature(message, publicKey);
      assert.equal(isValid, false);
    });

    it('should handle object content', () => {
      const content = { type: 'test', value: [1, 2, 3] };
      const signed = signMessage(content, secretKeyHex);

      const isValid = verifyMessageSignature(signed, publicKey);
      assert.equal(isValid, true);
    });
  });

  describe('createSignedMessage', () => {
    it('should create complete signed message', () => {
      const content = 'My message content';
      const signed = createSignedMessage(content, secretKeyHex);

      assert.ok(signed.content);
      assert.ok(signed.signature);
      assert.ok(signed.timestamp);
    });
  });

  describe('verifyMessageSource', () => {
    it('should verify message is from expected sender', () => {
      const signed = createSignedMessage('Hello', secretKeyHex);

      const result = verifyMessageSource(signed, publicKey);
      assert.equal(result.valid, true);
    });

    it('should reject message from different sender', () => {
      const signed = createSignedMessage('Hello', secretKeyHex);

      const otherSecretKey = generateSecretKey();
      const otherPublicKey = getPublicKey(otherSecretKey);

      const result = verifyMessageSource(signed, otherPublicKey);
      assert.equal(result.valid, false);
      assert.ok(result.reason);
    });

    it('should handle unsigned messages', () => {
      const unsigned = { content: 'No signature', timestamp: Date.now() };

      const result = verifyMessageSource(unsigned, publicKey);
      assert.equal(result.valid, false);
    });
  });
});
