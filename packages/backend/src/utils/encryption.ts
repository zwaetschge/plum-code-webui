import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get or derive a 32-byte encryption key from the config
 */
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const key = config.encryptionKey;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // If key is already 32 bytes hex (64 chars), use it directly
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    cachedKey = Buffer.from(key, 'hex');
    return cachedKey;
  }

  // Otherwise, derive a key using PBKDF2. The salt defaults to the historical
  // constant so existing ciphertext stays readable; ENCRYPTION_SALT lets an
  // operator make the derivation install-specific, which is what stops one
  // precomputed table from covering every deployment of this project.
  const salt = process.env.ENCRYPTION_SALT?.trim() || 'claude-code-webui-salt';
  const derived = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');
  cachedKey = derived;
  return derived;
}

/** Does this look like output of encrypt(): base64 that round-trips and is long
 *  enough to carry an IV and an auth tag? Used to tell "wrong key" apart from
 *  "legacy plaintext" when decryption fails. */
function looksLikeCiphertext(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const buf = Buffer.from(value, 'base64');
  if (buf.length <= IV_LENGTH + AUTH_TAG_LENGTH) return false;
  return buf.toString('base64') === value;
}

/**
 * Encrypt a plaintext string
 * @returns Base64-encoded ciphertext with IV and auth tag prepended
 */
function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a Base64-encoded ciphertext
 * @returns Decrypted plaintext string
 */
function decrypt(ciphertext: string): string {
  const key = getKey();
  const combined = Buffer.from(ciphertext, 'base64');

  // Extract IV, authTag, and encrypted data
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Check if encryption is available (ENCRYPTION_KEY is set)
 */
function isEncryptionAvailable(): boolean {
  return !!config.encryptionKey;
}

/**
 * Safely encrypt a value, returning null if encryption is not available
 */
export function safeEncrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  if (!isEncryptionAvailable()) {
    // Previously this warned and returned the plaintext, so a missing key wrote
    // provider tokens into the database in the clear while every caller and the
    // UI reported the credential as encrypted. Refuse instead: the compose files
    // make ENCRYPTION_KEY mandatory, so reaching this is a misconfiguration.
    throw new Error(
      'ENCRYPTION_KEY is not set — refusing to store a credential unencrypted. ' +
        'Generate one with: openssl rand -base64 48'
    );
  }
  return encrypt(plaintext);
}

/**
 * Safely decrypt a value, handling both encrypted and plaintext values
 */
export function safeDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!isEncryptionAvailable()) {
    if (looksLikeCiphertext(ciphertext)) {
      console.error(
        '[encryption] Stored value looks encrypted but ENCRYPTION_KEY is not set. ' +
          'Set the key this data was written with.'
      );
      return null;
    }
    return ciphertext;
  }

  try {
    return decrypt(ciphertext);
  } catch {
    // Decryption failed. Either this predates encryption (legacy plaintext, keep
    // working) or the key changed (wrong key). Handing ciphertext back as if it
    // were the credential is the one thing that must not happen: callers pass it
    // straight to provider APIs and into Authorization headers.
    if (looksLikeCiphertext(ciphertext)) {
      console.error(
        '[encryption] Failed to decrypt a stored credential — ENCRYPTION_KEY (or ENCRYPTION_SALT) ' +
          'does not match the one it was written with. Re-enter the credential, or restore the key.'
      );
      return null;
    }
    return ciphertext;
  }
}
