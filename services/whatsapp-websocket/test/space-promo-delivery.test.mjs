import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { SpacePromoDelivery, SPACE_PROMO_URL } from '../space-promo-delivery.mjs';
const now = Date.parse('2026-10-27T16:00:00Z');
const secret = 'synthetic-space-promo-secret-0123456789';
const pins = { 'Promoters 🖤👾🖤': '123456789@g.us' };
const text = 'Venue: Club Space\nEvent: Fixture Event\nDate: 2026-10-30\nPromoter list: 11 PM - 1 AM\nEligibility: everyone\nOffer: Approved list only; subject to capacity';
const message = { id: 'fixture', groupId: pins['Promoters 🖤👾🖤'], sentAt: (now - 60000) / 1000, text };
function store() { const rows = new Map(); return { rows, async load(id) { return structuredClone(rows.get(id) || null); }, async save(id, value) { rows.set(id, structuredClone(value)); return true; } }; }
const make = (db, fetchImpl, options = {}) => new SpacePromoDelivery({ store: db, fetchImpl, secret, hostReady: true, now: () => now, ...options });

test('qualified source signs exact payload for fixed receiver and never redirects', async () => {
  const db = store(); let seen;
  const delivery = make(db, async (url, options) => { seen = { url, options }; return new Response(JSON.stringify({ status: 'applied' }), { status: 200 }); });
  const row = await delivery.record(message, pins);
  await delivery.deliver(row.id);
  assert.equal(seen.url, SPACE_PROMO_URL); assert.equal(seen.options.redirect, 'manual');
  const timestamp = seen.options.headers['X-Kong-BlackRoom-Timestamp'];
  assert.equal(seen.options.headers['X-Kong-BlackRoom-Signature'], `sha256=${createHmac('sha256', secret).update(`${timestamp}.${seen.options.body}`).digest('hex')}`);
  assert.equal(JSON.parse(seen.options.body).guestlistInstruction, 'Mention DOMNROB at the guestlist line to get in.');
  assert.equal((await db.load(row.id)).status, 'applied');
  delivery.close();
});
test('ambiguous offers and generic ticket links never issue a request', async () => {
  const db = store(); let calls = 0; const delivery = make(db, async () => { calls++; });
  for (const body of ['Guestlist until 1AM', 'Tickets https://link.dice.fm/synthetic-club-link', text.replace('Eligibility: everyone', '')]) {
    const row = await delivery.record({ ...message, id: body, text: body }, pins); await delivery.deliver(row.id);
  }
  assert.equal(calls, 0); delivery.close();
});
test('queued payload resumes after restart and unchanged confirmed source is not resent', async () => {
  const db = store(); const disabled = make(db, async () => assert.fail('disabled'), { hostReady: false });
  const row = await disabled.record(message, pins); disabled.close();
  let calls = 0; const enabled = make(db, async () => { calls++; return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 }); });
  await enabled.resume([message], pins); await enabled.deliver(row.id);
  await enabled.record(message, pins); await enabled.deliver(row.id);
  assert.equal(calls, 1); assert.equal((await db.load(row.id)).items[0].status, 'duplicate'); enabled.close();
});
test('receiver pending reason persists and redirects/auth errors cannot apply', async () => {
  for (const [status, reason] of [[202, 'event_not_found'], [302, 'redirect_rejected'], [401, 'invalid_signature'], [403, 'forbidden_group'], [422, 'invalid_payload']]) {
    const db = store(); const delivery = make(db, async () => new Response(JSON.stringify({ status: 'pending', reason: 'event_not_found' }), { status }));
    const row = await delivery.record(message, pins); await delivery.deliver(row.id);
    assert.equal((await db.load(row.id)).items[0].reason, reason);
    assert.equal((await db.load(row.id)).status, 'pending_review'); delivery.close();
  }
});
test('network retries are durable, bounded and reuse identical source item identity', async () => {
  const db = store(); let current = now, calls = 0; const identities = [];
  const delivery = make(db, async (_, options) => { calls++; identities.push(JSON.parse(options.body).sourceMessageId); throw new Error('offline'); }, { now: () => current });
  const row = await delivery.record(message, pins);
  for (let i = 0; i < 7; i++) { await delivery.deliver(row.id); current += 7 * 3600000; }
  assert.equal(calls, 6); assert.equal(new Set(identities).size, 1);
  assert.equal((await db.load(row.id)).items[0].reason, 'retry_limit_reached'); delivery.close();
});
test('source edits after apply remain conflict evidence without another send', async () => {
  const db = store(); let calls = 0; const delivery = make(db, async () => { calls++; return new Response(JSON.stringify({ status: 'applied' }), { status: 200 }); });
  const row = await delivery.record(message, pins); await delivery.deliver(row.id);
  await delivery.record({ ...message, text: text.replace('1 AM', '2 AM') }, pins); await delivery.deliver(row.id);
  assert.equal(calls, 1); assert.equal((await db.load(row.id)).reason, 'source_conflict'); delivery.close();
});
test('paused delivery stops network work and source outside pinned group is ignored', async () => {
  const db = store(); let calls = 0; const delivery = make(db, async () => { calls++; });
  const row = await delivery.record(message, pins); delivery.pause(); await delivery.deliver(row.id);
  assert.equal(calls, 0);
  assert.equal((await delivery.record({ ...message, groupId: '999@g.us' }, pins)).status, 'ignored'); delivery.close();
});
test('missing pins reject before inspecting a message body', async () => {
  const db = store(); const delivery = make(db, async () => assert.fail('unauthorized'));
  const message = { get text() { throw new Error('private body inspected'); } };
  assert.equal((await delivery.record(message, {})).status, 'ignored');
  assert.equal(db.rows.size, 0); delivery.close();
});
