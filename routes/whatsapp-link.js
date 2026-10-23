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
import { APPROVED_GROUP_NAMES } from '../services/whatsapp-reader/group-policy.js';
import { WhatsAppGroupRuntime } from '../services/whatsapp-reader/whatsapp-group-runtime.js';
import { classifyWhatsAppStartupFailure, resolveChromiumExecutable } from '../services/whatsapp-reader/chromium-executable.js';

const OWNER_EMAIL = 'robert.manzanillag@gmail.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, '../private/whatsapp-link.html');
const SESSION_PATH = path.resolve(process.env.BLACKROOM_WHATSAPP_SESSION_DIR
  || path.join(os.tmpdir(), 'blackroom-whatsapp-link'));
const QR_LIFETIME_MS = 5 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 120 * 1000;
const STAGE_TIMEOUTS_MS = {
  remote_backup_access: 20_000,
  remote_backup_restore: 30_000,
  launching_chromium: 30_000,
  loading_whatsapp_web: 45_000,
  waiting_for_qr: 45_000
};
const SESSION_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SAFE_DIAGNOSTIC_STAGES = new Set([
  'idle', 'preparing_browser', 'remote_backup_access', 'remote_backup_restore',
  'launching_chromium', 'loading_whatsapp_web', 'waiting_for_qr',
  'initializing_whatsapp', 'encoding_qr', 'waiting_for_scan', 'authenticated', 'resolving_groups', 'reader_active',
  'reader_blocked', 'restoring_session', 'encrypted_storage', 'disconnected',
  'qr_expired', 'stopped', 'unknown'
]);
const SAFE_DIAGNOSTIC_CAUSES = new Set([
  'WA_KEY_MISSING', 'WA_KEY_INVALID', 'WA_BACKUP_CORRUPT', 'WA_METER_CORRUPT',
  'WA_BUDGET_LIMIT', 'WA_STORAGE_LIMIT', 'WA_STORAGE_ERROR', 'WA_READER_STATE_INVALID',
  'WA_STORAGE_TIMEOUT', 'CHROMIUM_LAUNCH_TIMEOUT', 'WHATSAPP_WEB_LOAD_TIMEOUT', 'QR_WAIT_TIMEOUT',
  'WA_CHROMIUM_NOT_FOUND', 'CHROMIUM_MISSING_LIBRARY', 'CHROMIUM_SANDBOX_FAILURE',
  'CHROMIUM_NOT_FOUND', 'WHATSAPP_START_TIMEOUT', 'WHATSAPP_WEB_UNREACHABLE',
  'WHATSAPP_START_FAILED', 'WHATSAPP_AUTH_FAILED', 'WHATSAPP_DISCONNECTED',
  'QR_ENCODING_FAILED', 'QR_EXPIRED', 'groups_missing_or_duplicated',
  'group_reader_start_failed', 'budget_stopped'
]);

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
    accountSyncConsented = false,
    readerRuntimeFactory,
    reconnectDelaysMs = [30_000, 60_000, 120_000],
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    reviewReader = null,
    qrEncoder = QRCode.toDataURL,
    qrLifetimeMs = QR_LIFETIME_MS
  }) {
    this.qrEncoder = qrEncoder;
    this.qrLifetimeMs = qrLifetimeMs;
    this.client = null;
    this.authStrategy = null;
    this.qrTimer = null;
    this.startupTimer = null;
    this.stageTimer = null;
    this.startupStartedAt = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.reconnectDelaysMs = reconnectDelaysMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.generation = 0;
    this.state = 'idle';
    this.qrDataUrl = null;
    this.diagnostics = { stage: 'idle', cause: null };
    this.updatedAt = new Date().toISOString();
    this.listeners = new Set();
    this.sessionStore = sessionStore || new WhatsAppRemoteSessionStore({
      storage: storage || new StorageClient(),
      encryptionKey,
      dataPath: SESSION_PATH,
      onLimit: error => this.handleStoreFailure(error),
      onUsage: () => this.publish(),
      onStage: stage => this.setDiagnostic(stage)
    });
    if (!clientFactory && !this.sessionStore.isConfigured) this.state = 'storage_unconfigured';
    this.accountSyncConsented = accountSyncConsented === true;
    this.reviewReader = reviewReader;
    this.readerRuntime = null;
    this.readerSnapshot = null;
    this.readerRuntimeFactory = readerRuntimeFactory || (client => new WhatsAppGroupRuntime({
      client,
      store: this.sessionStore,
      onUpdate: snapshot => {
        this.readerSnapshot = snapshot;
        this.publish();
      }
    }));
    if (!clientFactory && this.sessionStore.isConfigured && !this.accountSyncConsented) {
      this.state = 'privacy_blocked';
    }
    this.clientFactory = clientFactory || (() => {
      this.authStrategy = new GuardedRemoteAuth({
        clientId: 'blackroom-owner-link',
        dataPath: SESSION_PATH,
        store: this.sessionStore,
        backupSyncIntervalMs: SESSION_BACKUP_INTERVAL_MS
      }, error => this.handleStoreFailure(error));
      const beforeBrowserInitialized = this.authStrategy.beforeBrowserInitialized.bind(this.authStrategy);
      this.authStrategy.beforeBrowserInitialized = async () => {
        this.setDiagnostic('remote_backup_access');
        await beforeBrowserInitialized();
        this.setDiagnostic('launching_chromium');
      };
      return new whatsapp.Client({
        authStrategy: this.authStrategy,
        puppeteer: {
          headless: true,
          executablePath: resolveChromiumExecutable(),
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
      diagnostics: {
        ...this.diagnostics,
        elapsedMs: this.diagnostics.startedAt
          ? Math.max(0, Date.now() - Date.parse(this.diagnostics.startedAt)) : 0,
        stageElapsedMs: this.diagnostics.stageStartedAt
          ? Math.max(0, Date.now() - Date.parse(this.diagnostics.stageStartedAt)) : 0
      },
      updatedAt: this.updatedAt,
      persistence: this.sessionStore.isConfigured ? 'encrypted-object-storage' : 'key-required',
      usage: this.sessionStore.snapshot(),
      reader: this.reviewReader?.snapshot() || this.readerSnapshot || {
        status: 'blocked',
        stopReason: 'privacy_isolation_unverified',
        pendingCount: 0,
        groups: Object.fromEntries(APPROVED_GROUP_NAMES.map(name => [name, {
          idPinned: false,
          lastProcessedAt: null,
          status: 'blocked'
        }]))
      }
    };
  }

  setState(state, qrDataUrl = null) {
    this.state = state;
    this.qrDataUrl = qrDataUrl;
    this.updatedAt = new Date().toISOString();
    this.publish();
  }

  setDiagnostic(stage, cause = null) {
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = null;
    const startedAt = this.startupStartedAt || this.diagnostics.startedAt || new Date().toISOString();
    this.diagnostics = {
      stage: SAFE_DIAGNOSTIC_STAGES.has(stage) ? stage : 'unknown',
      cause: cause == null ? null : SAFE_DIAGNOSTIC_CAUSES.has(cause) ? cause : 'WHATSAPP_START_FAILED',
      startedAt,
      stageStartedAt: new Date().toISOString()
    };
    this.updatedAt = new Date().toISOString();
    const timeoutMs = STAGE_TIMEOUTS_MS[this.diagnostics.stage];
    if (timeoutMs && this.client) {
      const client = this.client;
      const generation = this.generation;
      const stageAtArm = this.diagnostics.stage;
      const timeoutCause = {
        remote_backup_access: 'WA_STORAGE_TIMEOUT',
        remote_backup_restore: 'WA_STORAGE_TIMEOUT',
        launching_chromium: 'CHROMIUM_LAUNCH_TIMEOUT',
        loading_whatsapp_web: 'WHATSAPP_WEB_LOAD_TIMEOUT',
        waiting_for_qr: 'QR_WAIT_TIMEOUT'
      }[stageAtArm];
      this.stageTimer = setTimeout(() => this.finishClient(client, generation, 'error', {
        stage: stageAtArm,
        cause: timeoutCause
      }), timeoutMs);
      this.stageTimer.unref?.();
    }
    this.publish();
  }

  clearStartupTimer() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
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
    this.setDiagnostic('qr_expired', 'QR_EXPIRED');
    this.setState('expired');
    this.client = null;
    void client.destroy().catch(() => {});
    if (this.generation === generation) this.generation++;
  }

  async start() {
    if (this.client) return this.snapshot();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.usesProductionFactory && !this.sessionStore.isConfigured) {
      this.setState('storage_unconfigured');
      return this.snapshot();
    }
    if (this.usesProductionFactory && !this.accountSyncConsented) {
      this.setState('privacy_blocked');
      return this.snapshot();
    }

    const generation = ++this.generation;
    let client;
    this.startupStartedAt = new Date().toISOString();
    try {
      this.setDiagnostic('preparing_browser');
      await fs.mkdir(SESSION_PATH, { recursive: true, mode: 0o700 });
      client = this.clientFactory();
    } catch (error) {
      this.setDiagnostic('preparing_browser', classifyWhatsAppStartupFailure(error));
      this.setState('error');
      return this.snapshot();
    }

    this.client = client;
    this.setState('connecting');

    let currentBrowser = client.pupBrowser;
    try {
      Object.defineProperty(client, 'pupBrowser', {
        configurable: true,
        enumerable: true,
        get: () => currentBrowser,
        set: value => {
          currentBrowser = value;
          if (value) {
            if (this.client === client && this.generation === generation) {
              this.setDiagnostic('loading_whatsapp_web');
            } else {
              void Promise.resolve(value.close?.()).catch(() => {});
            }
          }
        }
      });
    } catch {
      // The loading_screen event below still reports progress for clients with a fixed property.
    }
    client.on('loading_screen', () => {
      if (this.client === client && this.generation === generation
          && this.diagnostics.stage === 'loading_whatsapp_web') {
        this.setDiagnostic('waiting_for_qr');
      }
    });
    client.on('qr', qr => {
      if (this.client !== client || this.generation !== generation) return;
      this.clearStartupTimer();
      this.clearQrTimer();
      this.setDiagnostic('encoding_qr');
      void this.qrEncoder(qr, { margin: 2, width: 320 })
        .then(dataUrl => {
          if (this.client !== client || this.generation !== generation) return;
          this.setDiagnostic('waiting_for_scan');
          this.setState('qr_required', dataUrl);
          this.qrTimer = setTimeout(() => this.expireQr(client, generation), this.qrLifetimeMs);
          this.qrTimer.unref?.();
        })
        .catch(() => {
          if (this.client !== client || this.generation !== generation) return;
          this.finishClient(client, generation, 'error', {
            stage: 'encoding_qr',
            cause: 'QR_ENCODING_FAILED'
          });
        });
    });
    client.on('authenticated', () => {
      if (this.client !== client || this.generation !== generation) return;
      this.clearStartupTimer();
      this.clearQrTimer();
      this.setDiagnostic('authenticated');
      this.setState('authenticated');
    });
    client.on('ready', () => {
      if (this.client !== client || this.generation !== generation) return;
      this.clearStartupTimer();
      this.clearQrTimer();
      this.setDiagnostic('resolving_groups');
      this.setState('connected');
      void this.startGroupReader(client, generation);
    });
    client.on('auth_failure', () => this.finishClient(client, generation, 'auth_failed'));
    client.on('disconnected', () => this.finishClient(client, generation, 'disconnected'));

    this.setDiagnostic('initializing_whatsapp');
    this.startupTimer = setTimeout(() => {
      const currentStage = this.diagnostics.stage;
      const stageCause = {
        remote_backup_access: 'WA_STORAGE_TIMEOUT',
        remote_backup_restore: 'WA_STORAGE_TIMEOUT',
        launching_chromium: 'CHROMIUM_LAUNCH_TIMEOUT',
        loading_whatsapp_web: 'WHATSAPP_WEB_LOAD_TIMEOUT',
        waiting_for_qr: 'QR_WAIT_TIMEOUT'
      }[currentStage] || 'WHATSAPP_START_TIMEOUT';
      this.finishClient(client, generation, 'error', { stage: currentStage, cause: stageCause });
    }, this.startupTimeoutMs);
    this.startupTimer.unref?.();

    // Initialization is triggered by the owner's POST /start or by a confirmed
    // encrypted backup at server startup. The read runtime attaches only after
    // exact group metadata has been resolved; it never registers outbound actions.
    void Promise.resolve()
      .then(() => client.initialize())
      .catch(error => {
        const cause = classifyWhatsAppStartupFailure(error);
        const state = error?.code === 'WA_BACKUP_CORRUPT' || error?.code === 'WA_METER_CORRUPT'
          ? 'backup_corrupt'
          : error?.code === 'WA_BUDGET_LIMIT' || error?.code === 'WA_STORAGE_LIMIT'
            ? 'budget_stopped'
            : error?.code === 'WA_STORAGE_ERROR' || error?.code === 'WA_STORAGE_TIMEOUT'
              ? 'backup_failed'
            : 'error';
        this.finishClient(client, generation, state, {
          stage: this.diagnostics.stage,
          cause
        });
      });
    return this.snapshot();
  }

  finishClient(client, generation, state, diagnostic = null) {
    if (this.client !== client || this.generation !== generation) return;
    this.clearStartupTimer();
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = null;
    this.readerRuntime?.disconnected(state);
    this.readerRuntime = null;
    this.clearQrTimer();
    const finalDiagnostic = diagnostic || (state === 'disconnected'
      ? { stage: 'disconnected', cause: 'WHATSAPP_DISCONNECTED' }
      : state === 'auth_failed'
        ? { stage: 'authenticated', cause: 'WHATSAPP_AUTH_FAILED' }
        : state === 'expired'
          ? { stage: 'qr_expired', cause: 'QR_EXPIRED' }
          : { stage: 'stopped', cause: null });
    this.diagnostics = {
      stage: SAFE_DIAGNOSTIC_STAGES.has(finalDiagnostic.stage) ? finalDiagnostic.stage : 'unknown',
      cause: finalDiagnostic.cause == null ? null
        : SAFE_DIAGNOSTIC_CAUSES.has(finalDiagnostic.cause) ? finalDiagnostic.cause : 'WHATSAPP_START_FAILED',
      startedAt: this.diagnostics.startedAt || new Date().toISOString(),
      stageStartedAt: new Date().toISOString()
    };
    this.updatedAt = new Date().toISOString();
    this.publish();
    this.setState(state);
    this.client = null;
    void client.destroy().catch(() => {});
    if (state === 'disconnected') this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (!this.accountSyncConsented || !this.sessionStore.isConfigured
        || this.reconnectTimer || this.reconnectAttempts >= this.reconnectDelaysMs.length) return;
    const delay = this.reconnectDelaysMs[this.reconnectAttempts++];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.resumePersistedSession();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async startGroupReader(client, generation) {
    let runtime;
    try {
      runtime = this.readerRuntimeFactory(client);
      this.readerRuntime = runtime;
      this.readerSnapshot = await runtime.start();
      this.setDiagnostic(this.readerSnapshot.status === 'active' ? 'reader_active' : 'reader_blocked',
        this.readerSnapshot.stopReason || null);
      if (this.client === client && this.generation === generation) this.publish();
    } catch (error) {
      if (this.client !== client || this.generation !== generation) return;
      const cause = classifyWhatsAppStartupFailure(error);
      this.setDiagnostic('resolving_groups', cause);
      this.readerSnapshot = runtime?.snapshot() || {
        status: 'blocked',
        stopReason: error?.code || 'group_reader_start_failed',
        pendingCount: 0,
        groups: Object.fromEntries(APPROVED_GROUP_NAMES.map(name => [name, {
          idPinned: false,
          lastProcessedAt: null,
          status: 'blocked'
        }]))
      };
      this.publish();
    }
  }

  handleStoreFailure(error) {
    const state = error?.code === 'WA_BUDGET_LIMIT' || error?.code === 'WA_STORAGE_LIMIT'
      ? 'budget_stopped'
      : 'backup_failed';
    const client = this.client;
    const generation = this.generation;
    const diagnostic = { stage: 'encrypted_storage', cause: classifyWhatsAppStartupFailure(error) };
    if (client) this.finishClient(client, generation, state, diagnostic);
    else {
      this.diagnostics = diagnostic;
      this.setState(state);
    }
  }

  async stop({ backup = true } = {}) {
    const client = this.client;
    if (client && backup && this.state === 'connected' && this.authStrategy?.storeRemoteSession) {
      await this.authStrategy.storeRemoteSession();
    }
    if (client !== this.client) return this.snapshot();
    this.generation++;
    this.client = null;
    this.clearStartupTimer();
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.readerRuntime?.disconnected('stopped');
    this.readerRuntime = null;
    this.clearQrTimer();
    this.diagnostics = { stage: 'stopped', cause: null };
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

  async resumePersistedSession() {
    if (!this.accountSyncConsented || !this.sessionStore.isConfigured) {
      return { resumed: false, state: this.snapshot().state };
    }
    try {
      const exists = await this.sessionStore.sessionExists({ session: 'RemoteAuth-blackroom-owner-link' });
      if (!exists) return { resumed: false, state: this.snapshot().state };
      const status = await this.start();
      return { resumed: Boolean(this.client), state: status.state };
    } catch (error) {
      const cause = classifyWhatsAppStartupFailure(error);
      const state = ['WA_BACKUP_CORRUPT', 'WA_METER_CORRUPT'].includes(error?.code)
        ? 'backup_corrupt'
        : ['WA_BUDGET_LIMIT', 'WA_STORAGE_LIMIT'].includes(error?.code)
          ? 'budget_stopped'
          : 'backup_failed';
      this.setDiagnostic(
        SAFE_DIAGNOSTIC_STAGES.has(this.diagnostics.stage) && this.diagnostics.stage !== 'idle'
          ? this.diagnostics.stage : 'restoring_session',
        cause
      );
      this.setState(state);
      return { resumed: false, state };
    }
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

const whatsAppLinkSystem = createWhatsAppLinkSystem({ accountSyncConsented: true });
export const whatsAppLinkPageRouter = whatsAppLinkSystem.pageRouter;
export const whatsAppLinkApiRouter = whatsAppLinkSystem.apiRouter;
export const shutdownWhatsAppLinkService = () => whatsAppLinkSystem.controller.shutdownForRestart();
export const resumeWhatsAppLinkService = () => whatsAppLinkSystem.controller.resumePersistedSession();
