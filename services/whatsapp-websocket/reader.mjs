import makeWASocket, { initAuthCreds, proto, normalizeMessageContent, downloadMediaMessage, DisconnectReason } from './baileys-runtime.mjs';
import pino from 'pino';
import { EventEmitter } from 'node:events';

export const GROUP_NAMES = Object.freeze(['Promoters 🖤👾🖤', 'LIV MIAMI', 'SPACE TABLES', 'STUDIO 60 PROMO']);
const GROUP_ID = /^\d+(?:-\d+)?@g\.us$/;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_TEXT = 96 * 1024;
const silent = pino({ level: 'silent' });

function containsPrivateView(message) {
  for (let depth = 0; message && depth < 6; depth++) {
    if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension || message.groupStatusMessage || message.groupStatusMessageV2) return true;
    message = message.ephemeralMessage?.message || message.editedMessage?.message;
  }
  return false;
}

export function resolveGroups(metadata, previous = null) {
  const result = {};
  for (const name of GROUP_NAMES) {
    const found = Object.values(metadata).filter(group => group.subject === name && GROUP_ID.test(group.id));
    if (found.length !== 1 || (previous && previous[name] !== found[0].id)) throw new Error('group_identity_unverified');
    result[name] = found[0].id;
  }
  if (new Set(Object.values(result)).size !== 4) throw new Error('group_identity_unverified');
  return result;
}

export async function encryptedAuth(store) {
  // Never replace unreadable auth with a fresh session. Its error must stop startup.
  const saved = await store.load('auth');
  const creds = saved?.creds || initAuthCreds();
  const keys = saved?.keys || {};
  const save = () => store.save('auth', { creds, keys });
  if (!saved) await save();
  return { save, state: { creds, keys: {
    async get(type, ids) {
      const result = {};
      for (const id of ids) {
        let value = keys[type]?.[id] ?? null;
        if (value && type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
        result[id] = value;
      }
      return result;
    },
    async set(data) {
      for (const [type, entries] of Object.entries(data)) {
        keys[type] ||= Object.create(null);
        for (const [id, value] of Object.entries(entries)) {
          if (value === null) delete keys[type][id];
          else Object.defineProperty(keys[type], id, { value, enumerable: true, writable: true, configurable: true });
        }
      }
      await save();
    },
  } } };
}

export class WebSocketReader extends EventEmitter {
  constructor({ store, socketFactory = makeWASocket, download = downloadMediaMessage, reconnectDelays = [5000, 15000, 30000, 60000, 120000] }) {
    super(); this.store = store; this.socketFactory = socketFactory; this.download = download;
    this.delays = reconnectDelays; this.attempt = 0; this.generation = 0;
    this.active = false; this.ready = false; this.pending = 0; this.queue = Promise.resolve();
    this.status = { state: 'stopped', processed: 0, historyCoverage: 'not_verified', groups: [] };
  }
  snapshot() { return structuredClone(this.status); }
  report(state) {
    this.status = { ...this.status, state, at: new Date().toISOString() };
    this.emit('status', this.snapshot());
  }
  async start() {
    if (this.active) return;
    this.active = true;
    this.attempt = 0; this.pairingRestarted = false;
    this.status.disconnectCode = null;
    try {
      await this.store.acquire();
      this.pins = await this.store.load('groups');
      this.auth = await encryptedAuth(this.store);
      await this.connect();
    } catch (error) {
      const known = ['reader_already_running', 'encrypted_state_unreadable', 'storage_limit', 'invalid_encryption_key'];
      this.status.startupCode = known.includes(error?.message) ? error.message : (/^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : 'connection_or_storage_failed');
      await this.stop('startup_failed');
    }
  }
  async connect() {
    if (!this.active) return;
    const generation = ++this.generation;
    this.ready = false; this.qr = null;
    this.report('connecting');
    const current = () => this.active && generation === this.generation;
    const socket = this.socketFactory({
      auth: this.auth.state, logger: silent,
      markOnlineOnConnect: false, emitOwnEvents: false,
      syncFullHistory: false, shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: jid => !Object.values(this.pins || {}).includes(jid),
      connectTimeoutMs: 30000, defaultQueryTimeoutMs: 20000,
      enableAutoSessionRecreation: false, enableRecentMessageCache: false,
      getMessage: async () => undefined,
    });
    this.socket = socket;
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => { if (current()) void this.stop('connect_timeout'); }, 45000);
    this.connectTimer.unref?.();
    const safe = task => { void task().catch(() => { if (current()) void this.stop('processing_failed'); }); };
    socket.ev.on('creds.update', () => { if (current()) safe(() => this.auth.save()); });
    socket.ev.on('connection.update', update => {
      if (!current()) return;
      if (update.qr) { clearTimeout(this.connectTimer); this.qr = update.qr; this.status.qrRevision = (this.status.qrRevision || 0) + 1; this.report('qr_required'); }
      if (update.isNewLogin) { this.qr = null; this.report('pairing_accepted'); }
      if (update.connection === 'open') safe(async () => {
        clearTimeout(this.connectTimer);
        this.qr = null;
        const groups = resolveGroups(await socket.groupFetchAllParticipating(), this.pins);
        if (!current()) return;
        await this.store.save('groups', groups);
        await this.auth.save();
        if (!current()) return;
        this.pins = groups; this.ready = true; this.attempt = 0;
        this.status.groups = Object.keys(groups).map(name => ({ name, identified: true }));
        this.report('reading');
      });
      if (update.connection === 'close') {
        clearTimeout(this.connectTimer);
        const hadQr = Boolean(this.qr);
        this.ready = false; this.qr = null;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        this.status.disconnectCode = Number.isSafeInteger(code) ? code : null;
        // QR expiry is not a network outage. Wait for the owner to request a fresh code.
        if (hadQr && !this.auth.state.creds.me && code === DisconnectReason.timedOut) {
          safe(() => this.stop('qr_expired')); return;
        }
        // WhatsApp intentionally restarts the transport after successful pairing.
        if (code === DisconnectReason.restartRequired && !this.pairingRestarted) {
          this.pairingRestarted = true; this.generation++;
          this.report('pairing_accepted');
          this.timer = setTimeout(() => { void this.connect().catch(() => this.stop('connection_failed')); }, 0);
          return;
        }
        if ([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(code)) {
          safe(() => this.stop('relink_required')); return;
        }
        this.generation++; // Invalidate every callback belonging to this socket.
        if (this.attempt >= this.delays.length) { safe(() => this.stop('reconnect_exhausted')); return; }
        this.report('reconnecting');
        this.timer = setTimeout(() => { void this.connect().catch(() => this.stop('connection_failed')); }, this.delays[this.attempt++]);
        this.timer.unref?.();
      }
    });
    socket.ev.on('messages.upsert', ({ messages }) => {
      if (!current()) return;
      for (const message of messages) this.enqueue(message, current);
    });
    socket.ev.on('messages.update', changes => {
      if (!current()) return;
      for (const { key, update } of changes) if (update.message) this.enqueue({ key, ...update }, current);
    });
    // Never silently follow renamed/replaced groups during a connected session.
    socket.ev.on('groups.update', changes => {
      if (!current() || !this.pins) return;
      for (const group of changes) {
        const name = Object.keys(this.pins).find(name => this.pins[name] === group.id);
        if (name && group.subject !== undefined && group.subject !== name) safe(() => this.stop('group_identity_unverified'));
      }
    });
  }
  enqueue(message, current) {
    const key = message?.key;
    // This gate runs BEFORE inspecting/decrypting application message bodies or downloading media.
    if (!this.ready || !key?.id || key.fromMe || !Object.values(this.pins || {}).includes(key.remoteJid)) return;
    if (this.pending >= 128) { void this.stop('queue_limit'); return; }
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (!current() || !this.ready) return;
      if (containsPrivateView(message.message)) return;
      const body = normalizeMessageContent(message.message);
      if (!body) return;
      // No view-once content, documents, audio, contacts, or location ingestion.
      const content = body.editedMessage?.message ? normalizeMessageContent(body.editedMessage.message) : body;
      const text = content?.conversation ?? content?.extendedTextMessage?.text ?? content?.imageMessage?.caption ?? '';
      if (Buffer.byteLength(text) > MAX_TEXT) throw new Error('message_limit');
      let media = null;
      const image = content?.imageMessage;
      if (image && /^image\/(jpeg|png|webp)$/.test(image.mimetype || '')) {
        const length = Number(image.fileLength);
        if (!Number.isFinite(length) || length <= 0 || length > MAX_IMAGE) media = { state: 'size_rejected' };
        else {
          try {
            const stream = await this.download({ ...message, message: content }, 'stream', { options: { signal: AbortSignal.timeout(15000) } });
            const chunks = []; let size = 0;
            try {
              for await (const chunk of stream) {
                size += chunk.length;
                if (size > MAX_IMAGE) throw new Error('media_limit');
                chunks.push(chunk);
              }
              media = { mimeType: image.mimetype, data: Buffer.concat(chunks).toString('base64'), state: 'available' };
            } finally { stream.destroy(); }
          } catch { media = { state: 'unavailable' }; }
        }
      }
      if (!text && !image) return;
      const timestamp = Number(message.messageTimestamp);
      const inserted = await this.store.saveMessage({ groupId: key.remoteJid, id: key.id, text, media,
        sentAt: Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null });
      if (inserted) this.status.processed++;
      this.report('reading');
    }).catch(() => { void this.stop('processing_failed'); }).finally(() => { this.pending--; });
  }
  // Called only by an owner-authenticated, no-store endpoint. Never put QR into logs/status.
  pairingQr() { return this.active && this.status.state === 'qr_required' ? this.qr : null; }
  async stop(state = 'stopped') {
    this.active = false; this.ready = false; this.generation++;
    clearTimeout(this.timer); clearTimeout(this.connectTimer); this.qr = null;
    const socket = this.socket; this.socket = null;
    try { socket?.end(undefined); } catch {}
    // Do not logout: logout invalidates the saved linked-device credentials.
    await this.queue;
    await this.store.release().catch(() => {});
    this.report(state);
  }
}
