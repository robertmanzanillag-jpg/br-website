import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Client } from '@replit/object-storage';

const PREFIX = 'private/whatsapp-link';
const SESSION_OBJECT = `${PREFIX}/session-v1.enc`;
const METER_OBJECT = `${PREFIX}/usage-v1.json`;
const MAGIC = Buffer.from('BRWA01');
const MONTHLY_TRANSFER_LIMIT = 10 * 1024 ** 3;
const MAX_SESSION_BYTES = 128 * 1024 ** 2;
const MAX_STORAGE_BYTES = 256 * 1024 ** 2;
const CONTROL_TRANSFER_RESERVE = 16 * 1024;
const METER_VERSION = 1;

export class WhatsAppStoreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'WhatsAppStoreError';
    this.code = code;
  }
}

export function encryptSessionArchive(archive, base64Key) {
  const key = decodeKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(archive), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptSessionArchive(envelope, base64Key) {
  const key = decodeKey(base64Key);
  const headerLength = MAGIC.length + 12 + 16;
  if (!Buffer.isBuffer(envelope) || envelope.length < headerLength
      || !envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new WhatsAppStoreError('WA_BACKUP_CORRUPT');
  }
  try {
    const ivStart = MAGIC.length;
    const tagStart = ivStart + 12;
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(ivStart, tagStart));
    decipher.setAuthTag(envelope.subarray(tagStart, headerLength));
    return Buffer.concat([decipher.update(envelope.subarray(headerLength)), decipher.final()]);
  } catch {
    throw new WhatsAppStoreError('WA_BACKUP_CORRUPT');
  }
}

function decodeKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new WhatsAppStoreError('WA_KEY_MISSING', 'A dedicated 32-byte base64 key is required.');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new WhatsAppStoreError('WA_KEY_INVALID');
  return key;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function resultValue(result, operation) {
  if (result?.ok) return result.value;
  if (result?.error?.statusCode === 404) return null;
  throw new WhatsAppStoreError('WA_STORAGE_ERROR', `Object Storage ${operation} failed.`);
}

export class WhatsAppRemoteSessionStore {
  constructor({
    storage = new Client(),
    encryptionKey = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY,
    dataPath,
    onLimit = () => {},
    transferLimitBytes = MONTHLY_TRANSFER_LIMIT,
    sessionLimitBytes = MAX_SESSION_BYTES,
    storageLimitBytes = MAX_STORAGE_BYTES
  } = {}) {
    this.storage = storage;
    this.encryptionKey = encryptionKey;
    this.dataPath = dataPath;
    this.onLimit = onLimit;
    this.transferLimitBytes = transferLimitBytes;
    this.sessionLimitBytes = sessionLimitBytes;
    this.storageLimitBytes = storageLimitBytes;
    this.meter = null;
    this.meterLock = Promise.resolve();
    this.pendingArchive = null;
  }

  get isConfigured() {
    try {
      decodeKey(this.encryptionKey);
      return true;
    } catch {
      return false;
    }
  }

  snapshot() {
    return {
      month: this.meter?.month ?? currentMonth(),
      transferBytes: this.meter?.transferBytes ?? 0,
      transferLimitBytes: this.transferLimitBytes,
      storedBytes: this.meter?.storedBytes ?? 0,
      storageLimitBytes: this.storageLimitBytes,
      backupIntervalHours: 6,
      maxSessionBytes: this.sessionLimitBytes
    };
  }

  async withMeterLock(action) {
    const pending = this.meterLock.then(action, action);
    this.meterLock = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async loadMeter() {
    if (this.meter) return this.meter;
    const exists = resultValue(await this.storage.exists(METER_OBJECT), 'meter check');
    if (exists) {
      const [bytes] = resultValue(await this.storage.downloadAsBytes(METER_OBJECT), 'meter read');
      try {
        const parsed = JSON.parse(bytes.toString('utf8'));
        if (parsed.version !== METER_VERSION || typeof parsed.month !== 'string'
            || !Number.isSafeInteger(parsed.transferBytes) || !Number.isSafeInteger(parsed.storedBytes)) {
          throw new Error('invalid meter');
        }
        this.meter = parsed.month === currentMonth()
          ? parsed
          : { version: METER_VERSION, month: currentMonth(), transferBytes: 0, storedBytes: parsed.storedBytes };
      } catch {
        throw new WhatsAppStoreError('WA_METER_CORRUPT');
      }
    } else {
      this.meter = { version: METER_VERSION, month: currentMonth(), transferBytes: 0, storedBytes: 0 };
    }
    return this.meter;
  }

  async persistMeter() {
    const bytes = Buffer.from(JSON.stringify(this.meter));
    resultValue(await this.storage.uploadFromBytes(METER_OBJECT, bytes), 'meter write');
  }

  async reserveTransfer(bytes) {
    return this.withMeterLock(async () => {
      const meter = await this.loadMeter();
      const next = meter.transferBytes + bytes + CONTROL_TRANSFER_RESERVE;
      if (next > this.transferLimitBytes) {
        const error = new WhatsAppStoreError('WA_BUDGET_LIMIT');
        this.onLimit(error);
        throw error;
      }
      meter.transferBytes = next;
      await this.persistMeter();
    });
  }

  async sessionExists({ session }) {
    if (!this.isConfigured) throw new WhatsAppStoreError('WA_KEY_MISSING');
    const exists = resultValue(await this.storage.exists(SESSION_OBJECT), 'session check');
    if (!exists) return false;
    const meter = await this.loadMeter();
    if (!meter.storedBytes || meter.storedBytes > this.sessionLimitBytes) {
      throw new WhatsAppStoreError('WA_METER_CORRUPT');
    }
    return true;
  }

  async extract({ session, path: destination }) {
    if (!this.isConfigured) throw new WhatsAppStoreError('WA_KEY_MISSING');
    const meter = await this.loadMeter();
    if (meter.storedBytes > this.sessionLimitBytes) throw new WhatsAppStoreError('WA_STORAGE_LIMIT');
    await this.reserveTransfer(meter.storedBytes);
    const [encrypted] = resultValue(await this.storage.downloadAsBytes(SESSION_OBJECT), 'session restore');
    if (encrypted.length !== meter.storedBytes) throw new WhatsAppStoreError('WA_BACKUP_CORRUPT');
    const archive = decryptSessionArchive(encrypted, this.encryptionKey);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.writeFile(destination, archive, { mode: 0o600 });
  }

  async save({ session }) {
    if (!this.isConfigured) throw new WhatsAppStoreError('WA_KEY_MISSING');
    const archivePath = path.join(this.dataPath, `${session}.zip`);
    const archive = await fs.readFile(archivePath);
    if (archive.length > this.sessionLimitBytes) {
      const error = new WhatsAppStoreError('WA_STORAGE_LIMIT');
      this.onLimit(error);
      throw error;
    }
    const encrypted = encryptSessionArchive(archive, this.encryptionKey);
    if (encrypted.length + 16 * 1024 > this.storageLimitBytes) {
      const error = new WhatsAppStoreError('WA_STORAGE_LIMIT');
      this.onLimit(error);
      throw error;
    }
    await this.reserveTransfer(encrypted.length);
    resultValue(await this.storage.uploadFromBytes(SESSION_OBJECT, encrypted), 'session backup');
    const meter = await this.loadMeter();
    meter.storedBytes = encrypted.length;
    await this.persistMeter();
  }

  async delete({ session }) {
    const result = await this.storage.delete(SESSION_OBJECT);
    resultValue(result, 'session delete');
    const meter = await this.loadMeter();
    meter.storedBytes = 0;
    await this.persistMeter();
  }
}
