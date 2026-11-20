/**
 * Password-protected Buhay.OS backups (format version 1).
 *
 * - Key: PBKDF2-HMAC-SHA256 (Web Crypto; no new dependency) from the backup password and a fresh 16-byte salt.
 * - Cipher: AES-256-GCM with a fresh 12-byte nonce. The whole file header is authenticated as additional data,
 *   so changing the salt, iteration count, nonce or format fields makes decryption fail.
 * - The password and the derived key are never written anywhere; they live only inside these calls.
 * - A wrong password and a tampered file are indistinguishable by design (AES-GCM authentication fails).
 */

export const BACKUP_FORMAT = 'buhay-os-encrypted-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_KDF = 'PBKDF2-SHA256';
export const BACKUP_CIPHER = 'AES-256-GCM';
export const BACKUP_KDF_ITERATIONS = 600_000;
export const MIN_ACCEPTED_ITERATIONS = 310_000;
export const MAX_ACCEPTED_ITERATIONS = 2_000_000;
export const MIN_BACKUP_PASSWORD_LENGTH = 12;
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type BackupErrorCode =
  | 'legacy-plaintext'
  | 'malformed'
  | 'unsupported'
  | 'too-large'
  | 'weak-password'
  | 'wrong-password-or-tampered';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export const BACKUP_ERROR_MESSAGES: Record<BackupErrorCode, string> = {
  'legacy-plaintext':
    'This is an older, unencrypted backup. It was not imported and nothing was changed. This version only restores password-protected backups.',
  malformed: 'That file is not a valid Buhay.OS backup. Nothing was changed.',
  unsupported: 'That backup was made by a newer or unsupported version. Nothing was changed.',
  'too-large': 'That file is too large to be a Buhay.OS backup. Nothing was changed.',
  'weak-password': `Use a backup password of at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`,
  'wrong-password-or-tampered':
    'The password is wrong, or the file has been changed or damaged. Nothing was changed.',
};

const fail = (code: BackupErrorCode): never => {
  throw new BackupError(code, BACKUP_ERROR_MESSAGES[code]);
};

type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  kdf: { name: typeof BACKUP_KDF; iterations: number; salt: string };
  cipher: { name: typeof BACKUP_CIPHER; iv: string };
  ciphertext: string;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return fail('malformed');
  }
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return fail('malformed');
  }
}

/** Everything in the header is bound into the AES-GCM tag. */
function additionalData(version: number, iterations: number, salt: string, iv: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${BACKUP_FORMAT}|${version}|${BACKUP_KDF}|${iterations}|${salt}|${BACKUP_CIPHER}|${iv}`);
}

async function deriveBackupKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function checkBackupPassword(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_BACKUP_PASSWORD_LENGTH) fail('weak-password');
}

/** Encrypt serialized planner data into the text of a backup file. */
export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  checkBackupPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const saltB64 = toBase64(salt);
  const ivB64 = toBase64(nonce);
  const key = await deriveBackupKey(password, salt, BACKUP_KDF_ITERATIONS);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(BACKUP_VERSION, BACKUP_KDF_ITERATIONS, saltB64, ivB64), tagLength: TAG_BYTES * 8 },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: { name: BACKUP_KDF, iterations: BACKUP_KDF_ITERATIONS, salt: saltB64 },
    cipher: { name: BACKUP_CIPHER, iv: ivB64 },
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
  return JSON.stringify(envelope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check the file's shape without a password. Throws BackupError for legacy plaintext backups,
 * unsupported versions and anything malformed. Cheap enough to run before asking for a password.
 */
export function inspectBackupFile(fileText: string): BackupEnvelope {
  if (typeof fileText !== 'string' || fileText.length > MAX_BACKUP_FILE_BYTES) return fail('too-large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return fail('malformed');
  }
  if (!isRecord(parsed)) return fail('malformed');
  if (parsed.format !== BACKUP_FORMAT) {
    // The old export was the planner's own JSON, recognisable by its core lists.
    return fail(Array.isArray(parsed.tasks) && Array.isArray(parsed.notes) ? 'legacy-plaintext' : 'malformed');
  }
  if (parsed.version !== BACKUP_VERSION) return fail('unsupported');
  const { kdf, cipher } = parsed;
  if (!isRecord(kdf) || !isRecord(cipher) || kdf.name !== BACKUP_KDF || cipher.name !== BACKUP_CIPHER) return fail('unsupported');
  const iterations = kdf.iterations;
  if (!Number.isInteger(iterations) || (iterations as number) < MIN_ACCEPTED_ITERATIONS || (iterations as number) > MAX_ACCEPTED_ITERATIONS) {
    return fail('unsupported');
  }
  if (fromBase64(kdf.salt).length !== SALT_BYTES || fromBase64(cipher.iv).length !== NONCE_BYTES) return fail('malformed');
  if (fromBase64(parsed.ciphertext).length < TAG_BYTES) return fail('malformed');
  return parsed as unknown as BackupEnvelope;
}

/** Decrypt a backup file's text. Wrong password and tampering both throw `wrong-password-or-tampered`. */
export async function decryptBackup(fileText: string, password: string): Promise<string> {
  const envelope = inspectBackupFile(fileText);
  if (typeof password !== 'string' || password.length === 0) return fail('wrong-password-or-tampered');
  const salt = fromBase64(envelope.kdf.salt);
  const nonce = fromBase64(envelope.cipher.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  const key = await deriveBackupKey(password, salt, envelope.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: additionalData(envelope.version, envelope.kdf.iterations, envelope.kdf.salt, envelope.cipher.iv),
        tagLength: TAG_BYTES * 8,
      },
      key,
      ciphertext,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    return fail('wrong-password-or-tampered');
  }
}
