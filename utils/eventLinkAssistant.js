import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

const DEFAULT_IMAGE = '/images/events/default-event.jpg';

function cleanText(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function readMeta($, key) {
  return cleanText(
    $(`meta[property="${key}"]`).attr('content') ||
    $(`meta[name="${key}"]`).attr('content') ||
    ''
  );
}

function toIsoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function toDisplayTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  });
}

function normalizeJsonLd(raw) {
  if (!raw) return [];
  const nodes = Array.isArray(raw) ? raw : [raw];
  return nodes.flatMap(node => {
    if (!node) return [];
    if (Array.isArray(node['@graph'])) return node['@graph'];
    return [node];
  });
}

function firstImage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstImage(value[0]);
  return value.url || value.contentUrl || '';
}

function formatAddress(location) {
  if (!location) return '';
  const address = location.address;
  if (!address) return cleanText(location.name || '');
  if (typeof address === 'string') return cleanText(address);
  return cleanText([
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    address.addressCountry
  ].filter(Boolean).join(', '));
}

function pickEventJsonLd($) {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const script of scripts) {
    try {
      const parsed = JSON.parse($(script).contents().text());
      const event = normalizeJsonLd(parsed).find(node => {
        const type = node?.['@type'];
        return type === 'Event' || (Array.isArray(type) && type.includes('Event'));
      });
      if (event) return event;
    } catch {}
  }
  return null;
}

function eventFromJsonLd(event, sourceUrl) {
  if (!event) return {};
  const offers = Array.isArray(event.offers) ? event.offers[0] : event.offers;
  const location = event.location || {};
  const venue = typeof location === 'string' ? location : cleanText(location.name || '');
  const startDate = event.startDate || event.doorTime || '';

  return {
    title: cleanText(event.name || ''),
    description: cleanText(event.description || ''),
    date: toIsoDate(startDate),
    time: toDisplayTime(startDate),
    venue,
    location: venue || formatAddress(location) || 'Miami, FL',
    address: formatAddress(location),
    price: offers?.price ? `$${offers.price}` : '',
    image: firstImage(event.image),
    ticketUrl: offers?.url || event.url || sourceUrl
  };
}

function eventFromMeta($, sourceUrl) {
  const title = readMeta($, 'og:title') || $('title').first().text();
  const description = readMeta($, 'og:description') || readMeta($, 'description');
  const image = readMeta($, 'og:image') || readMeta($, 'twitter:image');

  return {
    title: cleanText(title.replace(/\s*\|\s*.*$/, '')),
    description,
    date: '',
    time: '',
    venue: '',
    location: 'Miami, FL',
    address: '',
    price: '',
    image,
    ticketUrl: sourceUrl
  };
}

function buildQuestions(event) {
  const questions = [];
  if (!event.title) questions.push('Cuál es el nombre exacto del evento?');
  if (!event.date) questions.push('Qué fecha tiene el evento?');
  if (!event.ticketUrl) questions.push('Cuál es el link correcto para comprar tickets?');
  return questions;
}

export async function extractEventFromLink(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl.startsWith('http') ? sourceUrl : `https://${sourceUrl}`);
  } catch {
    throw new Error('Link inválido. Mándame un URL completo del evento.');
  }

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`No pude abrir el link (${response.status}). Si el evento es privado, necesito que me pases título, fecha e imagen manualmente.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const jsonLdEvent = eventFromJsonLd(pickEventJsonLd($), url.toString());
  const metaEvent = eventFromMeta($, url.toString());
  const event = {
    ...metaEvent,
    ...Object.fromEntries(Object.entries(jsonLdEvent).filter(([, value]) => value))
  };

  event.title = cleanText(event.title);
  event.description = event.description || `${event.title} at ${event.venue || event.location || 'Miami, FL'}`;
  event.image = event.image || DEFAULT_IMAGE;
  event.ticketUrl = event.ticketUrl || url.toString();
  event.sourceUrl = url.toString();
  event.extractedAt = new Date().toISOString();

  return {
    event,
    questions: buildQuestions(event),
    needsInfo: buildQuestions(event).length > 0
  };
}

export async function saveEventDraft(draftsPath, draft) {
  let data = { drafts: [] };
  try {
    if (fsSync.existsSync(draftsPath)) {
      data = JSON.parse(await fs.readFile(draftsPath, 'utf8'));
    }
  } catch {}

  if (!Array.isArray(data.drafts)) data.drafts = [];
  data.drafts = data.drafts.filter(item => item.status !== 'confirmed').slice(-25);
  data.drafts.push(draft);
  data.lastUpdated = new Date().toISOString();
  await fs.mkdir(path.dirname(draftsPath), { recursive: true });
  await fs.writeFile(draftsPath, JSON.stringify(data, null, 2));
}

export async function readEventDraft(draftsPath, draftId) {
  if (!fsSync.existsSync(draftsPath)) return null;
  const data = JSON.parse(await fs.readFile(draftsPath, 'utf8'));
  return (data.drafts || []).find(draft => draft.id === draftId) || null;
}

export async function markDraftConfirmed(draftsPath, draftId) {
  const data = fsSync.existsSync(draftsPath)
    ? JSON.parse(await fs.readFile(draftsPath, 'utf8'))
    : { drafts: [] };

  data.drafts = (data.drafts || []).map(draft =>
    draft.id === draftId ? { ...draft, status: 'confirmed', confirmedAt: new Date().toISOString() } : draft
  );
  data.lastUpdated = new Date().toISOString();
  await fs.writeFile(draftsPath, JSON.stringify(data, null, 2));
}

export async function addManualEvent(manualEventsPath, event) {
  let data = { events: [] };
  try {
    if (fsSync.existsSync(manualEventsPath)) {
      data = JSON.parse(await fs.readFile(manualEventsPath, 'utf8'));
    }
  } catch {}

  if (!Array.isArray(data.events)) data.events = [];
  const duplicate = data.events.find(existing =>
    existing.ticketUrl === event.ticketUrl ||
    (existing.title?.toLowerCase() === event.title.toLowerCase() && existing.date === event.date)
  );

  if (duplicate) return { event: duplicate, duplicate: true, total: data.events.length };

  const savedEvent = {
    id: `chat-${Date.now()}`,
    title: event.title,
    date: event.date,
    time: event.time || '11:00 PM',
    venue: event.venue || event.location || 'Miami, FL',
    location: event.location || event.venue || 'Miami, FL',
    address: event.address || '',
    price: event.price || '$25+',
    image: event.image || DEFAULT_IMAGE,
    ticketUrl: event.ticketUrl,
    description: event.description || '',
    source: 'chat-link',
    addedAt: new Date().toISOString(),
    sourceUrl: event.sourceUrl || event.ticketUrl
  };

  data.events.push(savedEvent);
  data.lastUpdated = new Date().toISOString();
  await fs.mkdir(path.dirname(manualEventsPath), { recursive: true });
  await fs.writeFile(manualEventsPath, JSON.stringify(data, null, 2));
  return { event: savedEvent, duplicate: false, total: data.events.length };
}
