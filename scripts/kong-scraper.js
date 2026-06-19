import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KONG_PROFILE_URL = 'https://kongnightlife.com/user/414d4b95-6e98-4e2b-8a88-1d660f8f1e1b';
const KONG_EVENTS_URL = 'https://kongnightlife.com/events';
const CACHE_FILE = path.join(__dirname, '../db/kong-events-cache.json');
const DETAIL_LIMIT = Number.parseInt(process.env.KONG_DETAIL_LIMIT || '40', 10);

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12'
};

const KNOWN_VENUES = [
  'Booby Trap on the River',
  'Club Space Miami',
  'Coco Lounge',
  'E11EVEN Miami',
  'Factory Town',
  'Floyd Miami',
  'Joia Beach',
  'Jolene Sound Room',
  'La Otra',
  'MAD Club Wynwood',
  'Midline Miami',
  'Mode Miami',
  'Sable Miami',
  'Supernatural Haus',
  'The Ground Miami',
  'The Trip',
  'ZeyZey Miami',
  'Casa Nube Wynwood',
  'CASA NUBE WYNWOOD'
];

function cleanText(value = '') {
  return value
    .replace(/[^\x20-\x7EÀ-ÿ·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseKongDate(dateText) {
  const match = dateText.match(/\b([A-Z][a-z]{2})\s+(\d{1,2})\s+·\s+(\d{1,2}):(\d{2})\s*([AP]M)\b/);
  if (!match) return { parsedDate: '', time: '' };

  const [, monthName, dayRaw, hourRaw, minute, period] = match;
  const currentYear = new Date().getFullYear();
  const month = MONTHS[monthName.toLowerCase()];
  const parsedDate = `${currentYear}-${month}-${dayRaw.padStart(2, '0')}`;
  const time = `${hourRaw}:${minute} ${period}`;
  return { parsedDate, time };
}

function absoluteKongUrl(url = '') {
  if (!url) return KONG_PROFILE_URL;
  if (url.startsWith('http')) return url;
  return `https://kongnightlife.com${url.startsWith('/') ? '' : '/'}${url}`;
}

function findVenue(chunk) {
  const lowerChunk = chunk.toLowerCase();
  let best = null;

  for (const venue of KNOWN_VENUES) {
    const index = lowerChunk.lastIndexOf(venue.toLowerCase());
    if (index >= 0 && (!best || index > best.index)) {
      best = { venue, index };
    }
  }

  if (!best) return { title: chunk, location: 'Miami, FL' };

  return {
    title: cleanText(chunk.slice(0, best.index)),
    location: best.venue
  };
}

function extractEventSection(pageText) {
  const upcomingStart = pageText.indexOf('UPCOMING EVENTS');
  const thisWeekStart = pageText.indexOf('THIS WEEK');
  const start = upcomingStart >= 0 ? upcomingStart : thisWeekStart;

  if (start < 0) return pageText;

  const tail = pageText.slice(start);
  const endMarkers = ['TOP VENUES', 'LUXURY YACHTS', 'LUXURY CARS', 'EXPERIENCES'];
  const end = endMarkers
    .map(marker => tail.indexOf(marker))
    .filter(index => index > 0)
    .sort((a, b) => a - b)[0];

  return end ? tail.slice(0, end) : tail;
}

function parseEventsFromText(pageText, imageUrls = []) {
  const section = extractEventSection(cleanText(pageText))
    .replace(/\b(?:UPCOMING EVENTS|THIS WEEK|HAPPENING TODAY|SPECIAL DEALS)\b/gi, ' ')
    .replace(/\b\d+\s+events?\b/gi, ' ')
    .replace(/\bView All\b/gi, ' ');

  const datePattern = /\b[A-Z][a-z]{2}\s+\d{1,2}\s+·\s+\d{1,2}:\d{2}\s*[AP]M\b/g;
  const scrapedAt = new Date().toISOString();
  const events = [];
  let cursor = 0;
  let match;

  while ((match = datePattern.exec(section)) !== null) {
    const rawChunk = section.slice(cursor, match.index);
    cursor = datePattern.lastIndex;

    const chunk = cleanText(rawChunk)
      .replace(/\b(DEAL|Ticket|Guestlist)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!chunk || chunk.length < 3) continue;

    const { parsedDate, time } = parseKongDate(match[0]);
    const { title, location } = findVenue(chunk);
    const finalTitle = cleanText(title);

    if (!finalTitle || finalTitle.length < 3) continue;

    const slug = slugify(`${finalTitle}-${parsedDate || match[0]}`);
    const kongUrl = KONG_PROFILE_URL;

    events.push({
      title: finalTitle,
      fullTitle: finalTitle,
      description: `${finalTitle} at ${location}`,
      image: imageUrls[events.length] || '',
      dateText: match[0],
      parsedDate,
      date: parsedDate,
      time: time || '10:00 PM',
      location,
      address: '',
      organizer: 'Kong Nightlife',
      slug,
      kongUrl,
      poshUrl: kongUrl,
      ticketUrl: kongUrl,
      source: 'kong',
      scrapedAt
    });
  }

  const seen = new Set();
  return events.filter(event => {
    const key = `${event.title.toLowerCase()}|${event.parsedDate}|${event.location.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterUpcomingEvents(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return events
    .filter(event => {
      if (!event.parsedDate) return true;
      const eventDate = new Date(event.parsedDate);
      return !Number.isNaN(eventDate.getTime()) && eventDate >= today;
    })
    .sort((a, b) => new Date(a.parsedDate || '2099-01-01') - new Date(b.parsedDate || '2099-01-01'));
}

function parseDetailText(detailText = '') {
  const text = cleanText(detailText);
  const pickBetween = (startLabel, endLabels) => {
    const start = text.indexOf(startLabel);
    if (start < 0) return '';

    const tail = text.slice(start + startLabel.length);
    const end = endLabels
      .map(label => tail.indexOf(label))
      .filter(index => index > 0)
      .sort((a, b) => a - b)[0];

    return cleanText(end ? tail.slice(0, end) : tail);
  };

  const address = pickBetween('LOCATION', ['21+', 'DJ', 'Tickets', 'Invite Friends']);
  const description = pickBetween('About', ['Report Event', 'Get a Ride', 'Reviews', 'Going Guestlist']);
  const priceMatch = text.match(/\b(?:Starting price|Tickets from)\s+\$?([0-9][0-9.,]*)/i);
  const ageMatch = text.match(/\b(18\+|21\+)\b/);

  return {
    description,
    address,
    price: priceMatch ? `$${priceMatch[1]}` : '',
    ageRestriction: ageMatch ? ageMatch[1] : ''
  };
}

async function loadKongEventsPage(page) {
  await page.goto(KONG_PROFILE_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.body && !document.body.innerText.includes('Loading Events'), { timeout: 30000 });
}

async function extractLandingData(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      window.scrollBy(0, window.innerHeight * 0.8);
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    window.scrollTo(0, 0);
  });

  return page.evaluate(() => ({
    text: document.body.innerText || '',
    imageUrls: Array.from(document.querySelectorAll('img[alt="Event cover image"]'))
      .map(img => img.src)
      .filter(src => src && !src.startsWith('blob:'))
  }));
}

async function openEventCard(page, event) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const opened = await page.evaluate((eventTitle) => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const targetTitle = clean(eventTitle);
      const cards = Array.from(document.querySelectorAll('[aria-label]')).filter(el => {
        const label = clean(el.getAttribute('aria-label'));
        const text = clean(el.innerText || el.textContent);
        return label && text && text.includes('ticket') && (label.includes(targetTitle) || text.includes(targetTitle));
      });

      const card = cards[0];
      if (!card) {
        window.scrollBy(0, window.innerHeight * 0.75);
        return false;
      }

      card.scrollIntoView({ block: 'center', inline: 'center' });
      card.click();
      return true;
    }, event.title);

    if (opened) return true;
    await page.waitForTimeout(350);
  }

  return false;
}

async function extractDetailData(page, event) {
  const opened = await openEventCard(page, event);
  if (!opened) return {};

  try {
    await page.waitForFunction(() => location.pathname.includes('/event/'), { timeout: 8000 });
    await page.waitForFunction(() => document.body && document.body.innerText.includes('Tickets'), { timeout: 8000 });
  } catch {
    return {};
  }

  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const image = Array.from(document.querySelectorAll('img[alt="Event cover image"]'))
      .map(img => img.src)
      .find(src => src && !src.startsWith('blob:')) || '';
    const links = Array.from(document.querySelectorAll('a'))
      .map(a => ({ text: (a.innerText || a.textContent || '').trim(), href: a.href }))
      .filter(link => link.href);

    return {
      detailUrl: location.href,
      ticketUrl: location.href,
      image,
      text,
      links
    };
  });
}

async function enrichEventsWithDetails(page, events) {
  const enriched = [];
  const maxEvents = Math.min(events.length, DETAIL_LIMIT);

  for (const event of events.slice(0, maxEvents)) {
    try {
      await loadKongEventsPage(page);
      const detail = await extractDetailData(page, event);
      const parsedDetail = parseDetailText(detail.text || '');
      const eventUrl = absoluteKongUrl(detail.ticketUrl || detail.detailUrl || event.kongUrl);

      enriched.push({
        ...event,
        description: parsedDetail.description || event.description,
        image: detail.image || event.image,
        imageUrl: detail.image || event.image,
        address: parsedDetail.address || event.address,
        price: parsedDetail.price || event.price || '',
        ageRestriction: parsedDetail.ageRestriction || event.ageRestriction || '',
        detailUrl: eventUrl,
        kongUrl: eventUrl,
        poshUrl: eventUrl,
        ticketUrl: eventUrl,
        purchaseUrl: eventUrl
      });
    } catch (error) {
      console.log(`⚠️ Could not enrich ${event.title}: ${error.message}`);
      enriched.push(event);
    }
  }

  if (events.length > maxEvents) {
    enriched.push(...events.slice(maxEvents));
  }

  return enriched;
}

async function scrapeKongEvents() {
  console.log('🚀 Starting Kong Nightlife scraper...');

  let browser;
  try {
    const { default: puppeteer } = await import('puppeteer');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    await loadKongEventsPage(page);
    const data = await extractLandingData(page);
    const baseEvents = filterUpcomingEvents(parseEventsFromText(data.text, data.imageUrls));
    const events = filterUpcomingEvents(await enrichEventsWithDetails(page, baseEvents));
    const scrapedAt = new Date().toISOString();
    const cacheData = {
      lastUpdated: scrapedAt,
      source: KONG_PROFILE_URL,
      displaySource: KONG_EVENTS_URL,
      eventCount: events.length,
      events
    };

    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log(`✅ Kong sync done — ${events.length} events saved to cache`);
    return events;
  } catch (error) {
    console.error('❌ Kong scraping error:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function loadCachedKongEvents() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function getUpcomingKongEvents() {
  const cached = await loadCachedKongEvents();
  const now = new Date();

  if (cached) {
    const lastUpdated = new Date(cached.lastUpdated);
    const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

    if (hoursSinceUpdate < 12) {
      console.log(`📦 Using cached Kong events (${hoursSinceUpdate.toFixed(1)}h old)`);
      return filterUpcomingEvents(cached.events || []);
    }
  }

  console.log('🔄 Kong cache expired or missing, fetching fresh data...');
  return scrapeKongEvents();
}

export { scrapeKongEvents, getUpcomingKongEvents, loadCachedKongEvents, parseEventsFromText };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scrapeKongEvents()
    .then(events => {
      console.log('\n📊 Kong scraping complete!');
      console.log(`Total events: ${events.length}`);
      events.forEach(event => {
        console.log(`  - ${event.title} | ${event.parsedDate || event.dateText} | ${event.location}`);
      });
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
