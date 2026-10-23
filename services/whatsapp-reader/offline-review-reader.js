import { createHash } from 'node:crypto';
import { APPROVED_GROUP_NAMES, isApprovedPinnedGroupId } from './group-policy.js';

const STATE_VERSION = 1;
const MAX_BODY_BYTES = 96 * 1024;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function serializeBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function newState(pinned) {
  return {
    version: STATE_VERSION,
    pinned: { ...pinned },
    groups: Object.fromEntries(APPROVED_GROUP_NAMES.map(name => [
      pinned[name],
      { name, lastProcessedAt: null }
    ])),
    latestFingerprint: {},
    items: []
  };
}

function validPinnedGroups(validatedGroups) {
  if (!validatedGroups?.ready || !validatedGroups.pinned) return false;
  const ids = APPROVED_GROUP_NAMES.map(name => validatedGroups.pinned[name]);
  return ids.every(id => typeof id === 'string' && id.length > 0)
    && new Set(ids).size === APPROVED_GROUP_NAMES.length;
}

function fingerprintMessage({ chatId, messageId, body, type, mediaKey }) {
  return createHash('sha256')
    .update(JSON.stringify([chatId, messageId, body, type || '', mediaKey || '']))
    .digest('hex');
}

export class OfflineWhatsAppReviewReader {
  constructor({ store, validatedGroups, now = () => new Date() }) {
    this.store = store;
    this.validatedGroups = validatedGroups;
    this.now = now;
    this.status = validPinnedGroups(validatedGroups) ? 'prepared' : 'blocked';
    this.stopReason = this.status === 'blocked' ? 'groups_unvalidated' : null;
    this.state = validPinnedGroups(validatedGroups) ? newState(validatedGroups.pinned) : null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    if (this.status === 'blocked') return this.snapshot();
    try {
      const saved = await this.store.loadReaderState();
      if (saved) {
        const restored = JSON.parse(saved.toString('utf8'));
        if (restored.version !== STATE_VERSION
            || JSON.stringify(restored.pinned) !== JSON.stringify(this.validatedGroups.pinned)
            || !restored.groups || !Array.isArray(restored.items)
            || !restored.latestFingerprint || typeof restored.latestFingerprint !== 'object') {
          throw Object.assign(new Error('Reader state is invalid or belongs to different pinned IDs.'), { code: 'WA_READER_STATE_INVALID' });
        }
        this.state = restored;
      } else {
        await this.store.saveReaderState(Buffer.from(JSON.stringify(this.state)));
      }
      this.status = 'prepared';
      this.stopReason = null;
    } catch (error) {
      this.status = 'blocked';
      this.stopReason = error?.code || 'reader_state_unavailable';
      throw error;
    }
    return this.snapshot();
  }

  setConnectionStatus(status, reason = null) {
    if (!['prepared', 'blocked', 'disconnected', 'active'].includes(status)) {
      throw new TypeError('Invalid WhatsApp reader status.');
    }
    this.status = status;
    this.stopReason = reason;
    return this.snapshot();
  }

  snapshot() {
    const groups = Object.fromEntries(APPROVED_GROUP_NAMES.map(name => {
      const id = this.validatedGroups?.pinned?.[name];
      const groupState = this.state?.groups?.[id];
      return [name, {
        idPinned: Boolean(id && groupState?.name === name),
        lastProcessedAt: groupState?.lastProcessedAt ?? null,
        status: this.status
      }];
    }));
    return {
      status: this.status,
      stopReason: this.stopReason,
      groups,
      pendingCount: this.state?.items?.length ?? 0,
      storageBytes: Buffer.byteLength(JSON.stringify(this.state || {}))
    };
  }

  processIncoming(message) {
    const pending = this.queue.then(() => this.processOne(message));
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async processOne(message) {
    // This is intentionally the first access to the incoming record.
    const chatId = message?.chatId;
    if (!isApprovedPinnedGroupId(chatId, this.validatedGroups?.pinned)
        || this.status === 'blocked' || !this.state) {
      return { accepted: false, reason: this.status === 'blocked' ? this.stopReason : 'unauthorized_group' };
    }

    const messageId = message.messageId;
    if (typeof messageId !== 'string' || !messageId) {
      return { accepted: false, reason: 'invalid_message_id' };
    }
    const body = typeof message.getBody === 'function' ? await message.getBody() : message.body;
    const text = typeof body === 'string' ? body : '';
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return { accepted: false, reason: 'message_too_large' };
    }

    const type = message.type || '';
    const mediaKey = message.mediaKey || '';
    const fingerprint = fingerprintMessage({ chatId, messageId, body: text, type, mediaKey });
    const key = `${chatId}:${messageId}`;
    const previous = this.state.latestFingerprint[key];
    const processedAt = this.now().toISOString();
    const groupState = this.state.groups[chatId];
    if (!groupState) return { accepted: false, reason: 'unauthorized_group' };

    if (previous === fingerprint) {
      return { accepted: true, duplicate: true, processedAt };
    }

    let attachments = [];
    let attachmentsStatus = 'none';
    const mediaSize = message.mediaSize;
    if (message.hasMedia === true
        && (!Number.isSafeInteger(mediaSize) || mediaSize < 0 || mediaSize > MAX_ATTACHMENT_BYTES)) {
      attachmentsStatus = 'skipped_size_unknown_or_over_limit';
    } else if (typeof message.downloadAttachments === 'function') {
      const downloaded = await message.downloadAttachments();
      attachments = (downloaded || []).map(serializeBytes);
      attachmentsStatus = attachments.length ? 'saved' : message.hasMedia ? 'unavailable' : 'none';
    } else if (Array.isArray(message.attachments)) {
      attachments = message.attachments.map(serializeBytes);
      attachmentsStatus = attachments.length ? 'saved' : 'none';
    }
    if (attachments.some(file => file.length > MAX_ATTACHMENT_BYTES)
        || attachments.reduce((sum, file) => sum + file.length, 0) > MAX_ATTACHMENT_BYTES) {
      return { accepted: false, reason: 'attachment_too_large' };
    }

    const revision = (this.state.items.filter(item => item.key === key).length || 0) + 1;
    const item = {
      key,
      revision,
      change: previous ? 'edited' : 'new',
      groupName: groupState.name,
      groupId: chatId,
      messageId,
      fingerprint,
      timestamp: message.timestamp || processedAt,
      processedAt,
      type,
      body: text,
      attachmentsStatus,
      attachments: attachments.map(file => file.toString('base64'))
    };
    const next = {
      ...this.state,
      latestFingerprint: { ...this.state.latestFingerprint, [key]: fingerprint },
      groups: {
        ...this.state.groups,
        [chatId]: { ...groupState, lastProcessedAt: processedAt }
      },
      items: [...this.state.items, item]
    };

    try {
      await this.store.saveReaderState(Buffer.from(JSON.stringify(next)));
    } catch (error) {
      if (['WA_BUDGET_LIMIT', 'WA_STORAGE_LIMIT'].includes(error?.code)) {
        this.status = 'blocked';
        this.stopReason = 'budget_stopped';
        return { accepted: false, reason: this.stopReason };
      }
      this.status = 'blocked';
      this.stopReason = error?.code || 'reader_state_unavailable';
      throw error;
    }

    this.state = next;
    return { accepted: true, duplicate: false, change: item.change, revision, processedAt };
  }

  getReviewItems() {
    return (this.state?.items || []).map(item => ({
      ...item,
      attachments: item.attachments.map(encoded => Buffer.from(encoded, 'base64'))
    }));
  }
}
