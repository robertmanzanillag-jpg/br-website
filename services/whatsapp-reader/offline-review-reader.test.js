import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveApprovedGroupMetadata } from './group-policy.js';
import { OfflineWhatsAppReviewReader } from './offline-review-reader.js';
import { WhatsAppRemoteSessionStore } from './session-store.js';

const key = Buffer.alloc(32, 9).toString('base64');
const names = ['Promoters 🖤👾🖤', 'LIV MIAMI', 'SPACE TABLES', 'STUDIO 60 PROMO'];
const pinnedGroups = resolveApprovedGroupMetadata(names.map((name, index) => ({
  name,
  isGroup: true,
  id: `authorized-${index}@g.us`
})));

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

function readerFor(storage, options = {}) {
  const store = new WhatsAppRemoteSessionStore({
    storage,
    encryptionKey: key,
    readerLimitBytes: 8 * 1024 * 1024,
    ...options
  });
  return new OfflineWhatsAppReviewReader({ store, validatedGroups: pinnedGroups });
}

test('rejects an unapproved chat before inspecting body, media, or downloading attachments', async () => {
  const reader = readerFor(new MemoryStorage());
  await reader.initialize();
  let bodyRead = false;
  let mediaRead = false;
  let downloads = 0;
  const message = {
    chatId: 'private-chat@g.us',
    messageId: 'message-x',
    get body() { bodyRead = true; throw new Error('body must not be read'); },
    get type() { mediaRead = true; throw new Error('type must not be read'); },
    get mediaKey() { mediaRead = true; throw new Error('media key must not be read'); },
    downloadAttachments() { downloads++; }
  };
  assert.deepEqual(await reader.processIncoming(message), { accepted: false, reason: 'unauthorized_group' });
  assert.equal(bodyRead, false);
  assert.equal(mediaRead, false);
  assert.equal(downloads, 0);
});

test('deduplicates repeats, stores edits and attachments encrypted, and restores after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-reader-offline-'));
  const storage = new MemoryStorage();
  const sessionArchive = Buffer.from('fixture session archive');
  const sessionZip = path.join(root, 'RemoteAuth-blackroom-owner-link.zip');
  let tick = 0;
  try {
    await fs.writeFile(sessionZip, sessionArchive);
    const store = new WhatsAppRemoteSessionStore({
      storage,
      encryptionKey: key,
      dataPath: root,
      readerLimitBytes: 8 * 1024 * 1024
    });
    await store.save({ session: 'RemoteAuth-blackroom-owner-link' });
    const reader = new OfflineWhatsAppReviewReader({
      store,
      validatedGroups: pinnedGroups,
      now: () => new Date(Date.UTC(2026, 9, 23, 10, tick++))
    });
    await reader.initialize();
    reader.setConnectionStatus('active');
    const input = {
      chatId: 'authorized-0@g.us',
      messageId: 'flyer-1',
      timestamp: '2026-10-23T10:00:00.000Z',
      type: 'image',
      mediaKey: 'media-v1',
      getBody: () => 'Flyer Friday $30',
      downloadAttachments: async () => [Buffer.from('fake flyer image')]
    };
    assert.deepEqual(await reader.processIncoming(input), {
      accepted: true,
      duplicate: false,
      change: 'new',
      revision: 1,
      processedAt: '2026-10-23T10:00:00.000Z'
    });

    let downloads = 0;
    const duplicate = await reader.processIncoming({
      ...input,
      downloadAttachments: async () => {
        downloads++;
        return [Buffer.from('fake flyer image')];
      }
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(downloads, 0);

    const edited = await reader.processIncoming({
      ...input,
      mediaKey: 'media-v2',
      getBody: () => 'Flyer Friday $35',
      downloadAttachments: async () => {
        downloads++;
        return [Buffer.from('edited fake flyer image')];
      }
    });
    assert.equal(edited.change, 'edited');
    assert.equal(edited.revision, 2);
    assert.equal(downloads, 1);

    const encryptedState = storage.objects.get('private/whatsapp-link/reader-v1.enc');
    assert.ok(encryptedState);
    assert.equal(encryptedState.includes(Buffer.from('Flyer Friday $30')), false);
    const usage = store.snapshot();
    assert.equal(usage.storedBytes, usage.sessionBytes + usage.readerBytes);
    assert.ok(usage.sessionBytes > 0 && usage.readerBytes > 0);

    const restored = readerFor(storage, { dataPath: root });
    await restored.initialize();
    const items = restored.getReviewItems();
    assert.equal(items.length, 2);
    assert.equal(items[0].change, 'new');
    assert.equal(items[1].change, 'edited');
    assert.equal(items[1].body, 'Flyer Friday $35');
    assert.deepEqual(items[1].attachments[0], Buffer.from('edited fake flyer image'));
    assert.equal(restored.snapshot().groups[names[0]].lastProcessedAt, edited.processedAt);
    assert.equal(restored.snapshot().status, 'prepared');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('shared transfer exhaustion stops processing without saving or advancing the checkpoint', async () => {
  const storage = new MemoryStorage();
  const reader = readerFor(storage);
  await reader.initialize();
  reader.store.transferLimitBytes = 128;
  const before = Buffer.from(storage.objects.get('private/whatsapp-link/reader-v1.enc'));
  const result = await reader.processIncoming({
    chatId: 'authorized-1@g.us',
    messageId: 'price-1',
    getBody: () => 'Door price $25',
    downloadAttachments: async () => []
  });
  assert.deepEqual(result, { accepted: false, reason: 'budget_stopped' });
  assert.equal(reader.snapshot().status, 'blocked');
  assert.equal(reader.snapshot().stopReason, 'budget_stopped');
  assert.equal(reader.snapshot().pendingCount, 0);
  assert.equal(reader.snapshot().groups[names[1]].lastProcessedAt, null);
  assert.deepEqual(storage.objects.get('private/whatsapp-link/reader-v1.enc'), before);
});
