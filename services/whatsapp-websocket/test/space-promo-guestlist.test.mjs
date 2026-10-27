import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSpacePromoGuestlist, DOMNROB_GUESTLIST_INSTRUCTION } from '../space-promo-guestlist.mjs';
const pins = { 'Promoters 🖤👾🖤': '123456789@g.us' };
const now = Date.parse('2026-10-27T16:00:00Z');
const text = 'Venue: Club Space\nEvent: Fixture Event\nDate: 2026-10-30\nPromoter list: 11 PM - 1 AM\nEligibility: everyone\nOffer: Approved list only; subject to capacity';
const parse = (body = text) => prepareSpacePromoGuestlist({ groupId: pins['Promoters 🖤👾🖤'], id: 'fixture', sentAt: (now - 60000) / 1000, text: body }, pins, now);
test('explicit overnight promoter list keeps exact source hours, conditions and DOMNROB instruction', () => {
  const result = parse();
  assert.equal(result.status, 'queued');
  const p = result.candidates[0].payload;
  assert.equal(p.guestlistStartLocal, '23:00'); assert.equal(p.guestlistEndLocal, '01:00');
  assert.equal(p.guestlistTimeText, '11 PM - 1 AM');
  assert.equal(p.guestlistInstruction, DOMNROB_GUESTLIST_INSTRUCTION);
  assert.equal(p.guestlistGenderTarget, 'unisex');
  assert.equal(p.offerText, 'Approved list only; subject to capacity');
});
test('one end time requires explicit calendar cutoff and no bare hour is inferred', () => {
  assert.equal(parse(text.replace('11 PM - 1 AM', 'until 1 AM')).status, 'pending');
  const explicit = parse(text.replace('11 PM - 1 AM', 'until 1 AM') + '\nEnd date: 2026-10-31');
  assert.equal(explicit.status, 'queued');
  assert.equal(explicit.candidates[0].payload.guestlistEndDate, '2026-10-31');
  assert.equal(parse(text.replace('11 PM - 1 AM', '11 - 1')).status, 'pending');
});
test('missing eligibility, unknown event date and contradictory facts remain pending', () => {
  for (const body of [text.replace('Eligibility: everyone', ''), text.replace('2026-10-30', 'Friday'), text + '\nDate: 2026-10-31', text.replace('1 AM', '25:00')]) assert.equal(parse(body).status, 'pending');
});
test('women-only offer never defaults to unisex', () => {
  assert.equal(parse(text.replace('everyone', 'women')).candidates[0].payload.guestlistGenderTarget, 'female');
});
