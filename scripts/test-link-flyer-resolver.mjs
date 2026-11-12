import assert from 'node:assert/strict';
import { eventUrl, parseFlyer, resolveLinkFlyer } from '../utils/linkFlyerResolver.js';

const source = 'https://kongnightlife.com/p/bio-a3005gj';
for (const url of ['http://kongnightlife.com/a', 'https://localhost', 'https://127.0.0.1', 'https://kongnightlife.com.evil.test/a', 'https://user:pass@kongnightlife.com/a', 'https://kongnightlife.com:8443/a']) assert.throws(() => eventUrl(url));
assert.equal(parseFlyer('<meta content="/photo.png?a=1&amp;b=2" property="og:image">', source), 'https://kongnightlife.com/photo.png?a=1&b=2');
assert.equal(parseFlyer('<script type="application/ld+json">{"@graph":[{"@type":"MusicEvent","image":{"url":"/event.jpg"}}]}</script>', source), 'https://kongnightlife.com/event.jpg');
assert.equal(parseFlyer('<img alt="BR ANNIVERSARY FEST flyer" src="/art.png">', source), 'https://kongnightlife.com/art.png');
assert.equal(parseFlyer('<meta property="og:image" content="javascript:alert(1)">', source), '');
assert.equal(parseFlyer('<html>No artwork</html>', source), '');
let calls = [];
const image = await resolveLinkFlyer(source, async url => {
  calls.push(url);
  return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/event/123' } }) : new Response('<meta property="og:image" content="/flyer.png">');
});
assert.equal(image, 'https://kongnightlife.com/flyer.png');
assert.equal(calls.length, 2);
calls = [];
await assert.rejects(resolveLinkFlyer(source, async url => { calls.push(url); return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); }));
assert.equal(calls.length, 1, 'Unsafe redirect must never be fetched');
await assert.rejects(resolveLinkFlyer(source, async () => new Response('a'.repeat(2_000_001))), /too large/);
await assert.rejects(resolveLinkFlyer(source, async () => new Response('', { status: 404 })), /Unable/);
console.log('PASS: artwork parsing, relative images, redirect resolution, host restrictions, unsafe redirects, size limits, failures');

assert.equal(parseFlyer('<script>window.__KONG_EVENT_PREVIEW__={"coverImage":"/real.png"};try{}</script><img alt="Event flyer preview" src="/wrong.png">', source), 'https://kongnightlife.com/real.png');
