// Optional network smoke; ephemeral unlinked identity, no account data or QR output.
// Never run concurrently with production. It is not part of npm test.
import { randomBytes } from 'node:crypto';
import { codec } from './store.mjs';
import { WebSocketReader } from './reader.mjs';
import makeWASocket from '@whiskeysockets/baileys';
import { HttpsProxyAgent } from 'https-proxy-agent';
const crypt = codec(randomBytes(32).toString('base64'));
const data = new Map();
const store = {
  async acquire() {}, async release() {},
  async load(id) { return data.has(id) ? crypt.open(data.get(id), id) : null; },
  async save(id, value) { data.set(id, crypt.seal(value, id)); },
  async saveMessage() { throw new Error('unlinked_smoke_must_not_ingest'); },
};
let failure = null;
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const reader = new WebSocketReader({ store, reconnectDelays: [], socketFactory: config => {
  const socket = makeWASocket({ ...config, ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}) });
  socket.ev.on('connection.update', update => {
    const error = update.lastDisconnect?.error;
    if (error) failure = { status: Number(error.output?.statusCode) || null,
      cause: String(error.message || '').match(/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|Unexpected server response: \d{3}/)?.[0] || 'connection_failed' };
  });
  return socket;
} });
let finish;
const done = new Promise(resolve => { finish = resolve; });
reader.on('status', status => {
  if (['qr_required', 'startup_failed', 'reconnect_exhausted', 'connect_timeout', 'processing_failed', 'relink_required'].includes(status.state)) finish(status.state);
});
const deadline = setTimeout(() => finish('network_smoke_timeout'), 35000);
try {
  await reader.start();
  const state = await done;
  console.log(JSON.stringify({ transport: 'websocket', state, failure, linked: false, qrPrinted: false }));
  process.exitCode = state === 'qr_required' ? 0 : 1;
} finally {
  clearTimeout(deadline); await reader.stop(); data.clear();
}
