import { APPROVED_GROUP_NAMES, isApprovedPinnedGroupId, resolveApprovedGroupMetadata } from './group-policy.js';
import { OfflineWhatsAppReviewReader } from './offline-review-reader.js';

const RECOVERY_LIMIT_PER_GROUP = 100;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

function idFor(message) {
  const id = message?.id;
  return typeof id?._serialized === 'string' ? id._serialized : id?.id;
}

export class WhatsAppGroupRuntime {
  constructor({ client, store, onUpdate = () => {} }) {
    this.client = client;
    this.store = store;
    this.onUpdate = onUpdate;
    this.reader = null;
    this.resolution = null;
    this.status = 'prepared';
    this.stopReason = null;
    this.messageHandler = message => this.handleMessage(message);
    this.editHandler = (message, newBody) => this.handleMessage(message, () => newBody);
  }

  snapshot() {
    if (this.reader) return { ...this.reader.snapshot(), groupResolution: this.resolution?.groups || null };
    return {
      status: this.status,
      stopReason: this.stopReason,
      pendingCount: 0,
      groups: Object.fromEntries(APPROVED_GROUP_NAMES.map(name => [name, {
        idPinned: false,
        lastProcessedAt: null,
        status: this.status,
        discovery: this.resolution?.groups?.[name]?.status || 'pending',
        candidateCount: this.resolution?.groups?.[name]?.candidates?.length || 0
      }])),
      groupResolution: this.resolution?.groups || null
    };
  }

  async start() {
    this.status = 'prepared';
    this.resolution = resolveApprovedGroupMetadata(await this.client.getChats());
    if (!this.resolution.ready) {
      this.status = 'blocked';
      this.stopReason = 'groups_missing_or_duplicated';
      this.onUpdate(this.snapshot());
      return this.snapshot();
    }

    this.reader = new OfflineWhatsAppReviewReader({
      store: this.store,
      validatedGroups: this.resolution
    });
    await this.reader.initialize();
    this.client.on('message', this.messageHandler);
    this.client.on('message_edit', this.editHandler);
    this.reader.setConnectionStatus('active');
    this.onUpdate(this.snapshot());

    // Catch up only the four pinned group IDs. Duplicates in the live stream
    // and catch-up are safe because the encrypted reader state fingerprints them.
    try {
      for (const name of APPROVED_GROUP_NAMES) {
        const id = this.resolution.pinned[name];
        const chat = await this.client.getChatById(id);
        if (!chat || chat.isGroup !== true) continue;
        const messages = await chat.fetchMessages({ limit: RECOVERY_LIMIT_PER_GROUP, fromMe: false });
        for (const message of messages) await this.handleMessage(message);
      }
    } catch (error) {
      this.status = 'blocked';
      this.stopReason = error?.code || 'recovery_failed';
      this.reader.setConnectionStatus('blocked', this.stopReason);
      this.onUpdate(this.snapshot());
      throw error;
    }
    this.onUpdate(this.snapshot());
    return this.snapshot();
  }

  async handleMessage(message, editedBody) {
    const chatId = message?.from || message?.id?.remote?._serialized || message?.id?.remote;
    if (!this.reader || !isApprovedPinnedGroupId(chatId, this.resolution?.pinned)) return;

    const hasMedia = message.hasMedia === true;
    const mediaSize = Number(message?._data?.size);
    const record = {
      chatId,
      messageId: idFor(message),
      timestamp: Number.isFinite(message.timestamp) ? new Date(message.timestamp * 1000).toISOString() : undefined,
      hasMedia,
      mediaSize: Number.isSafeInteger(mediaSize) ? mediaSize : null,
      // All potentially sensitive fields remain lazy until the exact group ID passed.
      getBody: () => editedBody ? editedBody() : message.body,
      get type() { return message.type; },
      get mediaKey() { return message.mediaKey; },
      downloadAttachments: hasMedia && Number.isSafeInteger(mediaSize) && mediaSize >= 0 && mediaSize <= MAX_MEDIA_BYTES
        ? async () => {
            const media = await message.downloadMedia();
            if (!media?.data) return [];
            const bytes = Buffer.from(media.data, 'base64');
            return bytes.length <= MAX_MEDIA_BYTES ? [bytes] : [];
          }
        : undefined
    };
    await this.reader.processIncoming(record);
    this.onUpdate(this.snapshot());
  }

  disconnected(reason = 'disconnected') {
    this.client.removeListener('message', this.messageHandler);
    this.client.removeListener('message_edit', this.editHandler);
    this.reader?.setConnectionStatus('disconnected', reason);
    this.status = 'disconnected';
    this.stopReason = reason;
    this.onUpdate(this.snapshot());
  }
}
