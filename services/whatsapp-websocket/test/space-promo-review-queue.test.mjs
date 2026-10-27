import test from 'node:test';
import assert from 'node:assert/strict';
import { SpacePromoReviewQueue, SPACE_PROMO_GROUP } from '../space-promo-review-queue.mjs';

const now = Date.parse('2026-10-27T16:00:00Z');
const pins = { [SPACE_PROMO_GROUP]: '123456789@g.us' };
const message = { id: 'fixture', groupId: pins[SPACE_PROMO_GROUP], sentAt: (now - 1000) / 1000, text: 'Guestlist free before midnight; approval required' };
function store() {
  const rows = new Map();
  return { rows, async load(id) { return structuredClone(rows.get(id) || null); }, async save(id, value) { rows.set(id, structuredClone(value)); return true; } };
}
test('review candidates survive restart and duplicate replay without entering price outbox', async () => {
  const db = store();
  const a = new SpacePromoReviewQueue({ store: db, now: () => now });
  const first = await a.record(message, pins);
  assert.equal(first.retained, true);
  assert.ok([...db.rows.keys()].every(id => id.startsWith('space-promo:') && !id.startsWith('kong:')));
  const b = new SpacePromoReviewQueue({ store: db, now: () => now });
  await b.resume([message, message], pins);
  const view = await b.overview(pins);
  assert.equal(view.count, 1);
  assert.equal(view.items[0].status, 'pending_review');
  assert.equal(view.items[0].dealCandidates[0].evidenceExcerpt, message.text);
});
test('source edits remain review-only and unauthorized group cannot write', async () => {
  const db = store(); const queue = new SpacePromoReviewQueue({ store: db, now: () => now });
  await queue.record(message, pins);
  await queue.record({ ...message, text: 'Guestlist free before 11pm; approval required' }, pins);
  const before = db.rows.size;
  await queue.record({ ...message, groupId: '999@g.us' }, pins);
  assert.equal(db.rows.size, before);
  const view = await queue.overview(pins);
  assert.equal(view.items[0].revisionReason, 'source_edited_requires_review');
  assert.ok(view.items[0].previousFingerprint);
});
test('interrupted record/index write repairs itself during replay', async () => {
  const db = store(); const originalSave = db.save;
  let fail = true;
  db.save = async (id, value) => { if (id.includes(':index:') && fail) { fail = false; throw new Error('synthetic interruption'); } return originalSave(id, value); };
  const queue = new SpacePromoReviewQueue({ store: db, now: () => now });
  await assert.rejects(queue.record(message, pins));
  await queue.resume([message], pins);
  assert.equal((await queue.overview(pins)).count, 1);
});
test('generic DICE links remain in source inbox without claiming DOMNROB attribution', async () => {
  const db = store(); const queue = new SpacePromoReviewQueue({ store: db, now: () => now });
  const result = await queue.record({ ...message, text: 'Tickets https://link.dice.fm/synthetic-general-club-fixture' }, pins);
  assert.equal(result.retained, false);
  assert.equal(db.rows.size, 0);
});
