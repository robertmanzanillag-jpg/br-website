import { EventEmitter } from 'node:events';
import { createProductionReader, mountOwnerRoutes } from './integration.mjs';

export const isWhatsAppLinkOwner = user => typeof user?.email === 'string'
  && user.email.toLowerCase() === 'robert.manzanillag@gmail.com';

// Serializes start/stop/shutdown, including a stop while PostgreSQL connects.
// Construction and status reads never open a database or WhatsApp connection.
export class HostedReader extends EventEmitter {
  constructor(factory) {
    super(); this.factory = factory; this.resource = null; this.tail = Promise.resolve();
    this.closed = false; this.state = { state: 'stopped', processed: 0, groups: [], historyCoverage: 'not_verified' };
    this.forward = state => { this.state = state; this.emit('status', this.snapshot()); };
  }
  snapshot() { return structuredClone(this.state); }
  pairingQr() { return this.resource?.reader.pairingQr() || null; }
  enqueue(task) {
    const operation = this.tail.then(task);
    this.tail = operation.catch(() => this.forward({ ...this.state, state: 'startup_failed' }));
    return this.tail;
  }
  start() {
    return this.enqueue(async () => {
      if (this.closed) return;
      if (this.resource && ['database_unavailable', 'startup_failed'].includes(this.state.state)) {
        const failed = this.resource;
        this.resource = null;
        failed.reader.off('status', this.forward);
        await failed.shutdown().catch(() => {});
      }
      if (!this.resource) {
        this.forward({ ...this.state, state: 'connecting' });
        this.resource = await this.factory();
        this.resource.reader.on('status', this.forward);
      }
      await this.resource.reader.start();
      this.forward(this.resource.reader.snapshot());
    });
  }
  stop() {
    return this.enqueue(async () => {
      if (this.resource) await this.resource.reader.stop();
      this.forward({ ...this.state, state: 'stopped' });
    });
  }
  shutdown() {
    this.closed = true;
    return this.enqueue(async () => {
      if (this.resource) {
        const resource = this.resource;
        await resource.shutdown();
        resource.reader.off('status', this.forward);
        this.resource = null;
      }
      this.forward({ ...this.state, state: 'stopped' });
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
