import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_KDF_ITERATIONS, BackupError, decryptBackup, encryptBackup, inspectBackupFile,
} from './backup-crypto.ts';

const PASSWORD = 'correct horse battery staple';
const PLAIN = JSON.stringify({ tasks: [], notes: [], memories: [{ id: 'm', text: 'PRIVATE-MEMORY-TEXT' }] });
const rejects = (promise, code) => assert.rejects(promise, (e) => e instanceof BackupError && e.code === code);
const b64flip = (b64, index = 0) => {
  const bytes = Buffer.from(b64, 'base64');
  bytes[index] ^= 0x01;
  return bytes.toString('base64');
};

test('round trip restores the exact data, and the file never contains the plaintext or password', async () => {
  const file = await encryptBackup(PLAIN, PASSWORD);
  assert.ok(!file.includes('PRIVATE-MEMORY-TEXT'));
  assert.ok(!file.includes(PASSWORD));
  assert.equal(await decryptBackup(file, PASSWORD), PLAIN);
});

test('versioned format with a fresh salt and nonce every time', async () => {
  const a = JSON.parse(await encryptBackup(PLAIN, PASSWORD));
  const b = JSON.parse(await encryptBackup(PLAIN, PASSWORD));
  assert.equal(a.format, 'buhay-os-encrypted-backup');
  assert.equal(a.version, 1);
  assert.deepEqual([a.kdf.name, a.cipher.name, a.kdf.iterations], ['PBKDF2-SHA256', 'AES-256-GCM', BACKUP_KDF_ITERATIONS]);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(Buffer.from(a.kdf.salt, 'base64').length, 16);
  assert.equal(Buffer.from(a.cipher.iv, 'base64').length, 12);
});

test('wrong, empty and near-miss passwords cannot decrypt', async () => {
  const file = await encryptBackup(PLAIN, PASSWORD);
  for (const bad of ['', 'wrong password entirely', PASSWORD + ' ', PASSWORD.toUpperCase()]) {
    await rejects(decryptBackup(file, bad), 'wrong-password-or-tampered');
  }
});

test('short passwords are refused when making a backup', async () => {
  await rejects(encryptBackup(PLAIN, 'short'), 'weak-password');
});

test('tampering with any authenticated part is rejected', async () => {
  const file = JSON.parse(await encryptBackup(PLAIN, PASSWORD));
  const lastIndex = Buffer.from(file.ciphertext, 'base64').length - 1;
  const variants = {
    ciphertext: { ...file, ciphertext: b64flip(file.ciphertext, 3) },
    tag: { ...file, ciphertext: b64flip(file.ciphertext, lastIndex) },
    iv: { ...file, cipher: { ...file.cipher, iv: b64flip(file.cipher.iv) } },
    salt: { ...file, kdf: { ...file.kdf, salt: b64flip(file.kdf.salt) } },
    iterations: { ...file, kdf: { ...file.kdf, iterations: file.kdf.iterations + 1 } },
  };
  for (const variant of Object.values(variants)) {
    await rejects(decryptBackup(JSON.stringify(variant), PASSWORD), 'wrong-password-or-tampered');
  }
});

test('malformed, unsupported and oversized files fail safely before any key work', async () => {
  const good = JSON.parse(await encryptBackup(PLAIN, PASSWORD));
  const cases = [
    ['not json', 'malformed'],
    ['[]', 'malformed'],
    ['{"hello":1}', 'malformed'],
    [JSON.stringify({ ...good, version: 2 }), 'unsupported'],
    [JSON.stringify({ ...good, kdf: { ...good.kdf, name: 'MD5' } }), 'unsupported'],
    [JSON.stringify({ ...good, kdf: { ...good.kdf, iterations: 1 } }), 'unsupported'],
    [JSON.stringify({ ...good, kdf: { ...good.kdf, iterations: 1e12 } }), 'unsupported'],
    [JSON.stringify({ ...good, kdf: { ...good.kdf, salt: 'AAAA' } }), 'malformed'],
    [JSON.stringify({ ...good, cipher: { ...good.cipher, iv: '!!!!' } }), 'malformed'],
    [JSON.stringify({ ...good, ciphertext: 'AAAA' }), 'malformed'],
    [JSON.stringify({ ...good, ciphertext: undefined }), 'malformed'],
  ];
  for (const [text, code] of cases) {
    assert.throws(() => inspectBackupFile(text), (e) => e instanceof BackupError && e.code === code);
    await rejects(decryptBackup(text, PASSWORD), code);
  }
});

test('a legacy plaintext JSON backup is refused, never silently imported', async () => {
  const legacy = JSON.stringify({ tasks: [], notes: [], settings: {} });
  assert.throws(() => inspectBackupFile(legacy), (e) => e instanceof BackupError && e.code === 'legacy-plaintext');
  await rejects(decryptBackup(legacy, PASSWORD), 'legacy-plaintext');
});

test('a journal travels inside an encrypted backup and comes back identical, with no entry text in the file', async () => {
  const { createJournalCollection, createJournalEntry } = await import('@workspace/planner-contract/journal');
  const ids = (() => { let n = 0; return () => `j-${++n}`; })();
  const now = '2026-10-26T10:00:00.000Z';
  const { data: started, collection } = createJournalCollection({ tasks: [], notes: [], settings: {} }, { startLocalDate: '2026-01-01', timeZone: 'Asia/Manila' }, now, ids);
  const { data } = createJournalEntry(started, { collectionInstanceId: collection.id, localDate: '2026-02-11', body: 'JOURNAL-SECRET-WORDS', mood: { label: 'Calm' } }, now, ids);
  const plaintext = JSON.stringify(data);
  const file = await encryptBackup(plaintext, 'correct horse battery staple');
  assert.equal(file.includes('JOURNAL-SECRET-WORDS'), false);
  assert.equal(file.includes('2026-02-11'), false);
  assert.equal(await decryptBackup(file, 'correct horse battery staple'), plaintext);
});

test('finance entries travel inside an encrypted backup and come back identical, with no amount or name in the file', async () => {
  const { addCommitment } = await import('@workspace/planner-contract/tuklas');
  const ids = (() => { let n = 0; return () => `f-${++n}`; })();
  const now = '2026-10-26T10:00:00.000Z';
  const { data } = addCommitment({ tasks: [], notes: [], settings: {} }, { name: 'FINANCE-SECRET-NAME', amountMinor: 123456, currency: 'AUD', dueDate: '2026-11-25', repeat: 'monthly', category: 'Housing' }, now, ids);
  const plaintext = JSON.stringify(data);
  const file = await encryptBackup(plaintext, 'correct horse battery staple');
  assert.equal(file.includes('FINANCE-SECRET-NAME'), false);
  assert.equal(file.includes('123456'), false);
  assert.equal(await decryptBackup(file, 'correct horse battery staple'), plaintext);
});
