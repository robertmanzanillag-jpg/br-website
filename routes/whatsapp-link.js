import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import whatsapp from 'whatsapp-web.js';

const OWNER_EMAIL = 'robert.manzanillag@gmail.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, '../private/whatsapp-link.html');
const SESSION_PATH = process.env.BLACKROOM_WHATSAPP_SESSION_DIR
  || path.join(os.tmpdir(), 'blackroom-whatsapp-link');
const QR_LIFETIME_MS = 5 * 60 * 1000;

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
  constructor({ clientFactory, qrEncoder = QRCode.toDataURL, qrLifetimeMs = QR_LIFETIME_MS }) {
    this.clientFactory = clientFactory || (() => new whatsapp.Client({
      authStrategy: new whatsapp.LocalAuth({
        clientId: 'blackroom-owner-link',
        dataPath: SESSION_PATH
      }),
      puppeteer: {
        headless: true,
        args: ['--disable-dev-shm-usage']
      }
    }));
    this.qrEncoder = qrEncoder;
    this.qrLifetimeMs = qrLifetimeMs;
    this.client = null;
    this.qrTimer = null;
    this.generation = 0;
    this.state = 'idle';
    this.qrDataUrl = null;
    this.updatedAt = new Date().toISOString();
  }

  snapshot() {
    return {
      state: this.state,
      qrDataUrl: this.qrDataUrl,
      updatedAt: this.updatedAt,
      persistence: 'temporary-session'
    };
  }

  setState(state, qrDataUrl = null) {
    this.state = state;
    this.qrDataUrl = qrDataUrl;
    this.updatedAt = new Date().toISOString();
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

    const generation = ++this.generation;
    let client;
    try {
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
      .catch(() => this.finishClient(client, generation, 'error'));
    return this.snapshot();
  }

  finishClient(client, generation, state) {
    if (this.client !== client || this.generation !== generation) return;
    this.clearQrTimer();
    this.setState(state);
    this.client = null;
    void client.destroy().catch(() => {});
  }

  async stop() {
    const client = this.client;
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
    if (!req.session.whatsAppLinkCsrf) {
      req.session.whatsAppLinkCsrf = randomBytes(32).toString('base64url');
    }
    res.json({ ...controller.snapshot(), csrfToken: req.session.whatsAppLinkCsrf });
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

const whatsAppLinkSystem = createWhatsAppLinkSystem();
export const whatsAppLinkPageRouter = whatsAppLinkSystem.pageRouter;
export const whatsAppLinkApiRouter = whatsAppLinkSystem.apiRouter;
