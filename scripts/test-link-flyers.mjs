import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const context = { window: {}, URL };
vm.runInNewContext(fs.readFileSync(new URL('public/js/link-flyers.js', root), 'utf8'), context);
const flyers = context.window.LinkFlyers;
const kander = { title: 'KANDER @THE GROUND', url: 'https://link.dice.fm/vFE9sreUF6b?sharer_id=test' };
const kloud = { title: 'KLOUD @STUDIO60', url: 'https://link.dice.fm/blackroom' };
assert.match(flyers.imageUrl(kander), /8b558993-dabb/);
assert.match(flyers.imageUrl(kloud), /a5337700-a5ba/);
assert.equal(flyers.imageUrl({ ...kloud, title: 'Another event' }), '');
assert.equal(flyers.imageUrl({ ...kander, url: 'https://example.com' }), '');
assert.equal(flyers.imageUrl({ ...kander, metadata: { image_url: '/images/custom.jpg' } }), '/images/custom.jpg');
assert.equal(flyers.imageUrl({ ...kander, metadata: { image_url: '' } }), '');
for (const value of ['javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.com/a.jpg', '//example.com/a.jpg', '/\\example.com/a.jpg', 'https://user:pass@example.com/a.jpg']) {
  assert.equal(flyers.safeImageUrl(value), '', value);
}
const markup = flyers.render({ title: '" onload="alert(1)', metadata: { image_url: 'https://example.com/a.jpg?x="' } }, '<i>icon</i>');
assert.ok(markup.includes('&quot; onload=&quot;'));
assert.ok(markup.includes('onerror="this.hidden=true;this.nextElementSibling.hidden=false"'));
assert.equal(flyers.render({ title: 'No artwork' }, '<i>icon</i>'), '<i>icon</i>');

for (const file of ['public/links.html', 'public/admin/builder.html']) {
  const html = fs.readFileSync(new URL(file, root), 'utf8');
  assert.ok(html.includes('<script src="/js/link-flyers.js"></script>'));
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: file });
  }
}
const publicHtml = fs.readFileSync(new URL('public/links.html', root), 'utf8');
assert.ok(publicHtml.includes('href="/go/${link.id}"'));
console.log('PASS: verified flyers, overrides, removal, URL safety, escaped markup, fallback, inline syntax, tracked links');
