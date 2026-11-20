import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromByteArray, toByteArray } from 'base64-js';
import type { EncryptedPlannerPayload } from '@workspace/api-client-react';

export const CRYPTO_VERSION = 1 as const;
export const KDF_NAME = 'PBKDF2-SHA256' as const;
export const PBKDF2_ITERATIONS = 310_000;
export const AES_KEY_BYTES = 32;
export const SALT_BYTES = 32;
export const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeBase64(bytes: Uint8Array): string {
  return fromByteArray(bytes);
}

export function decodeBase64(value: string): Uint8Array {
  return toByteArray(value);
}

export function parseEncryptedPayload(
  value: unknown,
): EncryptedPlannerPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<EncryptedPlannerPayload>;
  if (
    payload.cryptoVersion !== CRYPTO_VERSION ||
    payload.kdf !== KDF_NAME ||
    typeof payload.salt !== 'string' ||
    typeof payload.iv !== 'string' ||
    typeof payload.ciphertext !== 'string'
  ) {
    return null;
  }
  return payload as EncryptedPlannerPayload;
}

export function derivePlannerKey(
  passphrase: string,
  salt: Uint8Array,
): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error('The planner encryption salt is invalid.');
  }
  return pbkdf2(sha256, encoder.encode(passphrase), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: AES_KEY_BYTES,
  });
}

export function encryptPlannerData(
  data: unknown,
  key: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
): EncryptedPlannerPayload {
  if (key.length !== AES_KEY_BYTES || salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new Error('The planner encryption parameters are invalid.');
  }
  const ciphertext = gcm(key, iv).encrypt(encoder.encode(JSON.stringify(data)));
  return {
    cryptoVersion: CRYPTO_VERSION,
    kdf: KDF_NAME,
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(ciphertext),
  };
}

export function decryptPlannerPayloadWithKey(
  value: unknown,
  key: Uint8Array,
): unknown {
  const payload = parseEncryptedPayload(value);
  if (!payload || key.length !== AES_KEY_BYTES) {
    throw new Error('The encrypted planner snapshot is invalid.');
  }

  try {
    const salt = decodeBase64(payload.salt);
    const iv = decodeBase64(payload.iv);
    const ciphertext = decodeBase64(payload.ciphertext);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < 16) {
      throw new Error('The encrypted planner snapshot is invalid.');
    }
    const plaintext = gcm(key, iv).decrypt(ciphertext);
    return JSON.parse(decoder.decode(plaintext)) as unknown;
  } catch {
    throw new Error('The passphrase did not unlock this planner snapshot.');
  }
}

export function decryptPlannerPayload(
  value: unknown,
  passphrase: string,
): unknown {
  const payload = parseEncryptedPayload(value);
  if (!payload) throw new Error('The encrypted planner snapshot is invalid.');
  try {
    return decryptPlannerPayloadWithKey(
      payload,
      derivePlannerKey(passphrase, decodeBase64(payload.salt)),
    );
  } catch {
    throw new Error('The passphrase did not unlock this planner snapshot.');
  }
}
