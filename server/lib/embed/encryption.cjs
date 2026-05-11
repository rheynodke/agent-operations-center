// server/lib/embed/encryption.cjs
// AES-256-GCM encryption with per-owner key + master key from env.
//
// Threat model: if SQLite file leaks (dump from disk), attacker still needs
// the env-stored master key (AOC_DLP_MASTER_KEY) to decrypt. Per-owner key
// adds a second layer — each user's data is encrypted with their own unique
// key, which is itself encrypted with the master key before storage.
//
// Format: iv:tag:ciphertext  (all hex, colon-separated)
// IV: 12 random bytes per encrypt (GCM standard)
// Owner key: 32 random bytes (64 hex chars) generated once per owner, then
//            encrypted with master key and stored in users.dlp_encryption_key.
'use strict';

const crypto = require('crypto');
const db = require('../db.cjs');

let _masterKeyCache = null;

function _getMasterKey() {
  if (_masterKeyCache) return _masterKeyCache;
  const hex = process.env.AOC_DLP_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('AOC_DLP_MASTER_KEY missing or wrong length (expected 64 hex chars / 32 bytes)');
  }
  _masterKeyCache = Buffer.from(hex, 'hex');
  return _masterKeyCache;
}

function _resetMasterKeyCacheForTests() {
  _masterKeyCache = null;
}

function _encWithKey(keyBuf, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

function _decWithKey(keyBuf, packed) {
  const parts = packed.split(':');
  if (parts.length !== 3) throw new Error('Malformed ciphertext — expected iv:tag:ciphertext');
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Get or create the per-owner encryption key (raw hex, 64 chars).
 * On first call for an owner, generates a new random key, encrypts it with
 * the master key, and persists the sealed form to users.dlp_encryption_key.
 * On subsequent calls, reads the sealed key from the DB and decrypts with
 * the master key to return the raw hex.
 *
 * @param {number} ownerId
 * @returns {string} 64-char hex string (raw 32-byte key)
 */
function getOrCreateOwnerKey(ownerId) {
  // Ensure master key is available first (throws if env is missing)
  const master = _getMasterKey();

  const user = db.getUserById(ownerId);
  if (!user) throw new Error(`Unknown owner_id: ${ownerId}`);

  if (user.dlpEncryptionKey) {
    // Already exists — decrypt with master to return raw key
    return _decWithKey(master, user.dlpEncryptionKey);
  }

  // Generate new owner key (32 bytes), encrypt with master, persist
  const ownerKey = crypto.randomBytes(32).toString('hex');
  const sealed = _encWithKey(master, ownerKey);
  db.setUserDlpEncryptionKey(ownerId, sealed);
  return ownerKey;
}

/**
 * Encrypt plaintext using the owner's per-user key.
 * @param {number} ownerId
 * @param {string} plain
 * @returns {string} iv:tag:ciphertext (all hex)
 */
function encryptForOwner(ownerId, plain) {
  const ownerKeyHex = getOrCreateOwnerKey(ownerId);
  const ownerKey = Buffer.from(ownerKeyHex, 'hex');
  return _encWithKey(ownerKey, plain);
}

/**
 * Decrypt ciphertext using the owner's per-user key.
 * Throws if authentication tag fails (wrong owner or tampered data).
 * @param {number} ownerId
 * @param {string} packed  iv:tag:ciphertext (all hex)
 * @returns {string} plaintext
 */
function decryptForOwner(ownerId, packed) {
  const ownerKeyHex = getOrCreateOwnerKey(ownerId);
  const ownerKey = Buffer.from(ownerKeyHex, 'hex');
  return _decWithKey(ownerKey, packed);
}

module.exports = {
  getOrCreateOwnerKey,
  encryptForOwner,
  decryptForOwner,
  _resetMasterKeyCacheForTests,
};
