import assert from 'node:assert/strict';
import express from 'express';
import { createBioFlyerRouter } from '../routes/bio-flyers.js';

const files = new Map();
let failStorage = false;
let writes = 0;
const storage = {
  async uploadFromBytes(key, bytes) {
    writes++;
    if (failStorage) return { ok: false, error: { statusCode: 503 } };
    files.set(key, bytes);
    return { ok: true, value: null };
  },
  async downloadAsBytes(key) {
    return files.has(key) ? { ok: true, value: [files.get(key)] } : { ok: false, error: { statusCode: 404 } };
  }
};
const app = express();
app.use((req, res, next) => {
  if (req.headers['x-test-user']) req.session = { user: { isAdmin: req.headers['x-test-user'] === 'admin' } };
  next();
});
app.use('/api', createBioFlyerRouter(storage));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=', 'base64');
async function upload(bytes, user = 'admin', filename = 'photo.png', count = 1) {
  const body = new FormData();
  for (let i = 0; i < count; i++) body.append('image', new Blob([bytes], { type: 'image/png' }), filename);
  return fetch(`${origin}/api/admin/bio-flyers`, { method: 'POST', headers: user ? { 'x-test-user': user } : {}, body });
}
try {
  assert.equal((await upload(png, '')).status, 401);
  assert.equal((await upload(png, 'member')).status, 403);
  assert.equal(writes, 0);
  const response = await upload(png, 'admin', '../../malicious.html');
  assert.equal(response.status, 201);
  const { imageUrl } = await response.json();
  assert.match(imageUrl, /^\/api\/bio-flyers\/[a-f0-9-]{36}\.png$/);
  const image = await fetch(origin + imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await upload(Buffer.from('<svg onload="alert(1)">'))).status, 400);
  assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 400);
  assert.equal((await upload(png, 'admin', 'a.png', 2)).status, 400);
  assert.equal((await fetch(origin + '/api/bio-flyers/anything.svg')).status, 404);
  assert.equal((await fetch(origin + '/api/bio-flyers/11111111-1111-4111-8111-111111111111.png')).status, 404);
  failStorage = true;
  assert.equal((await upload(png)).status, 503);
  assert.equal(files.size, 1);
  console.log('PASS: authenticated uploads, file limits, signature validation, safe names, durable storage result handling and public image roundtrip');
} finally {
  await new Promise(resolve => server.close(resolve));
}
