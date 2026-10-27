const MAX_INBOX_RESPONSE = 10 * 1024 * 1024;

export function inboxView(items, pins, limit = 100, { group: selectedGroup = null, includeMedia = true } = {}) {
    const result = []; let bytes = 0; let truncated = items.length >= Math.min(100, Number(limit) || 100);
    for (const item of items) {
      const group = Object.keys(pins).find(name => pins[name] === item.groupId);
      if (!group || (selectedGroup && group !== selectedGroup)) continue;
      const media = includeMedia ? item.media || null : item.media ? { state: 'omitted', mimeType: item.media.mimeType } : null;
      const recordBytes = Buffer.byteLength(item.text || '') + Buffer.byteLength(media?.data || '');
      if (bytes + recordBytes > MAX_INBOX_RESPONSE) { truncated = true; break; }
      bytes += recordBytes;
      result.push({ group, text: item.text || '', media, sentAt: item.sentAt, origin: item.origin, sourceId: item.id });
    }
    return { items: result, truncated };
}
