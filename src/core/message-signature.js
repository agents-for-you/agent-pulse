/**
 * @fileoverview Message signing and verification module
 * Ensures authenticity of message sources
 */

import crypto from 'crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { logger } from '../utils/logger.js';

const log = logger.child('signature');

/**
 * Convert hex string to Uint8Array (with validation)
 * @param {string} hex - Hex string
 * @returns {Uint8Array} Byte array
 * @throws {Error} If input format is invalid
 */
function hexToBytes(hex) {
  // If already Uint8Array, return directly
  if (hex instanceof Uint8Array) return hex

  // Validate input type
  if (typeof hex !== 'string') {
    throw new Error('Hex input must be a string')
  }

  // Validate length (must be even)
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length')
  }

  // Validate characters (only hex characters allowed)
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Hex string contains invalid characters')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Sign message
 * @param {string|Object} content - Message content
 * @param {string|Uint8Array} secretKey - Private key (hex or Uint8Array)
 * @returns {Object} Signed message
 */
export function signMessage(content, secretKey) {
  const message = {
    content,
    timestamp: Date.now()
  };

  // Create canonicalized message string (without signature field)
  const canonical = canonicalize(message);
  const msgHash = sha256(new TextEncoder().encode(canonical));

  // Convert private key format
  const skBytes = hexToBytes(secretKey);

  const sig = schnorr.sign(msgHash, skBytes);

  return {
    ...message,
    signature: Buffer.from(sig).toString('hex')
  };
}

/**
 * Verify message signature
 * @param {Object} message - Signed message
 * @param {string} publicKey - Sender public key (hex)
 * @returns {boolean} Whether signature is valid
 */
export function verifyMessageSignature(message, publicKey) {
  try {
    if (!message || !message.signature) {
      log.debug('Message has no signature');
      return false;
    }

    const { signature, ...msgWithoutSig } = message;
    const canonical = canonicalize(msgWithoutSig);
    const msgHash = sha256(new TextEncoder().encode(canonical));

    const sigBytes = hexToBytes(signature);
    const pubKeyBytes = hexToBytes(publicKey);

    const isValid = schnorr.verify(sigBytes, msgHash, pubKeyBytes);

    if (!isValid) {
      log.warn('Invalid message signature', { from: publicKey.slice(0, 16) });
    }

    return isValid;
  } catch (err) {
    log.error('Signature verification error', { error: err.message });
    return false;
  }
}

/**
 * Canonicalize object to deterministic string
 * @param {Object} obj - Object
 * @returns {string} Canonicalized JSON string
 */
function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Create signed message
 * @param {string|Object} content - Message content
 * @param {string|Uint8Array} secretKey - Private key
 * @returns {Object} Complete signed message
 */
export function createSignedMessage(content, secretKey) {
  return signMessage(content, secretKey);
}

/**
 * Verify message source
 * @param {Object} message - Message object
 * @param {string} expectedPublicKey - Expected sender public key
 * @returns {{valid: boolean, reason?: string}} Verification result
 */
export function verifyMessageSource(message, expectedPublicKey) {
  if (!message || !message.signature) {
    return { valid: false, reason: 'Message has no signature' };
  }

  const isValid = verifyMessageSignature(message, expectedPublicKey);

  return {
    valid: isValid,
    reason: isValid ? undefined : 'Signature verification failed'
  };
}
