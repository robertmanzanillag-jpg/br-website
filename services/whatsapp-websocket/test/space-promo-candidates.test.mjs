import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSpacePromoCandidates } from '../space-promo-candidates.mjs';

// Synthetic fixtures, not live DOMNROB URLs or real DICE attribution claims.
const now = Date.parse('2026-10-27T16:00:00Z');
const url = 'https://dice.fm/event/fixture-event?x=Ab%2Fc&ref=opaque-Fixture&x=two';
const policy = { groupId: '123456789@g.us', groupName: 'Fixture Space Promo', links: [{ url, owner: 'DOMNROB', attributionVerified: true, eventId: 'fixture-event-id', eventDate: '2026-10-30', venueName: 'Club Space', eventTitle: 'Fixture Event' }] };
const msg = text => ({ groupId: policy.groupId, id: 'fixture-message', sentAt: (now - 60000) / 1000, text });
const parse = (text, p = policy) => prepareSpacePromoCandidates(msg(text), p, now);

test('unverified group never inspects text or produces candidates', () => {
  const message = { groupId: '999@g.us', get text() { throw new Error('must not inspect unauthorized body'); } };
  assert.deepEqual(prepareSpacePromoCandidates(message, policy, now).reasons, ['group_identity_unverified']);
});
test('verified exact mapping preserves tracking URL bytes and canonical event identity', () => {
  const result = parse(`DOMNROB\n${url}`);
  assert.equal(result.status, 'ready');
  assert.equal(result.candidates[0].purchaseUrl, url);
  assert.equal(result.candidates[0].eventId, 'fixture-event-id');
  assert.equal(result.candidates[0].sourceMessageId, 'fixture-message');
});
test('display name and invented DOMNROB query are not attribution proof', () => {
  for (const candidate of [url, 'https://dice.fm/event/fixture-event?ref=DOMNROB']) {
    const result = parse(`DOMNROB\n${candidate}`, { ...policy, links: [] });
    assert.equal(result.status, 'pending');
    assert.ok(result.candidates[0].reasons.includes('domnrob_attribution_unverified'));
  }
});
test('other promoters and unlabeled unknown links cannot be picked', () => {
  const result = parse('OTHER PROMOTER\nhttps://dice.fm/event/other-fixture?ref=someone');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.status, 'pending');
});
test('DICE short links also require exact verified attribution; generic club links never qualify', () => {
  const short = 'https://link.dice.fm/synthetic-domnrob-fixture';
  const generic = 'https://link.dice.fm/synthetic-club-fixture';
  assert.equal(parse(`DOMNROB\n${generic}`).status, 'pending');
  const p = { ...policy, links: [{ ...policy.links[0], url: short }] };
  const result = parse(short, p);
  assert.equal(result.status, 'ready');
  assert.equal(result.candidates[0].purchaseUrl, short);
});
test('credentials, lookalike domains and shorteners remain pending even in bad verified configuration', () => {
  for (const bad of ['https://dice.fm.evil.test/event/fixture', 'https://user:pass@dice.fm/event/fixture', 'https://bit.ly/fixture', 'https://dice.fm:444/event/fixture']) {
    const p = { ...policy, links: [{ ...policy.links[0], url: bad }] };
    assert.ok(parse(`DOMNROB\n${bad}`, p).candidates[0].reasons.includes('unsupported_or_unsafe_purchase_url'));
  }
});
test('deals keep exact terms for review rather than inventing prices or conditions', () => {
  const result = parse(`DOMNROB\nDeal: free before midnight for approved list only\n${url}`);
  assert.equal(result.candidates[0].purchaseUrl, url);
  assert.equal(result.candidates[0].dealStatus, 'pending');
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.candidates[0].dealEvidence, ['Deal: free before midnight for approved list only']);
  assert.equal('price' in result.candidates[0], false);
  assert.equal(parse('Deal: free entry tonight').status, 'pending');
});
test('guestlist announcements retain dates and restrictions as evidence without creating a false deal', () => {
  const text = 'Space Friday Oct 30\nGuestlist free before midnight, approval required\nLadies only; subject to capacity';
  const result = parse(text);
  assert.equal(result.status, 'pending');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.dealCandidates.length, 1);
  assert.equal(result.dealCandidates[0].evidenceExcerpt, text);
  assert.equal(result.dealCandidates[0].eventId, null);
  assert.equal(result.dealCandidates[0].reason, 'deal_event_mapping_unverified');
});
test('multiple links cannot bind deal terms to the wrong event', () => {
  const result = parse(`DOMNROB\nDeal: fixture offer\n${url}\nhttps://dice.fm/event/other-fixture`);
  assert.equal(result.candidates[0].dealReason, 'deal_event_ambiguous');
});
test('past events, stale messages, conflicting mappings and changed URL bytes do not auto-apply', () => {
  assert.equal(parse(url, { ...policy, links: [{ ...policy.links[0], eventDate: '2026-10-26' }] }).status, 'pending');
  assert.equal(prepareSpacePromoCandidates({ ...msg(url), sentAt: (now - 8 * 86400000) / 1000 }, policy, now).status, 'pending');
  assert.equal(parse(url, { ...policy, links: [policy.links[0], { ...policy.links[0], eventId: 'other-event' }] }).status, 'pending');
  assert.equal(parse(`DOMNROB\n${url.replace('%2F', '%2f')}`).status, 'pending');
});
