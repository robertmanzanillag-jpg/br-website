import { EventEmitter } from 'node:events';
import { createProductionReader, mountOwnerRoutes } from './integration.mjs';
import { isTransientDatabaseError, safeDatabaseDiagnostic } from './store.mjs';

export const isWhatsAppLinkOwner = user => typeof user?.email === 'string'
  && user.email.toLowerCase() === 'robert.manzanillag@gmail.com';

const SAFE_READER_STATES = new Set([
  'stopped', 'connecting', 'qr_required', 'pairing_accepted', 'reading', 'reconnecting',
  'database_unavailable', 'startup_failed', 'relink_required', 'qr_expired',
  'connect_timeout', 'connection_failed', 'group_identity_unverified',
  'queue_limit', 'reconnect_exhausted', 'processing_failed',
]);
const SAFE_REASONS = new Set([
  'database_unavailable', 'invalid_encryption_key', 'encrypted_state_unreadable',
  'reader_already_running', 'group_identity_unverified', 'connection_or_storage_failed',
  'startup_failed', 'relink_required', 'qr_expired', 'connect_timeout',
  'connection_failed', 'queue_limit', 'reconnect_exhausted', 'processing_failed',
  'storage_operation_failed',
]);
const SAFE_DELIVERY_STATES = new Set([
  'not_started', 'ready', 'integration_disabled', 'pending', 'pending_review',
  'delivering', 'applied', 'duplicate', 'receiver_pending', 'retry_wait',
  'invalid_signature', 'forbidden_group', 'temporary_receiver_failure',
  'redirect_rejected', 'receiver_review', 'source_conflict',
  'explicit_fields_required', 'older_than_7_days', 'payload_limit',
  'retry_limit_reached', 'unrecognized_receiver_response',
]);
const SAFE_PENDING_REASONS = new Set([
  'image_unidentified', 'ambiguous_date', 'incomplete_price', 'contradictory_fields',
  'announcement_without_price', 'ticket_not_table_price', 'older_than_7_days',
  'no_text_evidence', 'integration_disabled', 'source_conflict',
  'explicit_fields_required', 'flyer_requires_review',
]);
const FAILURE_STATES = new Set([
  'database_unavailable', 'startup_failed', 'relink_required', 'qr_expired',
  'connect_timeout', 'connection_failed', 'group_identity_unverified',
  'queue_limit', 'reconnect_exhausted', 'processing_failed',
]);
const SAFE_LOG_EVENTS = new Set([
  'reader_status', 'delivery_status', 'recovery_attempt',
]);
const RETRYABLE_STORAGE_STARTUP_OPERATIONS = new Set(['connect', 'lease']);
const PERMANENT_STARTUP_CODES = new Set([
  'invalid_encryption_key', 'encrypted_state_unreadable',
  'group_identity_unverified', 'relink_required',
]);
// A long transport outage must not permanently disable a linked reader.
// Authentication and group-identity failures remain owner-action states.
const RETRYABLE_TRANSPORT_STATES = new Set(['connect_timeout', 'connection_failed', 'reconnect_exhausted']);

const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const safeTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

function readerDiagnostic(event, state, delivery) {
  const readerState = SAFE_READER_STATES.has(state?.state) ? state.state : 'unknown';
  const storage = state?.storageFailure && typeof state.storageFailure === 'object'
    ? safeDatabaseDiagnostic({ code: state.storageFailure.code }, state.storageFailure.operation)
    : null;
  const isFailure = FAILURE_STATES.has(readerState);
  const startupCode = isFailure && SAFE_REASONS.has(state?.startupCode) ? state.startupCode : null;
  const stateReason = isFailure && SAFE_REASONS.has(state?.state) ? state.state : null;
  const reason = startupCode || stateReason || (isFailure && storage ? 'storage_operation_failed' : null);
  const groupCount = Array.isArray(state?.groups)
    ? state.groups.filter(group => group?.identified === true).length : 0;
  const groupValidation = groupCount === 4 ? 'validated'
    : readerState === 'group_identity_unverified' ? 'failed' : 'pending';
  const deliveryStatus = SAFE_DELIVERY_STATES.has(delivery?.status) ? delivery.status : 'unknown';
  return {
    component: 'whatsapp_reader',
    event: SAFE_LOG_EVENTS.has(event) ? event : 'reader_status',
    stage: readerState === 'reading' ? 'connected'
      : ['connecting', 'startup_failed'].includes(readerState) ? 'startup'
        : ['database_unavailable'].includes(readerState) ? 'storage'
          : ['reconnecting', 'connection_failed', 'connect_timeout'].includes(readerState) ? 'connection'
            : ['qr_required', 'pairing_accepted', 'qr_expired'].includes(readerState) ? 'pairing'
              : readerState === 'group_identity_unverified' ? 'group_validation'
                : readerState,
    state: readerState,
    reason,
    storage,
    storageFailureAt: safeTimestamp(state?.storageFailureAt),
    groupValidation,
    authorizedGroupCount: groupCount,
    counterScope: 'process',
    received: counter(state?.received),
    saved: counter(state?.saved),
    discarded: counter(state?.discarded),
    lastConnectionAt: safeTimestamp(state?.lastConnectionAt),
    lastIncomingAt: safeTimestamp(state?.lastIncomingAt),
    lastSavedAt: safeTimestamp(state?.lastSavedAt),
    connectionCode: Number.isSafeInteger(state?.disconnectCode) && state.disconnectCode >= 0
      ? state.disconnectCode : null,
    kong: {
      enabled: delivery?.enabled === true,
      hostReady: delivery?.hostReady === true,
      secretValid: delivery?.secretValid === true,
      status: deliveryStatus,
      reason: SAFE_REASONS.has(delivery?.status) || SAFE_DELIVERY_STATES.has(delivery?.status)
        ? delivery.status : null,
      attempts: counter(delivery?.attempts),
      applied: counter(delivery?.applied),
      duplicates: counter(delivery?.duplicates),
      receiverPending: counter(delivery?.receiverPending),
      rejected: counter(delivery?.rejected),
      networkFailures: counter(delivery?.networkFailures),
      lastAttemptAt: safeTimestamp(delivery?.lastAttemptAt),
      pendingReasons: Object.fromEntries(Object.entries(delivery?.pendingReasons || {})
        .filter(([reason, count]) => SAFE_PENDING_REASONS.has(reason) && counter(count) > 0)
        .map(([reason, count]) => [reason, counter(count)])),
    },
  };
}

// Serializes start/stop/shutdown, including a stop while PostgreSQL connects.
// Construction and status reads never open a database or WhatsApp connection.
export class HostedReader extends EventEmitter {
  constructor(factory, {
    retryDelays = [5000, 15000, 30000, 60000, 120000, 300000],
    diagnosticLogger = line => console.info(line),
    diagnosticIntervalMs = 60_000,
  } = {}) {
    super(); this.factory = factory; this.resource = null; this.tail = Promise.resolve();
    this.closed = false; this.state = {
      state: 'stopped', processed: 0, received: 0, saved: 0, discarded: 0, groups: [],
      historyCoverage: 'not_verified', storageFailure: null,
    };
    this.retryDelays = retryDelays; this.retryAttempt = 0; this.retryTimer = null; this.wanted = false; this.starting = null;
    this.metricTotals = { received: 0, saved: 0, discarded: 0 };
    this.resourceMetrics = { received: 0, saved: 0, discarded: 0 };
    this.diagnosticLogger = diagnosticLogger;
    this.diagnosticIntervalMs = diagnosticIntervalMs;
    this.lastDiagnosticAt = 0;
    this.lastDiagnosticSignature = '';
    this.forwardDelivery = status => {
      this.emit('delivery-status', status);
      const changed = !this.lastDeliveryState
        || this.lastDeliveryState.enabled !== status?.enabled
        || this.lastDeliveryState.status !== status?.status
        || JSON.stringify(this.lastDeliveryState.pendingReasons || {}) !== JSON.stringify(status?.pendingReasons || {});
      this.lastDeliveryState = status;
      this.logDiagnostic('delivery_status', this.state, status, changed);
    };
    this.forward = (state, countMetrics = true) => {
      if (countMetrics) {
        for (const metric of Object.keys(this.metricTotals)) {
          if (Number.isFinite(state[metric])) {
            this.metricTotals[metric] += Math.max(0, state[metric] - this.resourceMetrics[metric]);
            this.resourceMetrics[metric] = state[metric];
          }
        }
      }
      const previous = this.state;
      this.state = { ...previous, ...state, ...this.metricTotals };
      for (const field of ['lastConnectionAt', 'lastIncomingAt', 'lastSavedAt', 'storageFailure', 'storageFailureAt']) {
        if (state[field] == null && previous[field] != null) this.state[field] = previous[field];
      }
      if (state.state === 'reading') {
        this.retryAttempt = 0;
        this.state.retryAt = null;
        this.state.recoveryScheduledAt = null;
      }
      const retryableStorageStartup = state.state === 'startup_failed'
        && RETRYABLE_STORAGE_STARTUP_OPERATIONS.has(this.state.storageFailure?.operation)
        && !PERMANENT_STARTUP_CODES.has(state.startupCode)
        && (this.state.storageFailure?.code === 'unclassified'
          || isTransientDatabaseError({ code: this.state.storageFailure?.code }));
      const retryable = state.state === 'database_unavailable'
        || RETRYABLE_TRANSPORT_STATES.has(state.state)
        || (state.state === 'startup_failed'
          && (['database_unavailable', 'reader_already_running'].includes(state.startupCode)
            || retryableStorageStartup));
      const previousStorage = previous.storageFailure
        ? `${previous.storageFailure.code}:${previous.storageFailure.operation}` : '';
      const currentStorage = this.state.storageFailure
        ? `${this.state.storageFailure.code}:${this.state.storageFailure.operation}` : '';
      const errorChanged = previous.startupCode !== this.state.startupCode || previousStorage !== currentStorage;
      let recoveryScheduled = false;
      if (this.wanted && !this.closed && retryable && !this.retryTimer) {
        const delay = this.retryDelays[Math.min(this.retryAttempt, this.retryDelays.length - 1)];
        this.retryAttempt++;
        const now = new Date().toISOString();
        this.state = { ...this.state, recoveryAttempt: this.retryAttempt, recoveryScheduledAt: now, retryAt: new Date(Date.now() + delay).toISOString() };
        recoveryScheduled = true;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.wanted && !this.closed) {
            this.state = { ...this.state, recoveryLastAttemptAt: new Date().toISOString(), retryAt: null };
            this.logDiagnostic('recovery_attempt', this.state, this.deliverySnapshot(), true);
            this.emit('status', this.snapshot());
            void this.start();
          }
        }, delay);
        this.retryTimer.unref?.();
      }
      this.logDiagnostic('reader_status', this.state, this.deliverySnapshot(),
        previous.state !== this.state.state || recoveryScheduled || errorChanged);
      this.emit('status', this.snapshot());
    };
  }
  logDiagnostic(event, state = this.state, delivery = this.deliverySnapshot(), force = false) {
    const record = readerDiagnostic(event, state, delivery);
    const signature = JSON.stringify([record.event, record.stage, record.state, record.reason,
      record.storage?.code, record.storage?.operation, record.kong.enabled, record.kong.status,
      record.kong.pendingReasons]);
    const now = Date.now();
    if (!force && signature === this.lastDiagnosticSignature && now - this.lastDiagnosticAt < this.diagnosticIntervalMs) return;
    try { this.diagnosticLogger(JSON.stringify(record)); } catch {}
    this.lastDiagnosticAt = now;
    this.lastDiagnosticSignature = signature;
  }
  snapshot() { return structuredClone(this.state); }
  pairingQr() { return this.resource?.reader.pairingQr() || null; }
  deliverySnapshot() { return this.resource?.reader.deliverySnapshot?.() || { enabled: false, status: 'not_started' }; }
  async listInbox(limit, options) {
    if (!this.resource) throw new Error('inbox_unavailable');
    return this.resource.reader.listInbox(limit, options);
  }
  async deliveryOverview() {
    if (!this.resource) return { enabled: false, status: 'not_started', counts: {} };
    return this.resource.reader.deliveryOverview();
  }
  enqueue(task) {
    const operation = this.tail.then(task);
    this.tail = operation.catch(() => this.forward({ ...this.state, state: 'startup_failed' }, false));
    return this.tail;
  }
  start() {
    if (this.closed) return Promise.resolve();
    this.wanted = true;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    if (this.starting) return this.starting;
    const operation = this.enqueue(async () => {
      if (this.closed || !this.wanted) return;
      if (this.resource && ['connecting', 'qr_required', 'pairing_accepted', 'reading', 'reconnecting'].includes(this.state.state)) return;
      try {
        if (this.resource && (['database_unavailable', 'startup_failed'].includes(this.state.state)
          || RETRYABLE_TRANSPORT_STATES.has(this.state.state))) {
          const failed = this.resource;
          this.resource = null;
          failed.reader.off('status', this.forward);
          failed.reader.off('delivery-status', this.forwardDelivery);
          await failed.shutdown().catch(() => {});
        }
        if (!this.resource) {
          this.forward({ ...this.state, state: 'connecting' }, false);
          this.resource = await this.factory();
          this.resourceMetrics = { received: 0, saved: 0, discarded: 0 };
          this.resource.reader.on('status', this.forward);
          this.resource.reader.on('delivery-status', this.forwardDelivery);
        }
        await this.resource.reader.start();
        const snapshot = this.resource.reader.snapshot();
        if (snapshot.state !== this.state.state) this.forward(snapshot);
      } catch (error) {
        const transient = error?.message === 'database_unavailable' || isTransientDatabaseError(error);
        const startupCode = transient ? 'database_unavailable' : (
          ['invalid_encryption_key', 'encrypted_state_unreadable', 'reader_already_running', 'group_identity_unverified'].includes(error?.message)
            ? error.message : 'startup_failed'
        );
        const storageFailure = error?.diagnostic
          ? safeDatabaseDiagnostic({ code: error.diagnostic.code }, error.diagnostic.operation)
          : this.state.storageFailure;
        this.forward({ ...this.state, state: transient ? 'database_unavailable' : 'startup_failed', startupCode, storageFailure }, false);
      }
    });
    this.starting = operation.finally(() => { this.starting = null; });
    return this.starting;
  }
  stop() {
    this.wanted = false;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    return this.enqueue(async () => {
      if (this.resource) await this.resource.reader.stop();
      this.forward({ ...this.state, state: 'stopped' }, false);
    });
  }
  shutdown() {
    this.closed = true;
    this.wanted = false;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    return this.enqueue(async () => {
      if (this.resource) {
        const resource = this.resource;
        await resource.shutdown();
        resource.reader.off('status', this.forward);
        resource.reader.off('delivery-status', this.forwardDelivery);
        this.resource = null;
      }
      this.forward({ ...this.state, state: 'stopped' }, false);
    });
  }
}

export function createHostSystem(express, { factory = () => createProductionReader({
  databaseUrl: process.env.DATABASE_URL,
  encryptionKey: process.env.WHATSAPP_SESSION_ENCRYPTION_KEY,
  // The replacement routes/whatsapp-link.js imports only this implementation.
  legacyReaderDisabled: true,
}) } = {}) {
  const controller = new HostedReader(factory);
  const apiRouter = express.Router();
  const pageRouter = express.Router();
  const publicPrefix = '/api/admin/whatsapp-link';
  mountOwnerRoutes(apiRouter, controller, { isOwner: isWhatsAppLinkOwner, prefix: '', publicPrefix });
  pageRouter.get('/', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!isWhatsAppLinkOwner(req.session?.user)) return res.sendStatus(req.session?.user ? 403 : 401);
    return res.redirect(302, `${publicPrefix}/panel`);
  });
  return {
    apiRouter, pageRouter, controller,
    async resume() {
      await controller.start();
      const state = controller.snapshot().state;
      return { resumed: ['connecting', 'qr_required', 'reading', 'reconnecting'].includes(state), state };
    },
    shutdown: () => controller.shutdown(),
  };
}

