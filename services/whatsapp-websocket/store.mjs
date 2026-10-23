import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { BufferJSON } from './baileys-runtime.mjs';

const TRANSIENT_PG_CODES = new Set([
  '08000', '08001', '08003', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03', '53300',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
  'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN',
]);
const SAFE_PG_CODES = new Set([
  ...TRANSIENT_PG_CODES, '28P01', '3D000', '42501', '42P01', '57014',
  '22001', '23505', '23503', '23514',
]);
const SAFE_DB_OPERATIONS = new Set(['connect', 'lease', 'schema', 'load', 'transaction', 'budget', 'save', 'commit', 'rollback', 'list', 'unlock']);

export function isTransientDatabaseError(error) {
  return TRANSIENT_PG_CODES.has(error?.code);
}

export function safeDatabaseDiagnostic(error, operation) {
  return {
    code: SAFE_PG_CODES.has(error?.code) ? error.code : 'unclassified',
    operation: SAFE_DB_OPERATIONS.has(operation) ? operation : 'query',
  };
}

function storageError(error, operation, onStorageFailure) {
  const diagnostic = safeDatabaseDiagnostic(error, operation);
  try { onStorageFailure?.(diagnostic); } catch {}
  if (isTransientDatabaseError(error)) {
    return Object.assign(new Error('database_unavailable'), {
      code: 'database_unavailable', diagnosticCode: diagnostic.code, operation: diagnostic.operation,
    });
  }
  return Object.assign(new Error('storage_operation_failed'), {
    code: diagnostic.code, diagnosticCode: diagnostic.code, operation: diagnostic.operation,
  });
}

export function codec(base64Key) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(base64Key || '')) throw new Error('invalid_encryption_key');
  const key = Buffer.from(base64Key, 'base64');
  return {
    seal(value, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const payload = Buffer.from(JSON.stringify(value, BufferJSON.replacer));
      if (payload.length > 8 * 1024 * 1024) throw new Error('record_limit');
      return Buffer.concat([iv, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
    },
    open(data, context) {
      try {
        const bytes = Buffer.from(data);
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(bytes.subarray(-16));
        return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(), BufferJSON.reviver);
      } catch { throw new Error('encrypted_state_unreadable'); }
    },
  };
}

// One dedicated pg Client owns the lease. Callers must not give this client to
// unrelated queries; transactions and the advisory lock belong to this reader.
export class PostgresStore {
  constructor(client, key, { maxStoredBytes = 128 * 1024 * 1024, maxMonthlyBytes = 5 * 1024 ** 3 } = {}) {
    this.db = client; this.crypt = codec(key);
    this.maxStoredBytes = maxStoredBytes; this.maxMonthlyBytes = maxMonthlyBytes;
    this.tail = Promise.resolve(); this.locked = false; this.onStorageFailure = null;
  }
  async acquire() {
    const result = await this.query('SELECT pg_try_advisory_lock(1263488831,20261024) AS acquired', undefined, 'lease');
    if (!result.rows[0]?.acquired) throw new Error('reader_already_running');
    this.locked = true;
    await this.query(`CREATE TABLE IF NOT EXISTS br_wa_ws_state (
      id text PRIMARY KEY, payload bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS br_wa_ws_budget (
      month date PRIMARY KEY, bytes bigint NOT NULL DEFAULT 0);`, undefined, 'schema');
  }
  serial(task) {
    const next = this.tail.then(task);
    this.tail = next.catch(() => {});
    return next;
  }
  async query(sql, params, operation = 'query') {
    try {
      return await this.db.query(sql, params);
    } catch (error) {
      throw storageError(error, operation, this.onStorageFailure);
    }
  }
  async load(id) {
    if (!this.locked) throw new Error('lease_required');
    return this.serial(async () => {
      const result = await this.query('SELECT payload FROM br_wa_ws_state WHERE id=$1', [id], 'load');
      return result.rows.length ? this.crypt.open(result.rows[0].payload, id) : null;
    });
  }
  async save(id, value, { insertOnly = false } = {}) {
    if (!this.locked) throw new Error('lease_required');
    const data = this.crypt.seal(value, id);
    return this.serial(async () => {
      await this.query('BEGIN', undefined, 'transaction');
      try {
        const previous = await this.query('SELECT octet_length(payload) AS size FROM br_wa_ws_state WHERE id=$1', [id], 'budget');
        if (insertOnly && previous.rows.length) { await this.query('COMMIT', undefined, 'commit'); return false; }
        const size = Number((await this.query('SELECT COALESCE(sum(octet_length(payload)),0) AS size FROM br_wa_ws_state', undefined, 'budget')).rows[0].size);
        await this.query("INSERT INTO br_wa_ws_budget(month) VALUES(date_trunc('month',now())::date) ON CONFLICT DO NOTHING", undefined, 'budget');
        const budget = await this.query("SELECT bytes FROM br_wa_ws_budget WHERE month=date_trunc('month',now())::date FOR UPDATE", undefined, 'budget');
        if (size - Number(previous.rows[0]?.size || 0) + data.length > this.maxStoredBytes || Number(budget.rows[0].bytes) + data.length > this.maxMonthlyBytes) throw new Error('storage_limit');
        await this.query(`INSERT INTO br_wa_ws_state(id,payload) VALUES($1,$2)
          ON CONFLICT(id) DO UPDATE SET payload=$2,updated_at=now()`, [id, data], 'save');
        await this.query("UPDATE br_wa_ws_budget SET bytes=bytes+$1 WHERE month=date_trunc('month',now())::date", [data.length], 'budget');
        await this.query('COMMIT', undefined, 'commit'); return true;
      } catch (error) { await this.db.query('ROLLBACK').catch(() => {}); throw error; }
    });
  }
  saveMessage(message) {
    const revision = createHash('sha256').update(JSON.stringify([message.text, message.media])).digest('hex');
    const groupHash = createHash('sha256').update(message.groupId).digest('hex');
    const messageHash = createHash('sha256').update(`${message.groupId}:${message.id}:${revision}`).digest('hex');
    return this.save(`inbox:${groupHash}:${messageHash}`, { ...message, revision, state: 'pending_review' }, { insertOnly: true });
  }
  getDelivery(id) { return this.load(id); }
  saveDelivery(id, record) { return this.save(id, record); }
  async listDeliveries(limit = 1000) {
    const rows = await this.serial(async () => this.query(
      "SELECT id,payload FROM br_wa_ws_state WHERE id LIKE 'kong:%' ORDER BY updated_at ASC LIMIT $1",
      [Math.max(1, Math.min(5000, Number(limit) || 1000))], 'list'
    ));
    return rows.rows.map(row => this.crypt.open(row.payload, row.id));
  }
  async listMessages(groupIds, limit = 100) {
    if (!Array.isArray(groupIds) || !groupIds.length) return [];
    const patterns = groupIds.map(groupId => `inbox:${createHash('sha256').update(groupId).digest('hex')}:%`);
    const rows = await this.serial(async () => this.query(
      "SELECT id,payload FROM br_wa_ws_state WHERE id LIKE ANY($1::text[]) OR id ~ '^inbox:[a-f0-9]{64}$' ORDER BY updated_at DESC LIMIT $2",
      [patterns, Math.max(1, Math.min(5000, Number(limit) || 100))], 'list'
    ));
    const allowed = new Set(groupIds);
    return rows.rows.map(row => this.crypt.open(row.payload, row.id)).filter(item => allowed.has(item.groupId));
  }
  async release() {
    await this.tail;
    if (this.locked) await this.db.query('SELECT pg_advisory_unlock(1263488831,20261024)').catch(() => {});
    this.locked = false;
  }
}
