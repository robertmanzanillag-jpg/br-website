import pg from 'pg';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PostgresStore } from './store.mjs';
import { WebSocketReader } from './reader.mjs';
import QRCode from 'qrcode';
import { readFileSync } from 'node:fs';

// Integrate ONLY after the existing Chromium reader is stopped/disabled.
// The host must already have express.json and its existing owner session middleware.
// Never authorize using a query token or a broad isAdmin flag.
export function mountOwnerRoutes(app, reader, { isOwner, prefix = '/api/admin/whatsapp-websocket', publicPrefix = prefix }) {
  if (typeof isOwner !== 'function') throw new Error('owner_guard_required');
  if ((prefix !== '' && !/^\/[a-z0-9/-]+$/.test(prefix)) || !/^\/[a-z0-9/-]+$/.test(publicPrefix)) throw new Error('invalid_route_prefix');
  app.use(prefix || '/', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store, no-transform');
    if (!req.session || !isOwner(req.session.user)) return res.sendStatus(403);
    if (!req.session.whatsappWebsocketCsrf) req.session.whatsappWebsocketCsrf = randomBytes(32).toString('hex');
    if (req.method !== 'GET') {
      const expected = Buffer.from(req.session.whatsappWebsocketCsrf);
      const supplied = Buffer.from(req.get('X-CSRF-Token') || '');
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.sendStatus(403);
    }
    next();
  });
  app.get(`${prefix}/status`, (req, res) => res.json({ ...reader.snapshot(), csrf: req.session.whatsappWebsocketCsrf }));
  app.get(`${prefix}/panel`, (req, res) => {
    res.type('html').send(readFileSync(new URL('./panel.html', import.meta.url), 'utf8').replaceAll('__API_PREFIX__', publicPrefix));
  });
  app.get(`${prefix}/qr.svg`, async (req, res) => {
    const qr = reader.pairingQr();
    if (!qr) return res.sendStatus(404);
    try { res.type('svg').send(await QRCode.toString(qr, { type: 'svg', margin: 3 })); }
    catch { res.sendStatus(503); }
  });
  app.get(`${prefix}/qr`, (req, res) => {
    const qr = reader.pairingQr();
    if (!qr) return res.sendStatus(404);
    // Private frontend renders this in memory; no URL, localStorage, analytics or logs.
    res.json({ qr });
  });
  app.post(`${prefix}/start`, (req, res) => {
    void reader.start();
    res.status(202).json({ accepted: true });
  });
  app.post(`${prefix}/stop`, async (req, res) => {
    await reader.stop(); res.json(reader.snapshot());
  });
  app.get(`${prefix}/events`, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = state => { res.write(`data: ${JSON.stringify(state)}\n\n`); res.flush?.(); };
    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); res.flush?.(); }, 20000);
    const expire = setTimeout(() => res.end(), 5 * 60 * 1000);
    send(reader.snapshot()); reader.on('status', send);
    req.on('close', () => { clearInterval(heartbeat); clearTimeout(expire); reader.off('status', send); });
  });
}

export async function createProductionReader({ databaseUrl, encryptionKey, legacyReaderDisabled }) {
  if (legacyReaderDisabled !== true) throw new Error('disable_legacy_reader_first');
  const db = new pg.Client({ connectionString: databaseUrl, application_name: 'br-whatsapp-websocket', connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  const store = new PostgresStore(db, encryptionKey);
  await db.connect();
  const reader = new WebSocketReader({ store });
  db.on('error', () => { void reader.stop('database_unavailable'); });
  return {
    reader,
    async shutdown() { await reader.stop(); await db.end(); },
  };
}
