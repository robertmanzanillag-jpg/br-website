import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import whatsapp from 'whatsapp-web.js';
import { Client as StorageClient } from '@replit/object-storage';
import { WhatsAppRemoteSessionStore, WhatsAppStoreError } from '../services/whatsapp-reader/session-store.js';

const OWNER_EMAIL = 'robert.manzanillag@gmail.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, '../private/whatsapp-link.html');
const SESSION_PATH = path.resolve(process.env.BLACKROOM_WHATSAPP_SESSION_DIR
  || path.join(os.tmpdir(), 'blackroom-whatsapp-link'));
const QR_LIFETIME_MS = 5 * 60 * 1000;
const SESSION_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

class GuardedRemoteAuth extends whatsapp.RemoteAuth {
  constructor(options, onFailure) {
    super(options);
    this.onFailure = onFailure;
    this.syncPromise = Promise.resolve();
    this.failed = false;
  }

  async afterAuthReady() {
    await super.afterAuthReady();
    if (this.failed) clearInterval(this.backupSync);
  }

  async storeRemoteSession(options) {
    const sync = () => super.storeRemoteSession(options).catch(error => {
      this.failed = true;
      this.onFailure(error);
    });
    const pending = this.syncPromise.then(sync, sync);
    this.syncPromise = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export function isWhatsAppLinkOwner(user) {
  return typeof user?.email === 'string'
    && user.email.toLowerCase() === OWNER_EMAIL;
}

function privateResponse(res) {
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
}

function ownerOnly(req, res, next) {
  privateResponse(res);
  if (isWhatsAppLinkOwner(req.session?.user)) return next();
  const status = req.session?.user ? 403 : 401;
  return res.status(status).json({ error: 'Owner authentication required' });
}

function safeTokenEquals(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class WhatsAppLinkController {
  constructor({
    clientFactory,
    sessionStore,
    storage,
    encryptionKey,
    privacyIsolationVerified = false,
    qrEncoder = QRCode.toDataURL,
    qrLifetimeMs = QR_LIFETIME_MS
  }) {
    this.qrEncoder = qrEncoder;
    this.qrLifetimeMs = qrLifetimeMs;
    this.client = null;
    this.authStrategy = null;
    this.qrTimer = null;
    this.generation = 0;
    this.state = 'idle';
    this.qrDataUrl = null;
    this.updatedAt = new Date().toISOString();
    this.listeners = new Set();
    this.sessionStore = sessionStore || new WhatsAppRemoteSessionStore({
      storage: storage || new StorageClient(),
      encryptionKey,
      dataPath: SESSION_PATH,
      onLimit: error => this.handleStoreFailure(error),
      onUsage: () => this.publish()
    });
    if (!clientFactory && !this.sessionStore.isConfigured) this.state = 'storage_unconfigured';
    this.privacyIsolationVerified = privacyIsolationVerified === true;
    if (!clientFactory && this.sessionStore.isConfigured && !this.privacyIsolationVerified) {
      this.state = 'privacy_blocked';
    }
    this.clientFactory = clientFactory || (() => {
      this.authStrategy = new GuardedRemoteAuth({
        clientId: 'blackroom-owner-link',
        dataPath: SESSION_PATH,
        store: this.sessionStore,
        backupSyncIntervalMs: SESSION_BACKUP_INTERVAL_MS
      }, error => this.handleStoreFailure(error));
      return new whatsapp.Client({
        authStrategy: this.authStrategy,
        puppeteer: {
          headless: true,
          args: ['--disable-dev-shm-usage']
        }
      });
    });
    this.usesProductionFactory = !clientFactory;
  }

  snapshot() {
    return {
      state: this.state,
      qrDataUrl: this.qrDataUrl,
      updatedAt: this.updatedAt,
      persistence: this.sessionStore.isConfigured ? 'encrypted-object-storage' : 'key-required',
      usage: this.sessionStore.snapshot()
    };
  }

  setState(state, qrDataUrl = null) {
    this.state = state;
    this.qrDataUrl = qrDataUrl;
    this.updatedAt = new Date().toISOString();
    this.publish();
  }

  publish() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clearQrTimer() {
    if (this.qrTimer) clearTimeout(this.qrTimer);
    this.qrTimer = null;
  }

  expireQr(client, generation) {
    this.clearQrTimer();
    this.setState('expired');
    this.client = null;
    void client.destroy().catch(() => {});
    if (this.generation === generation) this.generation++;
  }

  async start() {
    if (this.client) return this.snapshot();
    if (this.usesProductionFactory && !this.sessionStore.isConfigured) {
      this.setState('storage_unconfigured');
      return this.snapshot();
    }
    if (this.usesProductionFactory && !this.privacyIsolationVerified) {
      this.setState('privacy_blocked');
      return this.snapshot();
    }

    const generation = ++this.generation;
    let client;
    try {
      await fs.mkdir(SESSION_PATH, { recursive: true, mode: 0o700 });
      client = this.clientFactory();
    } catch {
      this.setState('error');
      return this.snapshot();
    }

    this.client = client;
    this.setState('connecting');

    client.on('qr', qr => {
      if (this.client !== client || this.generation !== generation) return;
      this.clearQrTimer();
      void this.qrEncoder(qr, { margin: 2, width: 320 })
        .then(dataUrl => {
          if (this.client !== client || this.generation !== generation) return;
          this.setState('qr_required', dataUrl);
          this.qrTimer = setTimeout(() => this.expireQr(client, generation), this.qrLifetimeMs);
          this.qrTimer.unref?.();
        })
        .catch(() => {
          if (this.client !== client || this.generation !== generation) return;
          this.setState('error');
          this.client = null;
          void client.destroy().catch(() => {});
        });
    });
    client.on('authenticated', () => {
      if (this.client !== client || this.generation !== generation) return;
      this.clearQrTimer();
      this.setState('authenticated');
    });
    client.on('ready', () => {
      if (this.client !== client || this.generation !== generation) return;
      this.clearQrTimer();
      this.setState('connected');
    });
    client.on('auth_failure', () => this.finishClient(client, generation, 'auth_failed'));
    client.on('disconnected', () => this.finishClient(client, generation, 'disconnected'));

    this.qrTimer = setTimeout(() => this.expireQr(client, generation), this.qrLifetimeMs);
    this.qrTimer.unref?.();

    // Initialization is deliberately triggered only by the owner's POST /start.
    // No chat/message listeners or outbound operations are registered here.
    void Promise.resolve()
      .then(() => client.initialize())
      .catch(error => {
        const state = error?.code === 'WA_BACKUP_CORRUPT' || error?.code === 'WA_METER_CORRUPT'
          ? 'backup_corrupt'
          : error?.code === 'WA_BUDGET_LIMIT' || error?.code === 'WA_STORAGE_LIMIT'
            ? 'budget_stopped'
            : error?.code === 'WA_STORAGE_ERROR'
              ? 'backup_failed'
            : 'error';
        this.finishClient(client, generation, state);
      });
    return this.snapshot();
  }

  finishClient(client, generation, state) {
    if (this.client !== client || this.generation !== generation) return;
    this.clearQrTimer();
    this.setState(state);
    this.client = null;
    void client.destroy().catch(() => {});
  }

  handleStoreFailure(error) {
    const state = error?.code === 'WA_BUDGET_LIMIT' || error?.code === 'WA_STORAGE_LIMIT'
      ? 'budget_stopped'
      : 'backup_failed';
    const client = this.client;
    const generation = this.generation;
    if (client) this.finishClient(client, generation, state);
    else this.setState(state);
  }

  async stop({ backup = true } = {}) {
    const client = this.client;
    if (client && backup && this.state === 'connected' && this.authStrategy?.storeRemoteSession) {
      await this.authStrategy.storeRemoteSession();
    }
    if (client !== this.client) return this.snapshot();
    this.generation++;
    this.client = null;
    this.clearQrTimer();
    this.setState('stopped');
    if (client) {
      try {
        await client.destroy();
      } catch {
        // A disconnected browser may already be destroyed.
      }
    }
    return this.snapshot();
  }

  async shutdownForRestart() {
    return this.stop({ backup: true });
  }
}

export function createWhatsAppLinkSystem(options = {}) {
  const controller = options.controller || new WhatsAppLinkController(options);
  const pageRouter = express.Router();
  const apiRouter = express.Router();

  pageRouter.get('/', ownerOnly, (req, res) => {
    privateResponse(res);
    res.sendFile(PAGE_PATH);
  });

  apiRouter.get('/status', ownerOnly, (req, res) => {
    ensureCsrf(req);
    res.json({ ...controller.snapshot(), csrfToken: req.session.whatsAppLinkCsrf });
  });

  apiRouter.get('/events', ownerOnly, (req, res) => {
    ensureCsrf(req);
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    const send = snapshot => {
      res.write(`data: ${JSON.stringify({ ...snapshot, csrfToken: req.session.whatsAppLinkCsrf })}\n\n`);
    };
    send(controller.snapshot());
    const unsubscribe = controller.subscribe(send);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 30_000);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  apiRouter.post('/start', ownerOnly, async (req, res) => {
    if (!safeTokenEquals(req.session.whatsAppLinkCsrf, req.get('x-csrf-token'))) {
      return res.status(403).json({ error: 'Invalid request token' });
    }
    return res.status(202).json(await controller.start());
  });

  apiRouter.post('/stop', ownerOnly, async (req, res) => {
    if (!safeTokenEquals(req.session.whatsAppLinkCsrf, req.get('x-csrf-token'))) {
      return res.status(403).json({ error: 'Invalid request token' });
    }
    return res.json(await controller.stop());
  });

  return { pageRouter, apiRouter, controller };
}

function ensureCsrf(req) {
  if (!req.session.whatsAppLinkCsrf) {
    req.session.whatsAppLinkCsrf = randomBytes(32).toString('base64url');
  }
}

const whatsAppLinkSystem = createWhatsAppLinkSystem();
export const whatsAppLinkPageRouter = whatsAppLinkSystem.pageRouter;
export const whatsAppLinkApiRouter = whatsAppLinkSystem.apiRouter;
export const shutdownWhatsAppLinkService = () => whatsAppLinkSystem.controller.shutdownForRestart();
