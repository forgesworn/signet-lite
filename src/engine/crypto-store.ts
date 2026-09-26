// Lifted verbatim from forgesworn/signet-app src/lib/crypto-store.ts (audited). Do not modify the crypto.

/**
 * Encrypt/decrypt secrets for IndexedDB storage using a user passphrase.
 * Uses PBKDF2 (600,000 iterations, SHA-256) to derive an AES-256-GCM key.
 * Iteration count follows OWASP 2023 recommendation for PBKDF2-SHA-256.
 * Last reviewed: 2026-03-16.
 *
 * Wire format: base64(salt[16] || iv[12] || ciphertext)
 */

import { deriveAesKey, aesEncrypt, aesDecrypt, SALT_LENGTH, IV_LENGTH } from './aes-crypto.js';

// Note: aesEncrypt(plaintext, key) → { iv: Uint8Array, ciphertext: Uint8Array }
//       aesDecrypt(iv, ciphertext, key) → Promise<string>

export async function encryptSecret(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveAesKey(passphrase, salt);
  const { iv, ciphertext } = await aesEncrypt(plaintext, key);

  // Format: base64(salt || iv || ciphertext)
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.length);
  combined.set(salt);
  combined.set(iv, SALT_LENGTH);
  combined.set(ciphertext, SALT_LENGTH + IV_LENGTH);

  let binary = '';
  combined.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export async function decryptSecret(encrypted: string, passphrase: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  if (combined.length < SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error('Encrypted payload too short');
  }

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveAesKey(passphrase, salt);
  return aesDecrypt(iv, ciphertext, key);
}

/**
 * Check if a string looks like an encrypted value produced by encryptSecret.
 * Must be valid base64 and decode to at least salt + iv + 16 bytes (minimum AES-GCM ciphertext).
 */
export function isEncrypted(value: string): boolean {
  try {
    const decoded = atob(value);
    return decoded.length >= SALT_LENGTH + IV_LENGTH + 16;
  } catch {
    return false;
  }
}

/**
 * Encrypt with a caller-supplied AES-GCM key (no passphrase derivation).
 * Used by the biometric (WebAuthn-PRF-derived key) path; the passphrase
 * functions above remain the PIN path. Output is base64(iv[12] || ciphertext)
 * — there is no salt because the key is provided, not derived.
 */
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  const { iv, ciphertext } = await aesEncrypt(plaintext, key);
  const combined = new Uint8Array(IV_LENGTH + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, IV_LENGTH);
  let binary = '';
  combined.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

/**
 * Decrypt a value produced by encryptWithKey.
 * Expects base64(iv[12] || ciphertext); throws if the key is wrong.
 */
export async function decryptWithKey(encrypted: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  if (combined.length < IV_LENGTH + 16) {
    throw new Error('Encrypted payload too short');
  }
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  return aesDecrypt(iv, ciphertext, key);
}
