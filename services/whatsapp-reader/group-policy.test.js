import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVED_GROUP_NAMES,
  isApprovedPinnedGroupId,
  resolveApprovedGroupMetadata
} from './group-policy.js';

const groups = ids => APPROVED_GROUP_NAMES.map((name, index) => ({
  name,
  isGroup: true,
  id: { _serialized: ids[index] }
}));

test('only exact approved group metadata is eligible for pinning', () => {
  const unrelated = [
    { name: 'Promoters 🖤👾🖤 old', isGroup: true, id: 'other@g.us' },
    { name: 'LIV MIAMI', isGroup: false, id: 'contact@c.us' },
    { name: 'Private friend', isGroup: true, id: 'private@g.us' }
  ];
  const result = resolveApprovedGroupMetadata([...groups(['a@g.us', 'b@g.us', 'c@g.us', 'd@g.us']), ...unrelated]);
  assert.equal(result.ready, true);
  assert.deepEqual(Object.keys(result.pinned), APPROVED_GROUP_NAMES);
  assert.equal(isApprovedPinnedGroupId('private@g.us', result.pinned), false);
  assert.equal(isApprovedPinnedGroupId('a@g.us', result.pinned), true);
});

test('missing exact names are reported and no IDs are pinned', () => {
  const result = resolveApprovedGroupMetadata(groups(['a@g.us', 'b@g.us', 'c@g.us']).slice(0, 3));
  assert.equal(result.ready, false);
  assert.equal(result.groups['STUDIO 60 PROMO'].status, 'missing');
  assert.equal(result.pinned, null);
});

test('duplicate exact names block pinning instead of selecting one', () => {
  const chats = [...groups(['a@g.us', 'b@g.us', 'c@g.us', 'd@g.us']), {
    name: 'SPACE TABLES',
    isGroup: true,
    id: 'other-space@g.us'
  }];
  const result = resolveApprovedGroupMetadata(chats);
  assert.equal(result.ready, false);
  assert.equal(result.groups['SPACE TABLES'].status, 'duplicate');
  assert.equal(result.groups['SPACE TABLES'].candidates.length, 2);
  assert.equal(result.pinned, null);
});

test('duplicate WhatsApp IDs across labels also block pinning', () => {
  const result = resolveApprovedGroupMetadata(groups(['same@g.us', 'same@g.us', 'c@g.us', 'd@g.us']));
  assert.equal(result.ready, false);
  assert.equal(result.pinned, null);
});
