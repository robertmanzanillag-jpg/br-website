import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HostedReader } from '../host.mjs';
import { KongDelivery } from '../kong-delivery.mjs';

function fakeReader() {
  const reader = new EventEmitter();
  let current = { state: 'stopped', groups: [], received: 0, saved: 0, discarded: 0 };
  reader.snapshot = () => structuredClone(current);
  reader.start = async () => {
    current = { ...current, state: 'reading', received: 3, saved: 2, discarded: 1,
      groups: [
        { name: 'Promoters 🖤👾🖤', id: 'private-1', identified: true },
        { name: 'LIV MIAMI', id: 'private-2', identified: true },
        { name: 'SPACE TABLES', id: 'private-3', identified: true },
        { name: 'STUDIO 60 PROMO', id: 'private-4', identified: true },
      ],
      lastConnectionAt: '2026-10-23T23:00:00.000Z',
      lastIncomingAt: '2026-10-23T23:01:00.000Z',
      lastSavedAt: '2026-10-23T23:02:00.000Z' };
    reader.emit('status', reader.snapshot());
  };
  reader.stop = async () => { current = { ...current, state: 'stopped' }; };
  reader.deliverySnapshot = () => ({
    enabled: true, hostReady: true, secretValid: true, status: 'ready',
    attempts: 4, applied: 2, duplicates: 1, receiverPending: 1,
    rejected: 0, networkFailures: 0, lastAttemptAt: '2026-10-23T23:03:00.000Z',
  });
  return reader;
}

test('private diagnostics log safe counts and stages without group identities or content', async () => {
  const lines = [];
  const reader = fakeReader();
  const host = new HostedReader(async () => ({ reader, shutdown: () => reader.stop() }), {
    diagnosticLogger: line => lines.push(line),
  });
  try {
    await host.start();
    reader.emit('delivery-status', reader.deliverySnapshot());
    const joined = lines.join('\n');
    const records = lines.map(line => JSON.parse(line));
    const connected = records.find(record => record.state === 'reading');
    const delivery = records.find(record => record.event === 'delivery_status');
    assert.equal(connected.authorizedGroupCount, 4);
    assert.equal(connected.groupValidation, 'validated');
    assert.equal(connected.counterScope, 'process');
    assert.deepEqual([connected.received, connected.saved, connected.discarded], [3, 2, 1]);
    assert.equal(connected.lastConnectionAt, '2026-10-23T23:00:00.000Z');
    assert.equal(delivery.kong.enabled, true);
    assert.deepEqual(
      [delivery.kong.attempts, delivery.kong.applied, delivery.kong.duplicates, delivery.kong.receiverPending],
      [4, 2, 1, 1],
    );
    assert.doesNotMatch(joined, /Promoters|LIV MIAMI|SPACE TABLES|STUDIO 60|private-[1-4]|message body|qr/i);
  } finally { await host.shutdown(); }
});

test('startup errors are logged as allowlisted reasons, never raw error text', async () => {
  const lines = [];
  const host = new HostedReader(async () => {
    throw new Error('password=do-not-log SELECT * FROM chats');
  }, { diagnosticLogger: line => lines.push(line) });
  try {
    await host.start();
    const joined = lines.join('\n');
    const record = lines.map(line => JSON.parse(line)).find(value => value.state === 'startup_failed');
    assert.equal(record.reason, 'startup_failed');
    assert.doesNotMatch(joined, /password|SELECT|chats|do-not-log/i);
  } finally { await host.shutdown(); }
});

test('recovery logs do not present a prior startup failure as the current reason', async () => {
  const lines = [];
  const reader = fakeReader();
  const host = new HostedReader(async () => ({ reader, shutdown: () => reader.stop() }), {
    diagnosticLogger: line => lines.push(line),
  });
  try {
    await host.start();
    reader.emit('status', { ...reader.snapshot(), state: 'startup_failed', startupCode: 'reader_already_running' });
    reader.emit('status', { ...reader.snapshot(), state: 'reading' });
    const latestReading = lines.map(line => JSON.parse(line)).filter(value => value.state === 'reading').at(-1);
    assert.equal(latestReading.reason, null);
  } finally { await host.shutdown(); }
});

test('delivery counters expose booleans only for readiness and credentials', () => {
  const delivery = new KongDelivery({
    store: {}, secret: 'synthetic-secret-value-that-is-long-enough-000',
    hostReady: true, fetchImpl: async () => { throw new Error('must not send'); },
  });
  try {
    const snapshot = delivery.snapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.hostReady, true);
    assert.equal(snapshot.secretValid, true);
    assert.equal(JSON.stringify(snapshot).includes('synthetic-secret'), false);
  } finally { delivery.close(); }
});
