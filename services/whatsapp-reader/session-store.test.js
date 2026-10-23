import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decryptSessionArchive,
  encryptSessionArchive,
  isPrivateWhatsAppStorageObject,
  WhatsAppRemoteSessionStore
} from './session-store.js';

const testKey = Buffer.alloc(32, 7).toString('base64');

class MemoryStorage {
  objects = new Map();
  async exists(name) {
    return { ok: true, value: this.objects.has(name) };
  }
  async downloadAsBytes(name) {
    if (!this.objects.has(name)) return { ok: false, error: { statusCode: 404 } };
    return { ok: true, value: [Buffer.from(this.objects.get(name))] };
  }
  async uploadFromBytes(name, bytes) {
    this.objects.set(name, Buffer.from(bytes));
    return { ok: true, value: null };
  }
  async delete(name) {
    this.objects.delete(name);
    return { ok: true, value: null };
  }
}

test('session archive encryption rejects tampering and wrong keys', () => {
  const clear = Buffer.from('private browser profile fixture');
  const encrypted = encryptSessionArchive(clear, testKey);
  assert.notEqual(encrypted.toString('utf8').includes(clear.toString('utf8')), true);
  assert.deepEqual(decryptSessionArchive(encrypted, testKey), clear);
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 0xff;
  assert.throws(() => decryptSessionArchive(damaged, testKey), { code: 'WA_BACKUP_CORRUPT' });
  assert.throws(() => decryptSessionArchive(encrypted, Buffer.alloc(32, 8).toString('base64')), { code: 'WA_BACKUP_CORRUPT' });
});

test('encrypted session backup restores after a new store instance starts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-store-test-'));
  const storage = new MemoryStorage();
  const profile = Buffer.from('fixture: no account credentials');
  const zipPath = path.join(root, 'RemoteAuth-blackroom-owner-link.zip');
  const restoredPath = path.join(root, 'restored.zip');
  try {
    await fs.writeFile(zipPath, profile);
    const writer = new WhatsAppRemoteSessionStore({ storage, encryptionKey: testKey, dataPath: root });
    await writer.save({ session: 'RemoteAuth-blackroom-owner-link' });
    const backup = storage.objects.get('private/whatsapp-link/session-v1.enc');
    assert.ok(backup);
    assert.equal(backup.includes(profile), false);

    const restarted = new WhatsAppRemoteSessionStore({ storage, encryptionKey: testKey, dataPath: root });
    assert.equal(await restarted.sessionExists({ session: 'RemoteAuth-blackroom-owner-link' }), true);
    await restarted.extract({ session: 'RemoteAuth-blackroom-owner-link', path: restoredPath });
    assert.deepEqual(await fs.readFile(restoredPath), profile);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('corrupt stored backup fails closed and never extracts plaintext', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-corrupt-test-'));
  const storage = new MemoryStorage();
  const source = path.join(root, 'RemoteAuth-blackroom-owner-link.zip');
  const restoredPath = path.join(root, 'restored.zip');
  try {
    await fs.writeFile(source, Buffer.from('valid archive fixture'));
    const writer = new WhatsAppRemoteSessionStore({ storage, encryptionKey: testKey, dataPath: root });
    await writer.save({ session: 'RemoteAuth-blackroom-owner-link' });
    const backup = storage.objects.get('private/whatsapp-link/session-v1.enc');
    backup[backup.length - 1] ^= 0x80;
    storage.objects.set('private/whatsapp-link/session-v1.enc', backup);

    const reader = new WhatsAppRemoteSessionStore({ storage, encryptionKey: testKey, dataPath: root });
    assert.equal(await reader.sessionExists({ session: 'RemoteAuth-blackroom-owner-link' }), true);
    await assert.rejects(
      reader.extract({ session: 'RemoteAuth-blackroom-owner-link', path: restoredPath }),
      { code: 'WA_BACKUP_CORRUPT' }
    );
    await assert.rejects(fs.access(restoredPath));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('transfer cap stops before the next backup and private objects are not public image paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-budget-test-'));
  const storage = new MemoryStorage();
  const source = path.join(root, 'RemoteAuth-blackroom-owner-link.zip');
  let limitCalled = false;
  try {
    await fs.writeFile(source, Buffer.alloc(4096, 5));
    const store = new WhatsAppRemoteSessionStore({
      storage,
      encryptionKey: testKey,
      dataPath: root,
      transferLimitBytes: 4096,
      onLimit: () => { limitCalled = true; }
    });
    await assert.rejects(
      store.save({ session: 'RemoteAuth-blackroom-owner-link' }),
      { code: 'WA_BUDGET_LIMIT' }
    );
    assert.equal(limitCalled, true);
    assert.equal(storage.objects.has('private/whatsapp-link/session-v1.enc'), false);
    assert.equal(isPrivateWhatsAppStorageObject('private/whatsapp-link/session-v1.enc'), true);
    assert.equal(isPrivateWhatsAppStorageObject('product-images/flyer.jpg'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('remote session metadata requests fail closed at the configured storage deadline', async () => {
  const storage = {
    exists: () => new Promise(() => {})
  };
  const store = new WhatsAppRemoteSessionStore({
    storage,
    encryptionKey: testKey,
    requestTimeoutMs: 10
  });
  await assert.rejects(
    store.sessionExists({ session: 'RemoteAuth-blackroom-owner-link' }),
    { code: 'WA_STORAGE_TIMEOUT' }
  );
});
