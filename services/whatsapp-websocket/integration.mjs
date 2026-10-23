import pg from 'pg';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PostgresStore, isTransientDatabaseError, safeDatabaseDiagnostic } from './store.mjs';
import { WebSocketReader } from './reader.mjs';
import { KongDelivery } from './kong-delivery.mjs';
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
  app.get(`${prefix}/inbox`, async (req, res) => {
    try { res.json(await reader.listInbox(100)); }
    catch { res.status(503).json({ error: 'inbox_unavailable' }); }
  });
  app.get(`${prefix}/delivery-status`, async (req, res) => {
    try { res.json(await reader.deliveryOverview()); }
    catch { res.status(503).json({ error: 'delivery_status_unavailable' }); }
  });
  app.get(`${prefix}/panel`, (req, res) => {
    res.type('html').send(readFileSync(new URL('./panel.html', import.meta.url), 'utf8').replaceAll('__API_PREFIX__', publicPrefix));
  });
  app.get(`${prefix}/qr.svg`, async (req, res) => {
    const qr = reader.pairingQr();
    if (!qr) return res.sendStatus(404);
    try { res.type('svg').send(await QRCode.toString(qr, { type: 'svg', margin: 4 })); }
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
    const send = state => { res.write(`data: ${JSON.stringify({ ...state, delivery: reader.deliverySnapshot?.() || { enabled: false, status: 'not_started' } })}\n\n`); res.flush?.(); };
    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); res.flush?.(); }, 20000);
    const expire = setTimeout(() => res.end(), 5 * 60 * 1000);
    send(reader.snapshot()); reader.on('status', send); reader.on('delivery-status', send);
    req.on('close', () => { clearInterval(heartbeat); clearTimeout(expire); reader.off('status', send); reader.off('delivery-status', send); });
  });
}

export async function createProductionReader({ databaseUrl, encryptionKey, legacyReaderDisabled }) {
  if (legacyReaderDisabled !== true) throw new Error('disable_legacy_reader_first');
  const db = new pg.Client({ connectionString: databaseUrl, application_name: 'br-whatsapp-websocket', connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  const store = new PostgresStore(db, encryptionKey);
  try {
    await db.connect();
  } catch (error) {
    await db.end().catch(() => {});
    const diagnostic = safeDatabaseDiagnostic(error, 'connect');
    throw Object.assign(new Error(isTransientDatabaseError(error) ? 'database_unavailable' : 'storage_operation_failed'), { diagnostic });
  }
  const delivery = new KongDelivery({ store });
  const reader = new WebSocketReader({ store, delivery });
  store.onStorageFailure = diagnostic => reader.recordStorageFailure(diagnostic);
  db.on('error', error => {
    const diagnostic = safeDatabaseDiagnostic(error, 'connect');
    reader.recordStorageFailure(diagnostic);
    void reader.stop(isTransientDatabaseError(error) ? 'database_unavailable' : 'processing_failed');
  });
  return {
    reader,
    async shutdown() { delivery.close(); await reader.stop(); await db.end(); },
  };
}
