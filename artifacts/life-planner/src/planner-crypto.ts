import type { EncryptedPlannerPayload } from '@workspace/api-client-react';
import { normalizeReleaseTwoData, type ReleaseTwoPlannerData } from '@workspace/planner-contract/release2';

function bytesToBase64(bytes: Uint8Array) { return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')); }
function base64ToBytes(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
export function randomBase64(length: number) { return bytesToBase64(crypto.getRandomValues(new Uint8Array(length))); }
export async function deriveKey(passphrase: string, salt: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: base64ToBytes(salt), iterations: 310000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptSnapshot(data: ReleaseTwoPlannerData, key: CryptoKey, salt: string): Promise<EncryptedPlannerPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { cryptoVersion: 1, kdf: 'PBKDF2-SHA256', salt, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}
export async function decryptSnapshot(payload: EncryptedPlannerPayload, key: CryptoKey): Promise<ReleaseTwoPlannerData> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.ciphertext));
  return normalizeReleaseTwoData(JSON.parse(new TextDecoder().decode(plain)));
}
