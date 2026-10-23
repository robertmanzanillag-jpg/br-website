import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DisconnectReason,
  handleCompanionRegRefresh,
  rewritePairingSocket,
} from '../baileys-runtime.mjs';
import { WebSocketReader, GROUP_NAMES } from '../reader.mjs';

test('companion refresh rotates pending secret and refreshes the current QR without advancing refs', () => {
  const creds = { advSecretKey: 'old-secret' };
  const events = [];
  const logger = { warn: (...x) => events.push(['warn', ...x]), debug() {}, info: (...x) => events.push(['info', ...x]) };
  const result = handleCompanionRegRefresh(
    { attrs: {}, content: [{ tag: 'companion_reg_refresh' }] },
    {
      creds,
      emitCredsUpdate: update => events.push(['creds', update]),
      refreshQR: () => events.push(['refresh-current-ref']),
      logger,
      getChild: (node, name) => node.content.find(child => child.tag === name),
    },
  );
  assert.equal(result, 'rotated');
  assert.notEqual(creds.advSecretKey, 'old-secret');
  assert.equal(Buffer.from(creds.advSecretKey, 'base64').length, 32);
  assert.deepEqual(events.map(([kind]) => kind), ['creds', 'info', 'refresh-current-ref']);
});

test('malformed and already-registered refreshes do not alter session credentials', () => {
  for (const creds of [{ advSecretKey: 'pending' }, { me: { id: 'linked' }, advSecretKey: 'linked-secret' }]) {
    const before = { ...creds };
    let refreshed = 0;
    const result = handleCompanionRegRefresh(
      { attrs: {}, content: [] },
      { creds, emitCredsUpdate() {}, refreshQR() { refreshed++; }, logger: { warn() {}, debug() {}, info() {} }, getChild() { return null; } },
    );
    assert.equal(result, creds.me ? 'ignored_malformed' : 'ignored_malformed');
    assert.deepEqual(creds, before);
    assert.equal(refreshed, 0);
  }
  const creds = { me: { id: 'linked' }, advSecretKey: 'linked-secret' };
  const result = handleCompanionRegRefresh(
    { attrs: {}, content: [{ tag: 'pair-device-rotate-qr' }] },
    { creds, emitCredsUpdate() { assert.fail('registered credentials must not be changed'); }, refreshQR() { assert.fail('registered QR must not be refreshed'); }, logger: { warn() {}, debug() {}, info() {} }, getChild: (node, name) => node.content.find(child => child.tag === name) },
  );
  assert.equal(result, 'ignored_registered');
  assert.equal(creds.advSecretKey, 'linked-secret');
});

test('Baileys patch re-renders from the current ref and reads the rotated secret at render time', () => {
  const fixture = `    // QR gen
    ws.on('CB:iq,type:set,pair-device', async (stanza) => {
        const advB64 = creds.advSecretKey;
    });
    // device paired for the first time`;
  const patched = rewritePairingSocket(fixture);
  assert.match(patched, /CB:notification,type:companion_reg_refresh/);
  assert.match(patched, /buildPairingQRData\(currentRef, noiseKeyB64, identityKeyB64, creds\.advSecretKey, browser\)/);
  assert.doesNotMatch(patched, /const advB64 = creds\.advSecretKey/);
  assert.equal(rewritePairingSocket(patched), patched);
});

test('accepted pairing restarts transport and only becomes active after the next connection opens', async () => {
  const pins = Object.fromEntries(GROUP_NAMES.map((name, i) => [name, `${i + 1}@g.us`]));
  const metadata = Object.fromEntries(Object.entries(pins).map(([subject, id]) => [id, { id, subject }]));
  const store = {
    async acquire() {}, async release() {}, async load(id) { return id === 'groups' ? pins : null; },
    async save() { return true; }, async saveMessage() { return true; },
  };
  const sockets = [];
  const reader = new WebSocketReader({
    store,
    reconnectDelays: [1],
    socketFactory: () => {
      const socket = {
        ev: new EventEmitter(),
        end() {},
        groupFetchAllParticipating: async () => metadata,
      };
      sockets.push(socket);
      return socket;
    },
  });
  await reader.start();
  sockets[0].ev.emit('connection.update', { isNewLogin: true });
  assert.equal(reader.snapshot().state, 'pairing_accepted');
  sockets[0].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.restartRequired } } },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sockets.length, 2);
  assert.equal(reader.snapshot().state, 'connecting');
  sockets[1].ev.emit('connection.update', { connection: 'open' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reader.snapshot().state, 'reading');
  await reader.stop('test_finished');
});
