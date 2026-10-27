import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HostedReader } from '../host.mjs';
import { WebSocketReader, GROUP_NAMES, resolveGroups } from '../reader.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const metadata = Object.fromEntries(GROUP_NAMES.map((subject, i) => [`${100 + i}@g.us`, { id: `${100 + i}@g.us`, subject }]));
const pins = resolveGroups(metadata);

function fixture({ delivery } = {}) {
  const saved = [], sockets = [];
  const store = {
    async acquire() {}, async release() {}, async save() {},
    async load(id) { return id === 'groups' ? pins : { creds: { registered: true, me: { id: 'synthetic' } }, keys: {} }; },
    async listMessages() { return saved; },
    async saveMessage(message) { saved.push(message); return true; },
  };
  const reader = new WebSocketReader({ store, delivery, reconnectDelays: [2], socketFactory: () => {
    const socket = { ev: new EventEmitter(), end() {}, async groupFetchAllParticipating() { return metadata; }, sendMessage() { assert.fail('must remain read-only'); }, readMessages() { assert.fail('must not send read receipts'); } };
    sockets.push(socket); return socket;
  } });
  return { reader, saved, sockets, store };
}

test('long transport failures recover repeatedly with capped host backoff and no overlapping resource', async () => {
  for (const failure of ['connect_timeout', 'connection_failed', 'reconnect_exhausted']) {
    let factories = 0, resources = 0, shutdowns = 0;
    const host = new HostedReader(async () => {
      factories++; resources++; assert.equal(resources, 1);
      const reader = new EventEmitter();
      let state = 'stopped';
      reader.snapshot = () => ({ state });
      reader.start = async () => { state = factories <= 3 ? failure : 'reading'; reader.emit('status', reader.snapshot()); };
      reader.stop = async () => {};
      return { reader, async shutdown() { resources--; shutdowns++; } };
    }, { retryDelays: [2], diagnosticLogger() {} });
    try {
      await host.start();
      assert.ok(host.snapshot().retryAt);
      for (let i = 0; i < 80 && host.snapshot().state !== 'reading'; i++) await delay(2);
      assert.equal(host.snapshot().state, 'reading', failure);
      assert.equal(factories, 4); assert.equal(shutdowns, 3); assert.equal(resources, 1);
    } finally { await host.shutdown(); }
    assert.equal(resources, 0);
  }
});

test('security failures never enter automatic transport recovery', async () => {
  for (const state of ['relink_required', 'group_identity_unverified', 'qr_expired', 'processing_failed']) {
    let factories = 0;
    const host = new HostedReader(async () => {
      factories++;
      const reader = new EventEmitter();
      reader.snapshot = () => ({ state });
      reader.start = async () => reader.emit('status', { state }); reader.stop = async () => {};
      return { reader, async shutdown() {} };
    }, { retryDelays: [2], diagnosticLogger() {} });
    try { await host.start(); await delay(10); assert.equal(factories, 1); assert.ok(!host.snapshot().retryAt); }
    finally { await host.shutdown(); }
  }
});

test('owner stop cancels a scheduled transport restart', async () => {
  let factories = 0;
  const host = new HostedReader(async () => {
    factories++;
    const reader = new EventEmitter();
    reader.snapshot = () => ({ state: 'connect_timeout' });
    reader.start = async () => reader.emit('status', reader.snapshot()); reader.stop = async () => {};
    return { reader, async shutdown() {} };
  }, { retryDelays: [10], diagnosticLogger() {} });
  try { await host.start(); assert.ok(host.snapshot().retryAt); await host.stop(); await delay(25); assert.equal(factories, 1); assert.equal(host.snapshot().state, 'stopped'); }
  finally { await host.shutdown(); }
});

test('authorized arrivals queued before a disconnect survive and wait for group revalidation', async () => {
  const f = fixture(); await f.reader.start();
  f.sockets[0].ev.emit('connection.update', { connection: 'open' }); await tick();
  let unblock;
  f.reader.queue = new Promise(resolve => { unblock = resolve; });
  const message = { key: { id: 'queued-before-close', remoteJid: '100@g.us' }, messageTimestamp: 123, message: { conversation: 'Source quote' } };
  f.sockets[0].ev.emit('messages.upsert', { messages: [message] });
  f.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  unblock(); await f.reader.queue;
  assert.equal(f.saved.length, 0); assert.equal(f.reader.validationQueue.length, 1);
  for (let i = 0; i < 30 && f.sockets.length < 2; i++) await delay(2);
  f.sockets[1].ev.emit('connection.update', { connection: 'open' }); await tick(); await f.reader.queue;
  assert.equal(f.saved.length, 1); assert.equal(f.saved[0].id, message.key.id);
  assert.equal(f.reader.snapshot().state, 'reading');
  await f.reader.stop();
});

test('a stale open callback cannot mark a disconnected socket healthy after backlog delivery', async () => {
  let unblock;
  const delivery = { on() {}, pause() {}, async resume() { await new Promise(resolve => { unblock = resolve; }); } };
  const f = fixture({ delivery }); await f.reader.start();
  f.sockets[0].ev.emit('connection.update', { connection: 'open' }); await tick();
  assert.equal(typeof unblock, 'function');
  f.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  unblock(); await tick();
  assert.notEqual(f.reader.snapshot().state, 'reading'); assert.equal(f.reader.ready, false);
  await f.reader.stop();
});

test('finishing a pending save does not hide a transport disconnect', async () => {
  const f = fixture(); await f.reader.start();
  f.sockets[0].ev.emit('connection.update', { connection: 'open' }); await tick();
  let unblock;
  f.store.saveMessage = async () => { await new Promise(resolve => { unblock = resolve; }); return true; };
  f.sockets[0].ev.emit('messages.upsert', { messages: [{ key: { id: 'slow-save', remoteJid: '100@g.us' }, messageTimestamp: 123, message: { conversation: 'quote' } }] });
  await tick(); assert.equal(typeof unblock, 'function');
  f.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  unblock(); await f.reader.queue;
  assert.notEqual(f.reader.snapshot().state, 'reading');
  await f.reader.stop();
});
