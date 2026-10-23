import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { APPROVED_GROUP_NAMES } from './group-policy.js';
import { WhatsAppGroupRuntime } from './whatsapp-group-runtime.js';
import { WhatsAppRemoteSessionStore } from './session-store.js';

const encryptionKey = Buffer.alloc(32, 4).toString('base64');

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

class FakeClient extends EventEmitter {
  calls = [];
  constructor(messages = []) {
    super();
    this.messages = messages;
    this.chats = [
      ...APPROVED_GROUP_NAMES.map((name, index) => ({
        name, isGroup: true, id: { _serialized: `allowed-${index}@g.us` }
      })),
      { name: 'Private chat', isGroup: true, id: { _serialized: 'private@g.us' } }
    ];
  }
  async getChats() {
    this.calls.push(['getChats']);
    return this.chats;
  }
  async getChatById(id) {
    this.calls.push(['getChatById', id]);
    const messages = id === 'allowed-0@g.us' ? this.messages : [];
    const calls = this.calls;
    return {
      isGroup: true,
      async fetchMessages(options) {
        calls.push(['fetchMessages', id, options]);
        return messages;
      }
    };
  }
  async sendMessage() {
    throw new Error('Outbound messages are forbidden.');
  }
}

function storeFor(storage) {
  return new WhatsAppRemoteSessionStore({
    storage,
    encryptionKey,
    readerLimitBytes: 8 * 1024 * 1024
  });
}

test('runtime only requests history for the four pinned IDs and deduplicates recovery after restart', async () => {
  const storage = new MemoryStorage();
  const fixtureMessage = {
    from: 'allowed-0@g.us',
    id: { _serialized: 'message-1' },
    timestamp: 1792750000,
    body: 'KONG flyer $30',
    type: 'chat',
    hasMedia: false,
    mediaKey: null
  };
  const firstClient = new FakeClient([fixtureMessage]);
  const firstRuntime = new WhatsAppGroupRuntime({ client: firstClient, store: storeFor(storage) });
  const first = await firstRuntime.start();
  assert.equal(first.status, 'active');
  assert.equal(first.pendingCount, 1);
  const requestedIds = firstClient.calls.filter(call => call[0] === 'getChatById').map(call => call[1]);
  assert.deepEqual(requestedIds, APPROVED_GROUP_NAMES.map((_, index) => `allowed-${index}@g.us`));
  let unrelatedBodyRead = false;
  await firstRuntime.handleMessage({
    from: 'private@g.us',
    get body() { unrelatedBodyRead = true; return 'private content'; }
  });
  assert.equal(unrelatedBodyRead, false);
  assert.equal(firstRuntime.reader.getReviewItems().length, 1);

  const restoredClient = new FakeClient([fixtureMessage]);
  const restoredRuntime = new WhatsAppGroupRuntime({ client: restoredClient, store: storeFor(storage) });
  const restored = await restoredRuntime.start();
  assert.equal(restored.pendingCount, 1);
  assert.equal(restored.groups[APPROVED_GROUP_NAMES[0]].lastProcessedAt, first.groups[APPROVED_GROUP_NAMES[0]].lastProcessedAt);
  restoredRuntime.disconnected();
  assert.equal(restoredRuntime.snapshot().status, 'disconnected');
});

test('missing or duplicated exact names block all history requests', async () => {
  const storage = new MemoryStorage();
  const client = new FakeClient();
  client.chats = client.chats.filter(chat => chat.name !== 'STUDIO 60 PROMO');
  const runtime = new WhatsAppGroupRuntime({ client, store: storeFor(storage) });
  const result = await runtime.start();
  assert.equal(result.status, 'blocked');
  assert.equal(result.stopReason, 'groups_missing_or_duplicated');
  assert.equal(client.calls.some(call => call[0] === 'getChatById'), false);
});
