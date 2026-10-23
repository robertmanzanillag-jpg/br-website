import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { WebSocketReader, GROUP_NAMES, resolveGroups, encryptedAuth } from '../reader.mjs';
import { proto } from '../baileys-runtime.mjs';
import { codec, PostgresStore, safeDatabaseDiagnostic } from '../store.mjs';
import { PGlite } from '@electric-sql/pglite';

const key = randomBytes(32).toString('base64');
const metadata = Object.fromEntries(GROUP_NAMES.map((subject, i) => [`${100 + i}@g.us`, { id: `${100 + i}@g.us`, subject }]));
const tick = () => new Promise(resolve => setImmediate(resolve));
function memory() {
  const crypt = codec(key), data = new Map(), inbox = [];
  const seen = new Set();
  return { data, inbox, locked: false,
    async acquire() { if (this.locked) throw Error('locked'); this.locked = true; },
    async release() { this.locked = false; },
    async load(id) { return data.has(id) ? crypt.open(data.get(id), id) : null; },
    async save(id, value) { data.set(id, crypt.seal(value, id)); return true; },
    async saveMessage(value) { const key = `${value.groupId}:${value.id}:${value.text}:${JSON.stringify(value.media)}`; if (seen.has(key)) return false; seen.add(key); inbox.push(value); return true; },
    async listMessages(groupIds, limit) { return inbox.filter(item => groupIds.includes(item.groupId)).slice(0, limit); },
  };
}
async function fixture(options = {}) {
  const store = options.store || memory(); let config; const sockets = [];
  const outbound = { messages: 0, receipts: 0, reactions: 0 };
  if (!options.store) await store.save('groups', resolveGroups(metadata));
  const reader = new WebSocketReader({ store, reconnectDelays: [1], ...options,
    socketFactory: value => {
      config = value;
      const socket = { ev: new EventEmitter(), ended: false,
        groupFetchAllParticipating: options.groupFetchAllParticipating || (async () => metadata),
        end() { this.ended = true; },
        sendMessage() { outbound.messages++; throw Error('outbound forbidden'); },
        readMessages() { outbound.receipts++; throw Error('read receipt forbidden'); },
        sendReaction() { outbound.reactions++; throw Error('reaction forbidden'); },
        sendPresenceUpdate() { throw Error('presence forbidden'); },
      };
      sockets.push(socket); return socket;
    },
  });
  await reader.start();
  return { reader, store, sockets, config, outbound, async open() { sockets.at(-1).ev.emit('connection.update', { connection: 'open' }); await tick(); } };
}
const msg = (jid = '100@g.us', text = 'VIP $200') => ({ key: { remoteJid: jid, id: 'm1', fromMe: false }, messageTimestamp: 100, message: { conversation: text } });

test('exact four unique names resolve and identity changes fail closed', () => {
  const pins = resolveGroups(metadata);
  assert.equal(Object.keys(pins).length, 4);
  assert.throws(() => resolveGroups({ ...metadata, extra: { id: '999@g.us', subject: GROUP_NAMES[0] } }));
  assert.throws(() => resolveGroups({}, pins));
  assert.throws(() => resolveGroups(metadata, { ...pins, [GROUP_NAMES[0]]: '999@g.us' }));
});
test('AES GCM preserves binary auth; rejects tampering, wrong key and record substitution', () => {
  const c = codec(key), data = c.seal({ secret: Buffer.from('private') }, 'auth');
  assert.deepEqual(c.open(data, 'auth').secret, Buffer.from('private'));
  assert.equal(data.includes(Buffer.from('private')), false);
  assert.throws(() => c.open(data, 'inbox'));
  assert.throws(() => codec(randomBytes(32).toString('base64')).open(data, 'auth'));
  data[15] ^= 1; assert.throws(() => c.open(data, 'auth'));
});
test('credentials and Signal keys survive restart without plaintext storage', async () => {
  const store = memory(); const first = await encryptedAuth(store);
  first.state.creds.registered = true; await first.save();
  await first.state.keys.set({ session: { test: Buffer.from('secret-session') } });
  const next = await encryptedAuth(store);
  assert.equal(next.state.creds.registered, true);
  assert.deepEqual((await next.state.keys.get('session', ['test'])).test, Buffer.from('secret-session'));
  assert.equal(store.data.get('auth').includes(Buffer.from('secret-session')), false);
  await next.state.keys.set({ session: { test: null } });
  assert.equal((await next.state.keys.get('session', ['test'])).test, null);
});
test('corrupt auth does not create a replacement identity', async () => {
  const store = memory(); store.data.set('auth', Buffer.from('broken'));
  await assert.rejects(encryptedAuth(store), /encrypted_state_unreadable/);
});
test('only approved groups are consumed; unrelated body is never inspected', async () => {
  const f = await fixture(); await f.open();
  assert.equal(f.reader.snapshot().state, 'reading');
  const unrelated = { key: { remoteJid: '999@g.us', id: 'private' }, get message() { throw Error('read unrelated body'); } };
  f.sockets[0].ev.emit('messages.upsert', { messages: [unrelated, msg(), { ...msg(), key: { ...msg().key, fromMe: true } }] });
  await f.reader.queue;
  assert.equal(f.store.inbox.length, 1);
  assert.equal(f.config.markOnlineOnConnect, false);
  assert.equal(f.config.syncFullHistory, false);
  assert.equal(f.config.shouldSyncHistoryMessage({ syncType: proto.HistorySync.HistorySyncType.RECENT }), true);
  assert.equal(f.config.shouldSyncHistoryMessage({ syncType: proto.HistorySync.HistorySyncType.FULL }), false);
  assert.equal(f.config.shouldIgnoreJid('999@g.us'), true);
  assert.equal(f.config.shouldIgnoreJid('123@s.whatsapp.net'), true);
  await f.reader.stop();
});
test('recent history filters unauthorized JIDs before body access and deduplicates against live delivery', async () => {
  const f = await fixture(); await f.open();
  const approved = msg('100@g.us', 'Tables Friday $250');
  const unrelated = { key: { remoteJid: '999@g.us', id: 'private' }, get message() { throw Error('read unauthorized history body'); } };
  f.sockets[0].ev.emit('messaging-history.set', { syncType: proto.HistorySync.HistorySyncType.RECENT, messages: [unrelated, approved] });
  f.sockets[0].ev.emit('messages.upsert', { messages: [approved] });
  await f.reader.queue;
  assert.equal(f.store.inbox.length, 1);
  assert.equal(f.store.inbox[0].origin, 'history');
  assert.equal(f.reader.snapshot().historySaved, 1);
  const inbox = await f.reader.listInbox();
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].group, GROUP_NAMES[0]);
  assert.equal(inbox.items[0].sourceId, 'm1');
  await f.reader.stop();
});
test('diagnostics count only authorized arrivals, saves and discards; outbound methods remain unused', async () => {
  const f = await fixture(); await f.open();
  const authorized = msg('100@g.us', 'VIP $200');
  const viewOnce = { ...msg('100@g.us', 'private'), key: { ...msg().key, id: 'm2' },
    message: { viewOnceMessage: { message: { conversation: 'private' } } } };
  const unrelated = { key: { remoteJid: '999@g.us', id: 'other' }, get message() { throw Error('unapproved body read'); } };
  f.sockets[0].ev.emit('messages.upsert', { messages: [authorized, { ...authorized }, viewOnce, unrelated] });
  await f.reader.queue;
  const state = f.reader.snapshot();
  assert.equal(state.received, 3);
  assert.equal(state.saved, 1);
  assert.equal(state.discarded, 2);
  assert.ok(state.lastConnectionAt && state.lastIncomingAt && state.lastSavedAt);
  assert.deepEqual(f.outbound, { messages: 0, receipts: 0, reactions: 0 });
  f.reader.recordStorageFailure({ code: '08006', operation: 'save' });
  assert.deepEqual(f.reader.snapshot().storageFailure, { code: '08006', operation: 'save' });
  assert.equal(JSON.stringify(f.reader.snapshot()).includes('SQL'), false);
  await f.reader.stop();
});
test('storage diagnostics expose only allowlisted code and operation', () => {
  assert.deepEqual(safeDatabaseDiagnostic({ code: '08006', message: 'password=private SELECT *' }, 'save'), { code: '08006', operation: 'save' });
  assert.deepEqual(safeDatabaseDiagnostic({ code: 'PRIVATE_ERROR', message: 'sensitive SQL' }, 'raw query'), { code: 'unclassified', operation: 'query' });
});
test('authorized live and history messages wait in memory until reconnect group validation finishes', async () => {
  let completeGroups;
  const f = await fixture({ groupFetchAllParticipating: () => new Promise(resolve => { completeGroups = resolve; }) });
  const opening = f.open();
  const approved = msg('100@g.us', 'VIP $275');
  const unrelated = { key: { remoteJid: '999@g.us', id: 'private' }, get message() { throw Error('unrelated body inspected'); } };
  f.sockets[0].ev.emit('messages.upsert', { messages: [approved, unrelated] });
  assert.equal(f.store.inbox.length, 0);
  completeGroups(metadata);
  await opening;
  await f.reader.queue;
  assert.equal(f.store.inbox.length, 1);
  assert.equal(f.store.inbox[0].origin, 'reconnect');
  await f.reader.stop();
});
test('QR stays out of status and is erased on stop', async () => {
  const f = await fixture(); f.sockets[0].ev.emit('connection.update', { qr: 'sensitive-test-qr' });
  assert.equal(f.reader.pairingQr(), 'sensitive-test-qr');
  assert.equal(JSON.stringify(f.reader.snapshot()).includes('sensitive-test-qr'), false);
  await f.reader.stop(); assert.equal(f.reader.pairingQr(), null);
});
test('approved image downloads only once and respects declared size', async () => {
  let downloads = 0;
  const f = await fixture({ download: async () => { downloads++; return Readable.from([Buffer.from('image')]); } }); await f.open();
  const image = { ...msg(), message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 5, caption: 'Flyer' } } };
  f.sockets[0].ev.emit('messages.upsert', { messages: [{ ...image, key: { remoteJid: '999@g.us', id: 'other' } }, image] });
  await f.reader.queue; assert.equal(downloads, 1); assert.equal(f.store.inbox[0].media.state, 'available');
  image.message.imageMessage.fileLength = 9 * 1024 * 1024;
  f.sockets[0].ev.emit('messages.upsert', { messages: [image] }); await f.reader.queue;
  assert.equal(downloads, 1); assert.equal(f.store.inbox[1].media.state, 'size_rejected');
  await f.reader.stop();
});
test('rename halts ingestion and releases session lease', async () => {
  const f = await fixture(); await f.open();
  f.sockets[0].ev.emit('groups.update', [{ id: '100@g.us', subject: 'different' }]); await tick();
  assert.equal(f.reader.snapshot().state, 'group_identity_unverified'); assert.equal(f.store.locked, false);
});
test('edits are received and nested view-once content is excluded', async () => {
  const f = await fixture(); await f.open();
  f.sockets[0].ev.emit('messages.update', [{ key: msg().key, update: { message: { editedMessage: { message: { conversation: 'VIP $300' } } } } }]);
  f.sockets[0].ev.emit('messages.upsert', { messages: [{ ...msg(), message: { ephemeralMessage: { message: { viewOnceMessage: { message: { conversation: 'private' } } } } } }] });
  await f.reader.queue;
  assert.equal(f.store.inbox.length, 1); assert.equal(f.store.inbox[0].text, 'VIP $300');
  await f.reader.stop();
});
test('transient close reconnects; stale callbacks cannot ingest; logout stops retry', async () => {
  const f = await fixture(); await f.open();
  const old = f.sockets[0]; old.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(f.sockets.length, 2);
  await f.open(); old.ev.emit('messages.upsert', { messages: [msg()] }); await f.reader.queue;
  assert.equal(f.store.inbox.length, 0);
  f.sockets[1].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); await tick();
  assert.equal(f.reader.snapshot().state, 'relink_required');
});
test('database transactions deduplicate, retain revisions and roll back quota overflow', async () => {
  const pg = new PGlite();
  const db = { query: async (sql, params) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    if (sql.includes('CREATE TABLE')) { await pg.exec(sql); return { rows: [] }; }
    return pg.query(sql, params);
  } };
  const store = new PostgresStore(db, key, { maxStoredBytes: 4096, maxMonthlyBytes: 8192 });
  await store.acquire();
  const message = { groupId: '100@g.us', id: 'm1', text: 'VIP $200', media: null };
  assert.equal(await store.saveMessage(message), true);
  assert.equal(await store.saveMessage({ ...message, sentAt: null }), false);
  assert.equal(await store.saveMessage({ ...message, text: 'VIP $300' }), true);
  await store.save('inbox:' + 'a'.repeat(64), { ...message, id: 'legacy', revision: 'old', state: 'pending_review' });
  assert.equal((await pg.query('SELECT count(*) AS count FROM br_wa_ws_state')).rows[0].count, 3);
  const listed = await store.listMessages(['100@g.us']);
  assert.equal(listed.length, 3);
  assert.equal((await store.listMessages(['999@g.us'])).length, 0);
  await assert.rejects(store.save('oversized', 'x'.repeat(4096)), /storage_limit/);
  assert.equal(await store.load('oversized'), null);
  const raw = (await pg.query('SELECT payload FROM br_wa_ws_state LIMIT 1')).rows[0].payload;
  assert.equal(Buffer.from(raw).includes(Buffer.from('VIP')), false);
  await store.release(); await pg.close();
});
