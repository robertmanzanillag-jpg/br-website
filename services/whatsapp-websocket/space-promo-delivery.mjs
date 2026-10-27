import { createHash, createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { prepareSpacePromoGuestlist } from './space-promo-guestlist.mjs';
import { SpacePromoReviewQueue, SPACE_PROMO_GROUP } from './space-promo-review-queue.mjs';

export const SPACE_PROMO_URL = 'https://kongnightlife.com/api/integrations/black-room/space-promo-updates';
const INDEX = 'space-promo-delivery:index';
const RETRY_MS = [30000, 120000, 600000, 3600000, 21600000];
const hash = value => createHash('sha256').update(value).digest('hex');
const safeReason = value => typeof value === 'string' && /^[a-z0-9_,:-]{1,180}$/.test(value) ? value : 'receiver_review';

export class SpacePromoDelivery extends EventEmitter {
  constructor({ store, secret = process.env.BLACK_ROOM_TABLE_READER_HMAC_SECRET || '', hostReady = process.env.BLACK_ROOM_TABLE_READER_ENABLED === 'true', fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    super(); this.store = store; this.secret = secret; this.hostReady = hostReady; this.fetch = fetchImpl; this.now = now;
    this.review = new SpacePromoReviewQueue({ store, now });
    this.closed = false; this.paused = false; this.tail = Promise.resolve();
    this.timers = new Map(); this.inFlight = new Set(); this.controllers = new Map();
  }
  configured() { return this.hostReady === true && typeof this.secret === 'string' && this.secret.length >= 32 && this.secret.trim() === this.secret; }
  async index() { return await this.store.load(INDEX) || { ids: [] }; }
  async indexRecord(id) {
    const index = await this.index();
    if (!index.ids.includes(id)) {
      if (index.ids.length >= 5000) throw new Error('space_promo_delivery_limit');
      await this.store.save(INDEX, { ids: [...index.ids, id] });
    }
  }
  record(message, pins) {
    const operation = this.tail.then(() => this.recordSerial(message, pins));
    this.tail = operation.catch(() => {});
    return operation;
  }
  async recordSerial(message, pins) {
    if (!/^\d+(?:-\d+)?@g\.us$/.test(pins?.[SPACE_PROMO_GROUP] || '') || message?.groupId !== pins[SPACE_PROMO_GROUP]) return { status: 'ignored' };
    await this.review.record(message, pins);
    const prepared = prepareSpacePromoGuestlist(message, pins, this.now());
    const id = `space-promo-delivery:${hash(`${message.groupId}\0${message.id}`)}`;
    const fingerprint = hash(JSON.stringify([message.text, message.sentAt]));
    const previous = await this.store.load(id);
    if (previous && previous.fingerprint !== fingerprint) {
      // Preserve confirmed outcomes and original evidence. Edits require review.
      await this.store.save(id, { ...previous, status: 'pending_review', reason: 'source_conflict', conflictEvidence: message.text, updatedAt: new Date(this.now()).toISOString() });
      await this.indexRecord(id);
      return { id, status: 'pending_review', reason: 'source_conflict' };
    }
    if (previous && (previous.reason === 'source_conflict' || previous.items?.some(item => item.payload))) {
      await this.indexRecord(id);
      if (this.configured() && ['queued', 'retry_wait'].includes(previous.status)) this.schedule(id, Math.max(0, (previous.nextAttemptAt || 0) - this.now()));
      return previous;
    }
    const items = prepared.candidates.map(candidate => ({
      payload: candidate.payload || null,
      status: candidate.payload ? 'queued' : 'pending_review', reason: candidate.reason || null,
      attempts: 0, nextAttemptAt: null,
    }));
    const record = {
      id, fingerprint, sourceGroup: SPACE_PROMO_GROUP, sourceMessageId: message.id,
      items, status: items.some(item => item.payload) ? 'queued' : 'pending_review',
      reason: prepared.reason || null, evidenceExcerpt: message.text,
      createdAt: previous?.createdAt || new Date(this.now()).toISOString(),
    };
    if (!this.configured() && record.status === 'queued') record.reason = 'integration_disabled';
    await this.store.save(id, record); await this.indexRecord(id);
    if (this.configured() && record.status === 'queued') this.schedule(id, 0);
    return record;
  }
  async resume(messages = [], pins = {}) {
    this.paused = false;
    for (const message of messages) if (message.groupId === pins[SPACE_PROMO_GROUP]) await this.record(message, pins);
    for (const id of (await this.index()).ids) {
      const record = await this.store.load(id);
      if (record && this.configured() && ['queued', 'retry_wait'].includes(record.status)) this.schedule(id, Math.max(0, (record.nextAttemptAt || 0) - this.now()));
    }
  }
  schedule(id, delay) {
    if (this.closed || this.paused || !this.configured()) return;
    clearTimeout(this.timers.get(id));
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.deliver(id).catch(error => this.emit('storage-error', error));
    }, delay);
    timer.unref?.(); this.timers.set(id, timer);
  }
  aggregate(record) {
    if (record.items.some(item => item.status === 'retry_wait')) return 'retry_wait';
    if (record.items.some(item => item.status === 'queued')) return 'queued';
    if (record.items.length && record.items.every(item => ['applied', 'duplicate'].includes(item.status))) return 'applied';
    return 'pending_review';
  }
  async saveProgress(record) {
    record.status = this.aggregate(record);
    const deadlines = record.items.filter(item => item.status === 'retry_wait').map(item => item.nextAttemptAt);
    record.nextAttemptAt = deadlines.length ? Math.min(...deadlines) : null;
    record.updatedAt = new Date(this.now()).toISOString();
    await this.store.save(record.id, record);
    this.emit('status', { status: record.status, lastAttemptAt: record.lastAttemptAt || null });
    if (record.status === 'retry_wait') this.schedule(record.id, Math.max(0, record.nextAttemptAt - this.now()));
  }
  retry(item) {
    const delay = RETRY_MS[item.attempts - 1];
    if (delay === undefined) { item.status = 'pending_review'; item.reason = 'retry_limit_reached'; item.nextAttemptAt = null; }
    else { item.status = 'retry_wait'; item.reason = 'temporary_receiver_failure'; item.nextAttemptAt = this.now() + delay; }
  }
  deliver(id) {
    // Serialize source revisions with network completion so a delayed response
    // cannot overwrite a newer source-conflict decision.
    const operation = this.tail.then(() => this.deliverSerial(id));
    this.tail = operation.catch(() => {});
    return operation;
  }
  async deliverSerial(id) {
    if (this.closed || this.paused || !this.configured() || this.inFlight.has(id)) return;
    this.inFlight.add(id);
    try {
      const record = await this.store.load(id);
      if (!record || !['queued', 'retry_wait'].includes(record.status) || record.reason === 'source_conflict') return;
      if (record.reason === 'integration_disabled') record.reason = null;
      for (const item of record.items) {
        if (this.closed || this.paused) break;
        if (!item.payload || !['queued', 'retry_wait'].includes(item.status)) continue;
        if (item.nextAttemptAt && item.nextAttemptAt > this.now()) continue;
        if (this.now() - Date.parse(item.payload.sourceTimestamp) > 7 * 86400000) { item.status = 'pending_review'; item.reason = 'source_older_than_7_days'; continue; }
        if (item.attempts > RETRY_MS.length) { item.status = 'pending_review'; item.reason = 'retry_limit_reached'; continue; }
        const raw = JSON.stringify(item.payload);
        if (Buffer.byteLength(raw) > 128 * 1024) { item.status = 'pending_review'; item.reason = 'payload_limit'; continue; }
        item.attempts++; record.lastAttemptAt = new Date(this.now()).toISOString();
        // Persist attempt before network; a crash replays the same signed body ID.
        await this.store.save(id, record);
        const timestamp = String(Math.floor(this.now() / 1000));
        const controller = new AbortController(); this.controllers.set(id, controller);
        let response;
        try {
          response = await this.fetch(SPACE_PROMO_URL, {
            method: 'POST', redirect: 'manual',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
            headers: { 'Content-Type': 'application/json', 'X-Kong-BlackRoom-Timestamp': timestamp,
              'X-Kong-BlackRoom-Signature': `sha256=${createHmac('sha256', this.secret).update(`${timestamp}.${raw}`).digest('hex')}` },
            body: raw,
          });
        } catch {
          this.retry(item); await this.saveProgress(record); break;
        } finally { this.controllers.delete(id); }
        if (response.status === 200) {
          const body = await response.json().catch(() => ({}));
          item.status = ['applied', 'duplicate'].includes(body.status) ? body.status : 'pending_review';
          item.reason = item.status === 'pending_review' ? 'unrecognized_receiver_response' : null;
        } else if (response.status === 202) {
          const body = await response.json().catch(() => ({}));
          item.status = 'receiver_pending'; item.reason = safeReason(body.reason);
        } else if (response.status >= 300 && response.status < 400) {
          item.status = 'pending_review'; item.reason = 'redirect_rejected';
        } else if ([401, 403, 422].includes(response.status)) {
          item.status = 'pending_review'; item.reason = response.status === 401 ? 'invalid_signature' : response.status === 403 ? 'forbidden_group' : 'invalid_payload';
        } else this.retry(item);
        await this.saveProgress(record);
      }
      await this.saveProgress(record);
    } finally { this.inFlight.delete(id); }
  }
  async overview() {
    await this.tail;
    const counts = {}, reasons = {};
    let lastAttemptAt = null;
    for (const id of (await this.index()).ids) {
      const record = await this.store.load(id); if (!record) continue;
      counts[record.status] = (counts[record.status] || 0) + 1;
      if (record.lastAttemptAt && (!lastAttemptAt || record.lastAttemptAt > lastAttemptAt)) lastAttemptAt = record.lastAttemptAt;
      for (const item of record.items || []) if (item.reason) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
      if (record.reason) reasons[record.reason] = (reasons[record.reason] || 0) + 1;
    }
    return { enabled: this.configured(), status: this.closed ? 'closed' : this.paused ? 'paused' : this.configured() ? 'ready' : 'integration_disabled', counts, reasons, lastAttemptAt };
  }
  pause() { this.paused = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); for (const controller of this.controllers.values()) controller.abort(); }
  async drain() { await this.tail; }
  close() { this.closed = true; this.pause(); }
}
