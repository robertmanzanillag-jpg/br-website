import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { KongDelivery, KONG_URL, prepareKongRecord } from '../kong-delivery.mjs';

const secret = 'synthetic-kong-secret-value-0123456789';
const now = Date.parse('2026-11-02T12:00:00Z');
const msg = (id = 'wa-origin-1', text = `Venue: Space Miami
Date: 2026-11-05
Table: Indoor
Minimum spend: USD 2500
Currency: USD
Conditions: 4 guests minimum`) => ({ id, text, media: null, sentAt: Math.floor((now - 60_000) / 1000) });
function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async getDelivery(id) { return rows.get(id) || null; },
    async saveDelivery(id, value) { rows.set(id, structuredClone(value)); },
    async listDeliveries() { return [...rows.values()].map(value => structuredClone(value)); },
  };
}
async function waitFor(predicate) {
  for (let i = 0; i < 50; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('delivery did not settle');
}

test('only complete explicit quotes are signed for the fixed HTTPS receiver', async () => {
  const store = memoryStore(); let request;
  const delivery = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ status: 'applied' }), { status: 200 });
  } });
  const record = await delivery.record(msg(), 'SPACE TABLES');
  await waitFor(async () => (await store.getDelivery(record.id))?.status === 'applied');
  assert.equal(request.url, KONG_URL);
  assert.equal(request.options.redirect, 'manual');
  assert.equal(request.options.method, 'POST');
  const raw = request.options.body;
  const timestamp = request.options.headers['X-Kong-BlackRoom-Timestamp'];
  assert.equal(request.options.headers['X-Kong-BlackRoom-Signature'],
    `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`);
  const payload = JSON.parse(raw);
  assert.equal(payload.sourceGroup, 'SPACE TABLES');
  assert.equal(payload.sourceMessageId, 'wa-origin-1:item:1');
  assert.equal(payload.minimumSpend, '2500');
  assert.equal(payload.evidenceExcerpt, msg().text);
  await delivery.record(msg(), 'SPACE TABLES');
  assert.equal((await store.getDelivery(record.id)).status, 'applied');
  delivery.close();
});

test('missing secret preserves pending evidence and sends nothing', async () => {
  const store = memoryStore(); let requests = 0;
  const delivery = new KongDelivery({ store, secret: '', hostReady: true, now: () => now, fetchImpl: async () => { requests++; } });
  const record = await delivery.record(msg(), 'SPACE TABLES');
  assert.equal(record.status, 'pending');
  assert.equal(record.reason, 'integration_disabled');
  assert.equal(delivery.snapshot().enabled, false);
  assert.equal(requests, 0);
  delivery.close();
});

test('a configured secret alone is insufficient until host readiness is explicitly enabled', async () => {
  const store = memoryStore(); let requests = 0;
  const delivery = new KongDelivery({ store, secret, hostReady: false, now: () => now, fetchImpl: async () => { requests++; } });
  const record = await delivery.record(msg('host-not-ready'), 'SPACE TABLES');
  assert.equal(record.status, 'pending');
  assert.equal(record.reason, 'integration_disabled');
  assert.equal(delivery.snapshot().enabled, false);
  assert.equal(requests, 0);
  delivery.close();
});

test('ambiguous or old offers remain pending without a request', async () => {
  const store = memoryStore(); let requests = 0;
  const delivery = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async () => { requests++; } });
  const unclear = await delivery.record(msg('unclear', 'VIP table $2500'), 'SPACE TABLES');
  assert.equal(unclear.status, 'pending');
  assert.equal(unclear.reason, 'explicit_fields_required');
  const old = { ...msg('old'), sentAt: Math.floor((now - 8 * 86400_000) / 1000) };
  assert.equal(prepareKongRecord(old, 'SPACE TABLES', now).reason, 'older_than_7_days');
  await delivery.record(old, 'SPACE TABLES');
  assert.equal(requests, 0);
  delivery.close();
});

test('multiple explicit quotes get stable item identities and 202 remains review-only', async () => {
  const store = memoryStore(); const payloads = [];
  const text = [msg().text, msg().text.replace('Indoor', 'Outdoor')].join('\n---\n');
  const delivery = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ status: 'pending', reason: 'do not expose raw receiver text' }), { status: 202 });
  } });
  const record = await delivery.record(msg('multi', text), 'LIV MIAMI');
  await waitFor(async () => (await store.getDelivery(record.id))?.status === 'receiver_pending');
  assert.equal(payloads.length, 2);
  assert.notEqual(payloads[0].sourceMessageId, payloads[1].sourceMessageId);
  assert.equal((await store.getDelivery(record.id)).itemStates.every(item => item.status === 'receiver_pending'), true);
  delivery.close();
});

test('redirects are rejected; source edits become conflicts; unapproved groups never send', async () => {
  const store = memoryStore(); let requests = 0;
  const delivery = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async () => {
    requests++; return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
  } });
  const record = await delivery.record(msg(), 'SPACE TABLES');
  await waitFor(async () => (await store.getDelivery(record.id))?.reason === 'redirect_rejected');
  const conflict = await delivery.record(msg('wa-origin-1', msg().text + '\nConditions: changed'), 'SPACE TABLES');
  assert.equal(conflict.reason, 'source_conflict');
  assert.equal(await delivery.record(msg('foreign'), 'NOT A GROUP').then(result => result.reason), 'forbidden_group');
  assert.equal(requests, 1);
  delivery.close();
});

test('a pending outbox survives restart and resumes with the configured secret', async () => {
  const store = memoryStore(); let requests = 0;
  const first = new KongDelivery({ store, secret: '', hostReady: true, now: () => now, fetchImpl: async () => { requests++; } });
  const record = await first.record(msg('restart'), 'STUDIO 60 PROMO');
  first.close();
  const second = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async url => {
    assert.equal(url, KONG_URL); requests++;
    return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
  } });
  await second.resume();
  await waitFor(async () => (await store.getDelivery(record.id))?.status === 'duplicate');
  assert.equal(requests, 1);
  second.close();
});
