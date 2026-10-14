import * as cheerio from 'cheerio';

// Restrict every redirect as well as the initial destination: this endpoint is
// an artwork lookup, never a general proxy to internal or arbitrary hosts.
const hosts = new Set(['kongnightlife.com', 'www.kongnightlife.com', 'link.dice.fm', 'dice.fm', 'www.dice.fm', 'posh.vip', 'www.posh.vip']);
export function eventUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)) {
    throw new Error('Use a supported HTTPS event link (KONG, DICE or POSH).');
  }
  return url;
}

export function parseFlyer(html, destination) {
  const $ = cheerio.load(html);
  let image;
  // KONG hydrates its event from JSON; the unhydrated poster is a template
  // image from another event. Parse data only, never execute remote scripts.
  if (new URL(destination).hostname.replace(/^www\./, '') === 'kongnightlife.com') {
    for (const script of $('script').toArray()) {
      const match = $(script).text().match(/window\.__KONG_EVENT_PREVIEW__\s*=\s*(\{.*\});\s*try/s);
      if (match) { try { image = JSON.parse(match[1]).coverImage; } catch {} }
      if (image) break;
    }
  }
  image ||=  $('meta[property="og:image"], meta[name="og:image"]').first().attr('content') ||
    $('meta[name="twitter:image"], meta[property="twitter:image"]').first().attr('content');
  if (!image) {
    for (const script of $('script[type="application/ld+json"]').toArray()) {
      try {
        const data = JSON.parse($(script).text());
        const nodes = (Array.isArray(data) ? data : [data]).flatMap(node => node?.['@graph'] || [node]);
        const event = nodes.find(node => [].concat(node?.['@type'] || []).some(type => /Event$/.test(type)));
        const candidate = Array.isArray(event?.image) ? event.image[0] : event?.image;
        image = typeof candidate === 'string' ? candidate : candidate?.url || candidate?.contentUrl;
        if (image) break;
      } catch {}
    }
  }
  image ||= $('img[alt]').filter((_, el) => /flyer/i.test($(el).attr('alt'))).first().attr('src');
  if (!image) return '';
  try {
    const url = new URL(image, destination);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export async function resolveLinkFlyer(source, fetchPage = fetch) {
  let url = eventUrl(source);
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchPage(url.href, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Event redirect has no destination.');
      url = eventUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Unable to open event link.'); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '', bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2_000_000) throw new Error('Event page is too large.');
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally { await reader.cancel(); }
    return parseFlyer(html, url.href);
  }
  throw new Error('Too many event redirects.');
}
