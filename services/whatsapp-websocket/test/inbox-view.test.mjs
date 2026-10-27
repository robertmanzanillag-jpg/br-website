import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxView } from '../inbox-view.mjs';
const pins = { 'SPACE TABLES': 'space', 'LIV MIAMI': 'liv' };
const large = { groupId: 'space', id: 'flyer', text: '', media: { state: 'available', mimeType: 'image/jpeg', data: 'x'.repeat(6 * 1024 * 1024) } };
const items = [large, { ...large, id: 'second' }, { groupId: 'space', id: 'quote', text: 'fixture table quote', sentAt: 1 }, { groupId: 'liv', id: 'other', text: 'other group' }];
test('text-only Space view reveals records hidden behind image response cap without returning image bytes', () => {
  assert.equal(inboxView(items, pins).truncated, true);
  const result = inboxView(items, pins, 100, { group: 'SPACE TABLES', includeMedia: false });
  assert.equal(result.truncated, false);
  assert.deepEqual(result.items.map(x => x.sourceId), ['flyer', 'second', 'quote']);
  assert.deepEqual(result.items[0].media, { state: 'omitted', mimeType: 'image/jpeg' });
  assert.equal(JSON.stringify(result).includes('data'), false);
  assert.equal(items[0].media.data.length, 6 * 1024 * 1024);
});
test('filtered view rejects unknown groups and records outside pinned identities', () => {
  assert.deepEqual(inboxView(items, pins, 100, { group: '__proto__' }).items, []);
  assert.deepEqual(inboxView([{ groupId: 'private', text: 'excluded' }], pins).items, []);
});
test('image view remains bounded and preserves source evidence metadata', () => {
  const result = inboxView(items, pins, 100, { group: 'SPACE TABLES' });
  assert.equal(result.truncated, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceId, 'flyer');
  assert.equal(result.items[0].media.state, 'available');
});
