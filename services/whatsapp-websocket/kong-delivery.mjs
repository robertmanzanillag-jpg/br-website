import { createHash, createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const KONG_URL = 'https://kongnightlife.com/api/integrations/black-room/table-price-updates';
const RETRY_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const GROUPS = new Set(['Promoters 🖤👾🖤', 'LIV MIAMI', 'SPACE TABLES', 'STUDIO 60 PROMO']);
const hash = value => createHash('sha256').update(value).digest('hex');

function field(block, label) {
  const matches = [...block.matchAll(new RegExp(`^\\s*${label}\\s*:\\s*(.*?)\\s*$`, 'gim'))];
  return matches.length === 1 && matches[0][1] ? matches[0][1].trim() : null;
}

function parseQuote(block, message, group) {
  const venueName = field(block, 'Venue');
  const dateRaw = field(block, 'Date');
  const tableType = field(block, 'Table');
  const spendRaw = field(block, 'Minimum spend');
  const currency = field(block, 'Currency');
  const conditions = field(block, 'Conditions');
  if (!venueName || !dateRaw || !tableType || !spendRaw || !currency || !conditions) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || new Date(`${dateRaw}T00:00:00Z`).toISOString().slice(0, 10) !== dateRaw) return null;
  if (!Number.isSafeInteger(message.sentAt) || message.sentAt <= 0) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const amount = spendRaw.match(/^(?:([A-Z]{3})\s*)?\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:([A-Z]{3}))?$/i);
  if (!amount || [amount[1], amount[3]].filter(Boolean).some(code => code.toUpperCase() !== currency)) return null;
  const minimumSpend = amount[2].replaceAll(',', '');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(minimumSpend)) return null;
  return {
    sourceGroup: group,
    sourceMessageId: message.id,
    sourceTimestamp: new Date(message.sentAt * 1000).toISOString(),
    venueName, eventDate: dateRaw, tableType, priceKind: 'minimum_spend',
    minimumSpend, currency, minimumSpendDisplay: spendRaw.trim(),
    conditions, evidenceExcerpt: block,
  };
}

export function prepareKongRecord(message, group, now = Date.now()) {
  const stableId = `kong:${hash(`${group}\0${message.id}`)}`;
  const text = typeof message.text === 'string' ? message.text : '';
  const fingerprint = hash(JSON.stringify([text, message.media?.state || null, message.media?.mimeType || null, message.media?.data || null]));
  const sentAt = Number(message.sentAt);
  const blocks = text.split(/^\s*---+\s*$/m).map(value => value.trim()).filter(Boolean);
  const parsed = blocks.map((block, index) => {
    const quote = parseQuote(block, { ...message, id: `${message.id}:item:${index + 1}` }, group);
    return quote;
  });
  const tooOld = !Number.isFinite(sentAt) || sentAt <= 0 || now - sentAt * 1000 > 7 * 86400_000;
  const complete = parsed.length > 0 && parsed.every(Boolean);
  const status = tooOld || !complete ? 'pending' : 'queued';
  const reason = tooOld ? 'older_than_7_days' : !text ? (message.media ? 'flyer_requires_review' : 'no_text_evidence')
    : !complete ? 'explicit_fields_required' : null;
  const candidates = complete ? parsed : [];
  return {
    id: stableId, sourceGroup: group, sourceMessageId: message.id, fingerprint,
    evidenceExcerpt: text, candidates,
    itemStates: candidates.map(() => ({ status: 'queued', attempts: 0, nextAttemptAt: null, reason: null })),
    status, reason, createdAt: new Date(now).toISOString(),
  };
}

export class KongDelivery extends EventEmitter {
  constructor({ store, secret = process.env.BLACK_ROOM_TABLE_READER_HMAC_SECRET || '', hostReady = process.env.BLACK_ROOM_TABLE_READER_ENABLED === 'true', fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    super();
    this.store = store; this.secret = secret; this.hostReady = hostReady === true; this.fetch = fetchImpl; this.now = now;
    this.timers = new Map(); this.inFlight = new Set(); this.closed = false; this.paused = false;
    this.state = {
      enabled: this.isConfigured(), hostReady: this.hostReady, secretValid: this.validSecret(),
      status: this.isConfigured() ? 'ready' : 'integration_disabled',
      delivered: 0, pending: 0, attempts: 0, applied: 0, duplicates: 0,
      receiverPending: 0, rejected: 0, networkFailures: 0, lastAttemptAt: null,
    };
  }
  validSecret() { return typeof this.secret === 'string' && this.secret.length >= 32 && this.secret.trim() === this.secret; }
  isConfigured() { return this.hostReady && this.validSecret(); }
  snapshot() { return { ...this.state }; }
  update(patch) {
    this.state = { ...this.state, ...patch, hostReady: this.hostReady, secretValid: this.validSecret() };
    this.emit('status', this.snapshot());
  }
  async record(message, group) {
    if (!GROUPS.has(group)) return { accepted: false, reason: 'forbidden_group' };
    const next = prepareKongRecord(message, group, this.now());
    const old = await this.store.getDelivery(next.id);
    if (old) {
      if (old.fingerprint !== next.fingerprint) {
        const conflict = { ...old, status: 'pending', reason: 'source_conflict', conflictEvidence: next.evidenceExcerpt, updatedAt: new Date(this.now()).toISOString() };
        await this.store.saveDelivery(next.id, conflict);
        this.state.pending++;
        return conflict;
      }
      if (['applied', 'duplicate', 'receiver_pending', 'source_conflict'].includes(old.status)) return old;
      if (old.status === 'queued' || old.status === 'retry_wait') {
        if (this.isConfigured() && this.state.enabled) void this.deliver(next.id);
        return old;
      }
    }
    if (!this.isConfigured() || !this.state.enabled) {
      next.status = 'pending';
      if (next.candidates.length) next.reason = 'integration_disabled';
      this.state.pending++;
      this.update({ enabled: false, status: 'integration_disabled' });
    } else {
      this.update({ enabled: true });
    }
    await this.store.saveDelivery(next.id, next);
    if (!this.isConfigured() || !this.state.enabled) {
      return next;
    }
    if (next.status === 'queued') void this.deliver(next.id);
    else { this.state.pending++; this.state.status = 'pending_review'; }
    return next;
  }
  async resume(messages = [], pins = {}) {
    this.paused = false;
    const records = await this.store.listDeliveries(5000);
    const known = new Map(records.map(record => [record.id, record]));
    for (const message of messages) {
      const group = Object.keys(pins).find(name => pins[name] === message.groupId);
      if (!group || !GROUPS.has(group)) continue;
      const next = prepareKongRecord(message, group, this.now());
      if (known.has(next.id)) continue;
      if (!this.isConfigured() && next.candidates.length) {
        next.status = 'pending'; next.reason = 'integration_disabled';
      }
      await this.store.saveDelivery(next.id, next);
      known.set(next.id, next);
    }
    this.update({ enabled: this.isConfigured(), status: this.isConfigured() ? 'ready' : 'integration_disabled' });
    for (const record of known.values()) {
      if (['applied', 'duplicate', 'receiver_pending', 'source_conflict'].includes(record.status)) continue;
      if (!this.isConfigured()) {
        if (['queued', 'retry_wait'].includes(record.status)) {
          record.status = 'pending'; record.reason = 'integration_disabled';
          await this.store.saveDelivery(record.id, record);
        }
        this.update({ enabled: false, status: 'integration_disabled' });
        continue;
      }
      if (record.reason === 'integration_disabled' && record.candidates?.length) {
        record.status = 'queued'; record.reason = null;
        record.itemStates = record.candidates.map(() => ({ status: 'queued', attempts: 0, nextAttemptAt: null, reason: null }));
        await this.store.saveDelivery(record.id, record);
      }
      if (record.status === 'queued' || record.status === 'retry_wait') this.schedule(record.id, Math.max(0, (record.nextAttemptAt || 0) - this.now()));
    }
  }
  async deliver(id) {
    if (this.closed || this.paused || !this.isConfigured() || !this.state.enabled || this.inFlight.has(id)) return;
    this.inFlight.add(id);
    let networkFailed = false;
    try {
      const record = await this.store.getDelivery(id);
      if (!record || record.status !== 'queued' && record.status !== 'retry_wait') return;
      if (!record.candidates?.length || record.candidates.some(x => !x)) {
        await this.store.saveDelivery(id, { ...record, status: 'pending', reason: 'explicit_fields_required' }); return;
      }
      const states = record.itemStates || record.candidates.map(() => ({ status: 'queued', attempts: 0 }));
      for (let i = 0; i < record.candidates.length; i++) {
        const itemState = states[i] || { status: 'queued', attempts: 0 };
        if (!['queued', 'retry_wait'].includes(itemState.status)) continue;
        if (itemState.nextAttemptAt && itemState.nextAttemptAt > this.now()) { this.schedule(id, itemState.nextAttemptAt - this.now()); continue; }
        const payload = record.candidates[i];
        if (this.now() - Date.parse(payload.sourceTimestamp) > 7 * 86400_000) {
          states[i] = { ...itemState, status: 'pending', reason: 'older_than_7_days' }; continue;
        }
        const raw = JSON.stringify(payload);
        if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) {
          states[i] = { ...itemState, status: 'pending', reason: 'payload_limit' }; continue;
        }
        const timestamp = String(Math.floor(this.now() / 1000));
        const signature = createHmac('sha256', this.secret).update(`${timestamp}.${raw}`).digest('hex');
        this.update({
          attempts: this.state.attempts + 1,
          lastAttemptAt: new Date(this.now()).toISOString(),
          status: 'delivering',
        });
        let response;
        try {
          response = await this.fetch(KONG_URL, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/json', 'X-Kong-BlackRoom-Timestamp': timestamp, 'X-Kong-BlackRoom-Signature': `sha256=${signature}` },
          body: raw,
          });
        } catch (error) { networkFailed = true; throw error; }
        if (response.status >= 300 && response.status < 400) {
          this.state.rejected++;
          states[i] = { ...itemState, status: 'pending', reason: 'redirect_rejected' }; continue;
        }
        if (response.status === 200) {
          const body = await response.json().catch(() => ({}));
          const status = body?.status === 'duplicate' ? 'duplicate' : body?.status === 'applied' ? 'applied' : 'pending';
          states[i] = { ...itemState, status, reason: status === 'pending' ? 'unrecognized_receiver_response' : null };
          if (status === 'applied') { this.state.applied++; this.state.delivered++; }
          else if (status === 'duplicate') { this.state.duplicates++; this.state.delivered++; }
          else this.state.rejected++;
        } else if (response.status === 202) {
          this.state.receiverPending++;
          states[i] = { ...itemState, status: 'receiver_pending', reason: 'receiver_review' };
        } else if ([401, 403, 503].includes(response.status)) {
          this.state.rejected++;
          states[i] = { ...itemState, status: 'pending', reason: response.status === 401 ? 'invalid_signature' : response.status === 403 ? 'forbidden_group' : 'integration_disabled' };
          this.update({ enabled: response.status !== 401 && response.status !== 503, status: states[i].reason });
          break;
        } else {
          this.state.rejected++;
          states[i] = await this.retryItem(id, itemState);
          if (states[i].status === 'retry_wait') break;
        }
        record.itemStates = states;
        record.status = this.aggregate(states);
        record.reason = record.status === 'pending' ? (states.find(x => x.reason)?.reason || 'pending_review') : null;
        await this.store.saveDelivery(id, record);
      }
      record.itemStates = states; record.status = this.aggregate(states);
      record.reason = record.status === 'pending' ? (states.find(x => x.reason)?.reason || 'pending_review') : null;
      await this.store.saveDelivery(id, record);
      this.update({ status: record.status });
    } catch (error) {
      if (!networkFailed) { this.emit('storage-error', error); return; }
      this.state.networkFailures++;
      try {
        const record = await this.store.getDelivery(id);
        if (record) {
          const index = (record.itemStates || []).findIndex(x => ['queued', 'retry_wait'].includes(x.status));
          if (index >= 0) {
            record.itemStates[index] = await this.retryItem(id, record.itemStates[index]);
            record.status = 'retry_wait'; await this.store.saveDelivery(id, record);
          }
        }
      } catch (storageError) { this.emit('storage-error', storageError); }
    } finally { this.inFlight.delete(id); }
  }
  aggregate(states) {
    if (states.some(x => x.status === 'retry_wait')) return 'retry_wait';
    if (states.every(x => x.status === 'applied')) return 'applied';
    if (states.every(x => ['applied', 'duplicate'].includes(x.status))) return 'duplicate';
    if (states.every(x => x.status === 'receiver_pending')) return 'receiver_pending';
    if (states.every(x => ['applied', 'duplicate', 'receiver_pending'].includes(x.status)) && states.some(x => x.status === 'receiver_pending')) return 'receiver_pending';
    return 'pending';
  }
  async retryItem(id, itemState) {
    const attempts = (itemState.attempts || 0) + 1;
    if (attempts > RETRY_MS.length) {
      return { ...itemState, attempts, status: 'pending', reason: 'retry_limit_reached' };
    }
    const nextAttemptAt = this.now() + RETRY_MS[attempts - 1];
    this.update({ status: 'retry_wait' }); this.schedule(id, RETRY_MS[attempts - 1]);
    return { ...itemState, attempts, status: 'retry_wait', reason: 'temporary_receiver_failure', nextAttemptAt };
  }
  async overview() {
    const records = await this.store.listDeliveries(1000);
    const counts = {};
    for (const record of records) counts[record.status] = (counts[record.status] || 0) + 1;
    return { ...this.snapshot(), counts };
  }
  schedule(id, delay) {
    if (this.timers.has(id) || this.closed || this.paused) return;
    const timer = setTimeout(() => { this.timers.delete(id); void this.deliver(id); }, delay);
    timer.unref?.(); this.timers.set(id, timer);
  }
  pause() { this.paused = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
  close() { this.closed = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
}
