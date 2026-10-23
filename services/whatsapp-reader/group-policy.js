export const APPROVED_GROUP_NAMES = Object.freeze([
  'Promoters 🖤👾🖤',
  'LIV MIAMI',
  'SPACE TABLES',
  'STUDIO 60 PROMO'
]);

function exactGroupName(chat) {
  return chat?.isGroup === true && APPROVED_GROUP_NAMES.includes(chat.name)
    ? chat.name
    : null;
}

function serializedId(chat) {
  const id = chat?.id?._serialized ?? chat?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function resolveApprovedGroupMetadata(chats) {
  const matches = Object.fromEntries(APPROVED_GROUP_NAMES.map(name => [name, []]));
  for (const chat of chats || []) {
    const name = exactGroupName(chat);
    const id = serializedId(chat);
    if (name && id) matches[name].push({ name, id });
  }

  const groups = Object.fromEntries(APPROVED_GROUP_NAMES.map(name => {
    const candidates = matches[name];
    return [name, {
      status: candidates.length === 0 ? 'missing' : candidates.length === 1 ? 'unique' : 'duplicate',
      candidates
    }];
  }));
  const uniqueIds = APPROVED_GROUP_NAMES
    .map(name => groups[name])
    .filter(group => group.status === 'unique')
    .map(group => group.candidates[0].id);
  const allUnique = APPROVED_GROUP_NAMES.every(name => groups[name].status === 'unique')
    && new Set(uniqueIds).size === APPROVED_GROUP_NAMES.length;

  return {
    ready: allUnique,
    groups,
    pinned: allUnique
      ? Object.fromEntries(APPROVED_GROUP_NAMES.map(name => [name, groups[name].candidates[0].id]))
      : null
  };
}

export function isApprovedPinnedGroupId(id, pinned) {
  return Boolean(pinned && Object.values(pinned).includes(id));
}
