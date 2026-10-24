import { createHash, createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const KONG_URL = 'https://kongnightlife.com/api/integrations/black-room/table-price-updates';
const RETRY_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const GROUPS = new Set(['Promoters 🖤👾🖤', 'LIV MIAMI', 'SPACE TABLES', 'STUDIO 60 PROMO']);
const hash = value => createHash('sha256').update(value).digest('hex');
const PENDING_REASONS = new Set([
  'image_unidentified', 'ambiguous_date', 'incomplete_price', 'contradictory_fields',
  'announcement_without_price', 'ticket_not_table_price', 'older_than_7_days',
  'no_text_evidence', 'integration_disabled', 'source_conflict',
  'explicit_fields_required', 'flyer_requires_review',
]);

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeLabel = value => normalize(value).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
const ALIASES = new Map();
for (const [field, labels] of Object.entries({
  venue: ['venue', 'venue name', 'club', 'place', 'lugar', 'local', 'discoteca', 'nombre del lugar'],
  date: ['date', 'event date', 'fecha', 'fecha del evento', 'dia del evento'],
  table: ['table', 'table type', 'mesa', 'tipo de mesa', 'tipo mesa'],
  minimum: ['minimum spend', 'min spend', 'minimum spend per table', 'min spend per table',
    'minimum per table', 'table minimum', 'minimum table spend', 'minimo', 'minimo de mesa',
    'minimo por mesa', 'minimo de consumo', 'consumo minimo', 'precio de mesa', 'precio minimo'],
  currency: ['currency', 'moneda', 'divisa'],
  conditions: ['conditions', 'terms', 'condiciones', 'terminos', 'requisitos', 'reglas'],
})) for (const label of labels) ALIASES.set(normalizeLabel(label), field);

function readFields(block) {
  const values = new Map();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:=]{1,48}?)\s*[:=]\s*(.*?)\s*$/);
    if (!match) continue;
    const key = ALIASES.get(normalizeLabel(match[1]));
    if (!key || !match[2]) continue;
    const entries = values.get(key) || [];
    entries.push(match[2].trim());
    values.set(key, entries);
  }
  for (const entries of values.values()) {
    if (new Set(entries.map(normalize)).size > 1) return { values, reason: 'contradictory_fields' };
  }
  return { values, reason: null };
}

function one(fields, key) { return fields.get(key)?.[0] || null; }

const MONTHS = new Map([
  ['january',1],['jan',1],['enero',1],['february',2],['feb',2],['febrero',2],
  ['march',3],['mar',3],['marzo',3],['april',4],['apr',4],['abril',4],
  ['may',5],['mayo',5],['june',6],['jun',6],['junio',6],['july',7],['jul',7],['julio',7],
  ['august',8],['aug',8],['agosto',8],['september',9],['sep',9],['sept',9],['septiembre',9],
  ['october',10],['oct',10],['octubre',10],['november',11],['nov',11],['noviembre',11],
  ['december',12],['dec',12],['diciembre',12],
]);

function dateResult(raw) {
  const value = normalize(raw).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let year, month, day;
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) {
      const first = Number(match[1]), second = Number(match[2]);
      if (first <= 12 && second <= 12) return { reason: 'ambiguous_date' };
      if (first > 12 && second <= 12) { day = first; month = second; year = Number(match[3]); }
      else if (second > 12 && first <= 12) { month = first; day = second; year = Number(match[3]); }
      else return { reason: 'ambiguous_date' };
    } else {
      const words = value.replace(/\bde\b/g, ' ').split(/\s+/).filter(Boolean);
      if (words.length === 3 && /^\d{1,2}$/.test(words[0]) && /^\d{4}$/.test(words[2]) && MONTHS.has(words[1])) {
        day = Number(words[0]); month = MONTHS.get(words[1]); year = Number(words[2]);
      } else if (words.length === 3 && MONTHS.has(words[0]) && /^\d{1,2}$/.test(words[1]) && /^\d{4}$/.test(words[2])) {
        month = MONTHS.get(words[0]); day = Number(words[1]); year = Number(words[2]);
      } else return { reason: 'ambiguous_date' };
    }
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { reason: 'ambiguous_date' };
  }
  return { value: parsed.toISOString().slice(0, 10) };
}

function explicitCurrency(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(value)) return value;
  if (/^US\s*DOLLARS?$/.test(value)) return 'USD';
  if (/^EUROS?$/.test(value)) return 'EUR';
  if (/^POUNDS?(?:\s+STERLING)?$/.test(value)) return 'GBP';
  return null;
}

function amountResult(raw, currencyField) {
  let text = String(raw || '').trim().toUpperCase();
  let explicit = explicitCurrency(currencyField);
  const prefixes = [['US$', 'USD'], ['CA$', 'CAD'], ['AU$', 'AUD'], ['NZ$', 'NZD'], ['€', 'EUR'], ['£', 'GBP']];
  for (const [symbol, code] of prefixes) {
    if (text.startsWith(symbol)) { text = text.slice(symbol.length).trim(); if (explicit && explicit !== code) return { reason: 'contradictory_fields' }; explicit = code; break; }
  }
  const codeMatch = text.match(/^(USD|CAD|AUD|NZD|EUR|GBP|MXN)\s+(.+)$/) || text.match(/^(.+?)\s+(USD|CAD|AUD|NZD|EUR|GBP|MXN)$/);
  if (codeMatch) {
    const code = codeMatch[1].length === 3 ? codeMatch[1] : codeMatch[2];
    text = codeMatch[1].length === 3 ? codeMatch[2] : codeMatch[1];
    if (explicit && explicit !== code) return { reason: 'contradictory_fields' };
    explicit = code;
  }
  if (text.startsWith('$')) text = text.slice(1).trim();
  if (!explicit || !/^[A-Z]{3}$/.test(explicit)) return { reason: 'incomplete_price' };
  let normalizedAmount;
  if (/^\d+$/.test(text)) normalizedAmount = text;
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text)) normalizedAmount = text.replaceAll(',', '');
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) normalizedAmount = text.replaceAll('.', '').replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(text)) normalizedAmount = text;
  else if (/^\d+,\d{1,2}$/.test(text)) normalizedAmount = text.replace(',', '.');
  else return { reason: 'incomplete_price' };
  return { amount: normalizedAmount, currency: explicit };
}

function parseQuote(block, message, group) {
  const { values, reason: fieldReason } = readFields(block);
  if (fieldReason) return { reason: fieldReason };
  const venueName = one(values, 'venue');
  const dateRaw = one(values, 'date');
  const tableType = one(values, 'table');
  const spendRaw = one(values, 'minimum');
  const currencyRaw = one(values, 'currency');
  const conditions = one(values, 'conditions');
  const ticketMention = /\b(tickets?|entradas?|admission|cover charge)\b/i.test(block);
  if (ticketMention && (!tableType || /\b(ticket|entrada|admission)\b/i.test(tableType))) return { reason: 'ticket_not_table_price' };
  const parsedDate = dateRaw ? dateResult(dateRaw) : { reason: null };
  if (parsedDate.reason) return parsedDate;
  if (!spendRaw) return { reason: ticketMention ? 'ticket_not_table_price' : 'announcement_without_price' };
  if (!venueName || !parsedDate.value || !tableType || !conditions
    || /\b(ticket|entrada|admission)\b/i.test(tableType)) return { reason: 'incomplete_price' };
  const parsedAmount = amountResult(spendRaw, currencyRaw);
  if (parsedAmount.reason) return parsedAmount;
  if (!Number.isSafeInteger(message.sentAt) || message.sentAt <= 0) return { reason: 'incomplete_price' };
  return {
    sourceGroup: group,
    sourceMessageId: message.id,
    sourceTimestamp: new Date(message.sentAt * 1000).toISOString(),
    venueName, eventDate: parsedDate.value, tableType, priceKind: 'minimum_spend',
    minimumSpend: parsedAmount.amount, currency: parsedAmount.currency, minimumSpendDisplay: spendRaw.trim(),
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
  const complete = parsed.length > 0 && parsed.every(result => result && !result.reason);
  const status = tooOld || !complete ? 'pending' : 'queued';
  const firstReason = parsed.find(result => result?.reason)?.reason;
  const reason = tooOld ? 'older_than_7_days'
    : !text ? (message.media ? 'image_unidentified' : 'no_text_evidence')
      : !complete ? (message.media && firstReason === 'announcement_without_price' ? 'image_unidentified' : firstReason || 'incomplete_price') : null;
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
    this.pendingById = new Map();
    this.state = {
      enabled: this.isConfigured(), hostReady: this.hostReady, secretValid: this.validSecret(),
      status: this.isConfigured() ? 'ready' : 'integration_disabled',
      delivered: 0, pending: 0, attempts: 0, applied: 0, duplicates: 0,
      receiverPending: 0, rejected: 0, networkFailures: 0, lastAttemptAt: null, pendingReasons: {},
    };
  }
  validSecret() { return typeof this.secret === 'string' && this.secret.length >= 32 && this.secret.trim() === this.secret; }
  isConfigured() { return this.hostReady && this.validSecret(); }
  snapshot() { return { ...this.state, pendingReasons: { ...this.state.pendingReasons } }; }
  trackPending(id, status, reason) {
    this.pendingById.delete(id);
    if (status === 'pending' && PENDING_REASONS.has(reason)) this.pendingById.set(id, reason);
    const counts = {};
    for (const code of this.pendingById.values()) counts[code] = (counts[code] || 0) + 1;
    this.state.pendingReasons = counts;
  }
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
        this.trackPending(next.id, conflict.status, conflict.reason);
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
    this.trackPending(next.id, next.status, next.reason);
    this.update({ status: !this.isConfigured() ? 'integration_disabled'
      : next.status === 'pending' ? 'pending_review' : this.state.status });
    if (!this.isConfigured() || !this.state.enabled) {
      return next;
    }
    if (next.status === 'queued') void this.deliver(next.id);
    else this.state.pending++;
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
      const previous = known.get(next.id);
      if (previous) {
        // Re-evaluate only still-pending, unchanged saved sources with the current
        // deterministic parser. Never overwrite a confirmed receiver outcome.
        if (previous.status !== 'pending' || previous.fingerprint !== next.fingerprint) continue;
      }
      if (!this.isConfigured() && next.candidates.length) {
        next.status = 'pending'; next.reason = 'integration_disabled';
      }
      await this.store.saveDelivery(next.id, next);
      known.set(next.id, next);
    }
    this.pendingById.clear();
    for (const record of known.values()) this.trackPending(record.id, record.status, record.reason);
    this.update({ enabled: this.isConfigured(), status: this.isConfigured() ? 'ready' : 'integration_disabled' });
    for (const record of known.values()) {
      if (['applied', 'duplicate', 'receiver_pending', 'source_conflict'].includes(record.status)) continue;
      if (!this.isConfigured()) {
        if (['queued', 'retry_wait'].includes(record.status)) {
          record.status = 'pending'; record.reason = 'integration_disabled';
          await this.store.saveDelivery(record.id, record);
          this.trackPending(record.id, record.status, record.reason);
        }
        this.update({ enabled: false, status: 'integration_disabled' });
        continue;
      }
      if (record.reason === 'integration_disabled' && record.candidates?.length) {
        record.status = 'queued'; record.reason = null;
        record.itemStates = record.candidates.map(() => ({ status: 'queued', attempts: 0, nextAttemptAt: null, reason: null }));
        await this.store.saveDelivery(record.id, record);
        this.trackPending(record.id, record.status, record.reason);
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
        this.trackPending(id, record.status, record.reason);
      }
      record.itemStates = states; record.status = this.aggregate(states);
      record.reason = record.status === 'pending' ? (states.find(x => x.reason)?.reason || 'pending_review') : null;
      await this.store.saveDelivery(id, record);
      this.trackPending(id, record.status, record.reason);
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
