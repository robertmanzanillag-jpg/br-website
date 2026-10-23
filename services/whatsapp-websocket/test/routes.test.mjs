import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import { EventEmitter } from 'node:events';
import { mountOwnerRoutes } from '../integration.mjs';

test('owner-only QR, CSRF and streamed state work behind real compression', async () => {
  const app = express(); app.use(compression()); app.use(express.json());
  app.use(session({ secret: 'test-only-secret-do-not-use-in-production', resave: false, saveUninitialized: false }));
  // Test fixture only; production receives its existing session, never this route.
  app.post('/test-session', (req, res) => { req.session.user = { id: req.body.id }; res.sendStatus(204); });
  const reader = new EventEmitter(); let started = 0;
  reader.snapshot = () => ({ state: 'stopped', received: 4, saved: 2, discarded: 2, lastConnectionAt: '2026-01-01T00:00:00.000Z', storageFailure: { code: '08006', operation: 'save' } }); reader.pairingQr = () => 'test-sensitive-qr';
  reader.start = async () => { started++; }; reader.stop = async () => {};
  reader.listInbox = async () => ({ items: [{ group: 'SPACE TABLES', text: 'test-only' }], truncated: false });
  mountOwnerRoutes(app, reader, { isOwner: user => user?.id === 'owner' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${root}/api/admin/whatsapp-websocket`;
  try {
    assert.equal((await fetch(`${endpoint}/qr`)).status, 403);
    assert.equal((await fetch(`${endpoint}/panel`)).status, 403);
    assert.equal((await fetch(`${endpoint}/qr.svg`)).status, 403);
    assert.equal((await fetch(`${endpoint}/inbox`)).status, 403);
    const login = await fetch(`${root}/test-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'owner' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const status = await fetch(`${endpoint}/status`, { headers: { cookie } });
    assert.match(status.headers.get('cache-control'), /no-store/);
    const statusData = await status.json();
    const { csrf } = statusData;
    assert.equal(statusData.storageFailure.code, '08006');
    assert.equal(JSON.stringify(statusData).includes('sensitive SQL'), false);
    const inbox = await fetch(`${endpoint}/inbox`, { headers: { cookie } });
    assert.match(inbox.headers.get('cache-control'), /no-store/);
    assert.deepEqual((await inbox.json()).items.map(item => item.group), ['SPACE TABLES']);
    assert.equal((await fetch(`${endpoint}/start`, { method: 'POST', headers: { cookie } })).status, 403);
    assert.equal((await fetch(`${endpoint}/start`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf } })).status, 202);
    assert.equal(started, 1);
    assert.equal((await (await fetch(`${endpoint}/qr`, { headers: { cookie } })).json()).qr, 'test-sensitive-qr');
    const svg = await fetch(`${endpoint}/qr.svg`, { headers: { cookie } });
    assert.match(svg.headers.get('cache-control'), /no-store/);
    assert.match(await svg.text(), /<svg/);
    const panel = await (await fetch(`${endpoint}/panel`, { headers: { cookie } })).text();
    assert.match(panel, /WhatsApp en la nube/); assert.match(panel, /Última conexión/); assert.match(panel, /descar.*data/); assert.equal(panel.includes('__API_PREFIX__'), false);
    const abort = new AbortController();
    const stream = await fetch(`${endpoint}/events`, { headers: { cookie, 'Accept-Encoding': 'gzip' }, signal: abort.signal });
    const output = stream.body.getReader();
    assert.match(new TextDecoder().decode((await output.read()).value), /stopped/);
    reader.emit('status', { state: 'reading' });
    const next = await Promise.race([output.read(), new Promise((_, reject) => setTimeout(() => reject(Error('buffered SSE')), 2000).unref())]);
    assert.match(new TextDecoder().decode(next.value), /reading/); abort.abort();
    const other = await fetch(`${root}/test-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'admin-but-not-owner' }) });
    assert.equal((await fetch(`${endpoint}/qr`, { headers: { cookie: other.headers.get('set-cookie').split(';')[0] } })).status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
