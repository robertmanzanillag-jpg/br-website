import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createWhatsAppLinkSystem, isWhatsAppLinkOwner } from './whatsapp-link.js';

class FakeClient extends EventEmitter {
  calls = [];
  async initialize() {
    this.calls.push('initialize');
    this.emit('qr', 'service-client-qr');
  }
  async destroy() {
    this.calls.push('destroy');
  }
  async getChats() {
    this.calls.push('getChats');
    throw new Error('Chat access must not happen during linking');
  }
  async sendMessage() {
    this.calls.push('sendMessage');
    throw new Error('Outbound messaging is forbidden');
  }
}

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function makeApp(system) {
  const app = express();
  const sessions = new Map();
  app.use((req, res, next) => {
    const email = req.get('x-test-user');
    if (!email) {
      req.session = {};
    } else {
      if (!sessions.has(email)) sessions.set(email, { user: { email } });
      req.session = sessions.get(email);
    }
    next();
  });
  app.use('/api/admin/whatsapp-link', system.apiRouter);
  app.use('/admin/whatsapp-link', system.pageRouter);
  return app;
}

test('owner check accepts only the existing owner identity', () => {
  assert.equal(isWhatsAppLinkOwner({ email: 'robert.manzanillag@gmail.com' }), true);
  assert.equal(isWhatsAppLinkOwner({ email: 'someone-else@example.com', isAdmin: true }), false);
  assert.equal(isWhatsAppLinkOwner(undefined), false);
});

test('linking page and endpoints are private; no client starts before owner action', async () => {
  const clients = [];
  const system = createWhatsAppLinkSystem({
    clientFactory: () => {
      const client = new FakeClient();
      clients.push(client);
      return client;
    },
    qrEncoder: async value => `data:image/png;base64,${Buffer.from(value).toString('base64')}`
  });
  const app = makeApp(system);

  assert.equal(system.controller.snapshot().state, 'idle');
  assert.equal(clients.length, 0);

  await withServer(app, async base => {
    const deniedPage = await fetch(`${base}/admin/whatsapp-link`);
    assert.equal(deniedPage.status, 401);
    const deniedStatus = await fetch(`${base}/api/admin/whatsapp-link/status`);
    assert.equal(deniedStatus.status, 401);

    const nonOwnerPage = await fetch(`${base}/admin/whatsapp-link`, {
      headers: { 'X-Test-User': 'other@example.com' }
    });
    assert.equal(nonOwnerPage.status, 403);
    const nonOwnerStart = await fetch(`${base}/api/admin/whatsapp-link/start`, {
      method: 'POST',
      headers: { 'X-Test-User': 'other@example.com' }
    });
    assert.equal(nonOwnerStart.status, 403);
    assert.equal(clients.length, 0);

    const ownerPage = await fetch(`${base}/admin/whatsapp-link`, {
      headers: { 'X-Test-User': 'robert.manzanillag@gmail.com' }
    });
    assert.equal(ownerPage.status, 200);
    const pageMarkup = await ownerPage.text();
    assert.match(pageMarkup, /Vinculación privada de WhatsApp/);
    assert.match(pageMarkup, /new EventSource/);
    assert.doesNotMatch(pageMarkup, /setInterval/);

    const statusResponse = await fetch(`${base}/api/admin/whatsapp-link/status`, {
      headers: { 'X-Test-User': 'robert.manzanillag@gmail.com' }
    });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.state, 'idle');
    assert.equal(status.reader.status, 'blocked');
    assert.equal(status.reader.groups['Promoters 🖤👾🖤'].lastProcessedAt, null);

    const badCsrf = await fetch(`${base}/api/admin/whatsapp-link/start`, {
      method: 'POST',
      headers: {
        'X-Test-User': 'robert.manzanillag@gmail.com',
        'X-CSRF-Token': 'invalid'
      }
    });
    assert.equal(badCsrf.status, 403);
    assert.equal(clients.length, 0);

    const start = await fetch(`${base}/api/admin/whatsapp-link/start`, {
      method: 'POST',
      headers: {
        'X-Test-User': 'robert.manzanillag@gmail.com',
        'X-CSRF-Token': status.csrfToken
      }
    });
    assert.equal(start.status, 202);
    assert.equal(clients.length, 1);
    await new Promise(resolve => setTimeout(resolve, 0));

    const qrResponse = await fetch(`${base}/api/admin/whatsapp-link/status`, {
      headers: { 'X-Test-User': 'robert.manzanillag@gmail.com' }
    });
    const qrStatus = await qrResponse.json();
    assert.equal(qrStatus.state, 'qr_required');
    assert.match(qrStatus.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal(qrResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.equal(clients[0].calls.includes('getChats'), false);
    assert.equal(clients[0].calls.includes('sendMessage'), false);
    const publicQrRequest = await fetch(`${base}/api/admin/whatsapp-link/status`);
    assert.equal(publicQrRequest.status, 401);

    const stop = await fetch(`${base}/api/admin/whatsapp-link/stop`, {
      method: 'POST',
      headers: {
        'X-Test-User': 'robert.manzanillag@gmail.com',
        'X-CSRF-Token': status.csrfToken
      }
    });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).state, 'stopped');
  });
});

test('connecting never registers message readers or outbound actions', async () => {
  const client = new FakeClient();
  const system = createWhatsAppLinkSystem({
    clientFactory: () => client,
    qrEncoder: async () => 'data:image/png;base64,dGVzdA=='
  });
  assert.equal(system.controller.snapshot().state, 'idle');
  assert.deepEqual(client.eventNames(), []);
  await system.controller.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(client.calls, ['initialize']);
  assert.equal(client.listenerCount('message'), 0);
  assert.equal(client.listenerCount('message_create'), 0);
  assert.equal(client.listenerCount('message_edit'), 0);
  assert.equal(client.listenerCount('message_reaction'), 0);
  await system.controller.stop();
});

test('a service without its dedicated encryption key cannot start Chromium', async () => {
  let factoryCalled = false;
  const system = createWhatsAppLinkSystem({
    sessionStore: {
      isConfigured: false,
      snapshot: () => ({ transferBytes: 0 })
    },
    clientFactory: undefined
  });
  system.controller.clientFactory = () => {
    factoryCalled = true;
    return new FakeClient();
  };
  system.controller.usesProductionFactory = true;
  const status = await system.controller.start();
  assert.equal(status.state, 'storage_unconfigured');
  assert.equal(factoryCalled, false);
});

test('production linking stays blocked without explicit account-sync consent', async () => {
  let factoryCalled = false;
  const system = createWhatsAppLinkSystem({
    sessionStore: {
      isConfigured: true,
      snapshot: () => ({ transferBytes: 0 })
    }
  });
  system.controller.clientFactory = () => {
    factoryCalled = true;
    return new FakeClient();
  };
  system.controller.usesProductionFactory = true;
  assert.equal(system.controller.snapshot().state, 'privacy_blocked');
  const status = await system.controller.start();
  assert.equal(status.state, 'privacy_blocked');
  assert.equal(factoryCalled, false);
});

test('startup resumes only when an encrypted session backup exists', async () => {
  let factoryCalls = 0;
  const client = new FakeClient();
  const system = createWhatsAppLinkSystem({
    accountSyncConsented: true,
    sessionStore: {
      isConfigured: true,
      snapshot: () => ({ transferBytes: 0 }),
      sessionExists: async () => false
    }
  });
  system.controller.clientFactory = () => {
    factoryCalls++;
    return client;
  };
  system.controller.usesProductionFactory = true;
  assert.deepEqual(await system.controller.resumePersistedSession(), { resumed: false, state: 'idle' });
  assert.equal(factoryCalls, 0);
  system.controller.sessionStore.sessionExists = async () => true;
  const resumed = await system.controller.resumePersistedSession();
  assert.equal(resumed.resumed, true);
  assert.equal(factoryCalls, 1);
  await system.controller.stop({ backup: false });
});

test('a dropped linked client performs a bounded encrypted-session reconnect attempt', async () => {
  const clients = [];
  const system = createWhatsAppLinkSystem({
    accountSyncConsented: true,
    reconnectDelaysMs: [1],
    sessionStore: {
      isConfigured: true,
      snapshot: () => ({ transferBytes: 0 }),
      sessionExists: async () => true
    }
  });
  system.controller.usesProductionFactory = true;
  system.controller.clientFactory = () => {
    const client = new FakeClient();
    clients.push(client);
    return client;
  };
  await system.controller.resumePersistedSession();
  clients[0].emit('disconnected');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(clients.length, 2);
  assert.equal(clients[1].calls.includes('initialize'), true);
  await system.controller.stop({ backup: false });
});

test('initialization errors expose only a sanitized stage and cause', async () => {
  const system = createWhatsAppLinkSystem({
    sessionStore: {
      isConfigured: true,
      snapshot: () => ({ transferBytes: 0 })
    },
    clientFactory: () => {
      const client = new FakeClient();
      client.initialize = async () => {
        throw new Error('libgbm.so.1 missing; private-token-value');
      };
      return client;
    }
  });
  await system.controller.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  const snapshot = system.controller.snapshot();
  assert.equal(snapshot.state, 'error');
  assert.deepEqual(snapshot.diagnostics, {
    stage: 'initializing_whatsapp',
    cause: 'CHROMIUM_MISSING_LIBRARY'
  });
  assert.equal(JSON.stringify(snapshot).includes('private-token-value'), false);
});

test('a WhatsApp disconnection is visible and does not start a message reader', async () => {
  const client = new FakeClient();
  const system = createWhatsAppLinkSystem({
    clientFactory: () => client,
    qrEncoder: async () => 'data:image/png;base64,dGVzdA=='
  });
  await system.controller.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  client.emit('ready');
  assert.equal(system.controller.snapshot().state, 'connected');
  client.emit('disconnected');
  assert.equal(system.controller.snapshot().state, 'disconnected');
  assert.equal(client.listenerCount('message'), 0);
  assert.equal(client.listenerCount('message_create'), 0);
});
