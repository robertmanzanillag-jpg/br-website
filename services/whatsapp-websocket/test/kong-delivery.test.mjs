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
  assert.equal(unclear.reason, 'announcement_without_price');
  const old = { ...msg('old'), sentAt: Math.floor((now - 8 * 86400_000) / 1000) };
  assert.equal(prepareKongRecord(old, 'SPACE TABLES', now).reason, 'older_than_7_days');
  await delivery.record(old, 'SPACE TABLES');
  assert.equal(requests, 0);
  delivery.close();
});

test('Spanish and English field aliases and unambiguous date and money formats parse without inferring values', () => {
  const spanish = msg('spanish', `Lugar = Space Miami
Fecha: 5 de noviembre de 2026
Tipo de mesa: VIP
Mínimo de consumo: USD 2.500
Condiciones: 4 invitados mínimo`);
  const parsed = prepareKongRecord(spanish, 'SPACE TABLES', now);
  assert.equal(parsed.status, 'queued');
  assert.equal(parsed.candidates[0].venueName, 'Space Miami');
  assert.equal(parsed.candidates[0].eventDate, '2026-11-05');
  assert.equal(parsed.candidates[0].minimumSpend, '2500');
  assert.equal(parsed.candidates[0].currency, 'USD');

  const english = msg('english', `Venue: Space Miami
Event date: November 5, 2026
Table type: VIP
Minimum per table: $2,500 USD
Terms: 4 guests minimum`);
  assert.equal(prepareKongRecord(english, 'SPACE TABLES', now).status, 'queued');
});

test('ambiguous dates, incomplete currencies, contradictions, tickets, and unidentified images stay pending', async () => {
  const store = memoryStore(); let requests = 0;
  const delivery = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async () => { requests++; } });
  const ambiguous = prepareKongRecord(msg('date', `Venue: Space
Date: 11/05/2026
Table: VIP
Minimum spend: USD 2500
Conditions: 4 guests`), 'SPACE TABLES', now);
  assert.equal(ambiguous.reason, 'ambiguous_date');

  const currencyMissing = prepareKongRecord(msg('currency', `Lugar: Space
Fecha: 2026-11-05
Mesa: VIP
Mínimo: $2500
Condiciones: 4 personas`), 'SPACE TABLES', now);
  assert.equal(currencyMissing.reason, 'incomplete_price');

  const contradiction = prepareKongRecord(msg('conflict', `Venue: Space
Venue: Jolene
Date: 2026-11-05
Table: VIP
Minimum spend: USD 2500
Conditions: 4 guests`), 'SPACE TABLES', now);
  assert.equal(contradiction.reason, 'contradictory_fields');

  const ticket = prepareKongRecord(msg('ticket', 'Entrada: USD 50'), 'SPACE TABLES', now);
  assert.equal(ticket.reason, 'ticket_not_table_price');

  const image = await delivery.record({ ...msg('image', ''), media: { state: 'available', mimeType: 'image/jpeg', data: 'not-uploaded-in-test' } }, 'SPACE TABLES');
  assert.equal(image.reason, 'image_unidentified');
  await delivery.record(msg('ambiguous-delivery', `Venue: Space
Date: 11/05/2026
Table: VIP
Minimum spend: USD 2500
Conditions: 4 guests`), 'SPACE TABLES');
  assert.deepEqual(delivery.snapshot().pendingReasons, { ambiguous_date: 1, image_unidentified: 1 });
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

test('unchanged saved pending offers are re-evaluated after parser improvements', async () => {
  const store = memoryStore(); let requests = 0;
  const text = `Lugar: Space Miami
Fecha: 5 de noviembre de 2026
Mesa: VIP
Mínimo de mesa: USD 2500
Condiciones: 4 invitados mínimo`;
  const saved = { ...msg('reparse', text), groupId: 'authorized-space-jid' };
  const prepared = prepareKongRecord(saved, 'SPACE TABLES', now);
  store.rows.set(prepared.id, {
    ...prepared, status: 'pending', reason: 'explicit_fields_required', candidates: [], itemStates: [],
  });
  const delivery = new KongDelivery({ store, secret, hostReady: true, now: () => now, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, KONG_URL);
    assert.equal(JSON.parse(options.body).minimumSpend, '2500');
    return new Response(JSON.stringify({ status: 'applied' }), { status: 200 });
  } });
  await delivery.resume([saved], { 'SPACE TABLES': 'authorized-space-jid' });
  await waitFor(async () => (await store.getDelivery(prepared.id))?.status === 'applied');
  assert.equal(requests, 1);
  delivery.close();
});
