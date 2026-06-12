import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POSH_GROUP_URL = 'https://posh.vip/g/black-room';
const POSH_API_URL = 'https://posh.vip/api/web/v2/util/group_url/black-room';
const CACHE_FILE = path.join(__dirname, '../db/posh-events-cache.json');
const MANUAL_EVENTS_FILE = path.join(__dirname, '../db/posh-manual-events.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const POSH_IMAGE_BASE = 'https://posh.vip/cdn-cgi/image/fit=scale-down,width=640,height=640,format=auto,quality=80/';

async function scrapePoshEvents() {
  console.log('🚀 Starting Posh.vip scraper (API mode)...');

  try {
    const apiEvents = await fetchFromPoshAPI();
    const manualEvents = await loadManualEventData();

    const enrichedEvents = [];
    const seenSlugs = new Set();

    for (const event of apiEvents) {
      const slug = event.url;
      if (!slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      const startDate = event.startUtc || event.start;
      let parsedDate = null;
      let dateText = '';

      if (startDate) {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) {
          const estOffset = -5;
          const estDate = new Date(d.getTime() + estOffset * 60 * 60 * 1000);
          parsedDate = estDate.toISOString().split('T')[0];
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          dateText = `${days[estDate.getUTCDay()]}, ${months[estDate.getUTCMonth()]} ${estDate.getUTCDate()}, ${estDate.getUTCFullYear()}`;
        }
      }

      const flyerUrl = event.flyer || '';
      const imageUrl = flyerUrl ? POSH_IMAGE_BASE + flyerUrl : '';

      const venueName = event.venue?.name || '';
      const venueAddr = event.venue?.address || '';
      const location = venueName || venueAddr || 'Miami, FL';

      enrichedEvents.push({
        title: event.name || 'Untitled',
        fullTitle: event.name || '',
        description: (event.description || '').substring(0, 500),
        image: imageUrl,
        dateText,
        parsedDate,
        location,
        organizer: event.displayGroupName || 'Black Room',
        slug,
        poshUrl: `https://posh.vip/e/${slug}`,
        source: 'api',
        accentColor: event.accentColor || null,
        youtubeLink: event.youtubeLink || null,
        scrapedAt: new Date().toISOString()
      });
      console.log(`✅ ${event.name?.substring(0, 60)} | ${parsedDate || 'TBD'} | ${location}`);
    }

    for (const me of manualEvents) {
      const slug = me.url || me.slug;
      if (!slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      enrichedEvents.push({
        title: me.title || me.name || 'Untitled',
        fullTitle: me.title || me.name || '',
        description: me.description || '',
        image: me.image || '',
        dateText: me.dateText || '',
        parsedDate: me.parsedDate || me.date || null,
        location: me.location || me.venue || 'Miami, FL',
        organizer: 'Black Room',
        slug,
        poshUrl: `https://posh.vip/e/${slug}`,
        source: 'manual',
        scrapedAt: new Date().toISOString()
      });
      console.log(`✅ [MANUAL] ${(me.title || me.name || slug).substring(0, 60)}`);
    }

    console.log(`\n✅ Total: ${enrichedEvents.length} events`);

    enrichedEvents.sort((a, b) => {
      const dateA = new Date(a.parsedDate || '1970-01-01');
      const dateB = new Date(b.parsedDate || '1970-01-01');
      return dateB - dateA;
    });

    const cacheData = {
      lastUpdated: new Date().toISOString(),
      source: POSH_GROUP_URL,
      apiSource: POSH_API_URL,
      eventCount: enrichedEvents.length,
      events: enrichedEvents
    };

    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log(`💾 Saved ${enrichedEvents.length} events to cache`);

    return enrichedEvents;

  } catch (error) {
    console.error('❌ Scraping error:', error.message);
    throw error;
  }
}

async function fetchFromPoshAPI() {
  try {
    console.log('📡 Fetching events from Posh API...');
    const response = await fetch(POSH_API_URL, { headers: HEADERS });

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const events = data.events || [];
    console.log(`📡 Posh API returned ${events.length} events`);
    return events;
  } catch (e) {
    console.log(`⚠️ Posh API failed: ${e.message}, falling back to manual events only`);
    return [];
  }
}

async function loadManualEventData() {
  try {
    const data = await fs.readFile(MANUAL_EVENTS_FILE, 'utf-8');
    const manual = JSON.parse(data);
    return manual.events || [];
  } catch (e) {
    return [];
  }
}

async function loadCachedEvents() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function getUpcomingPoshEvents() {
  const cached = await loadCachedEvents();
  const now = new Date();

  if (cached) {
    const lastUpdated = new Date(cached.lastUpdated);
    const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

    if (hoursSinceUpdate < 12) {
      console.log(`📦 Using cached Posh events (${hoursSinceUpdate.toFixed(1)}h old)`);
      return filterUpcomingEvents(cached.events);
    }
  }

  console.log('🔄 Cache expired or missing, fetching fresh data...');
  const events = await scrapePoshEvents();
  return filterUpcomingEvents(events);
}

function filterUpcomingEvents(events) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return events.filter(e => {
    const dateStr = e.parsedDate || e.dateText;
    if (!dateStr) return true;
    try {
      const eventDate = new Date(dateStr);
      return !isNaN(eventDate.getTime()) && eventDate >= now;
    } catch {
      return true;
    }
  });
}

export { scrapePoshEvents, getUpcomingPoshEvents, loadCachedEvents };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scrapePoshEvents()
    .then(events => {
      console.log('\n📊 Scraping complete!');
      console.log(`Total events: ${events.length}`);
      events.forEach(e => {
        const date = e.parsedDate || e.dateText || 'TBD';
        console.log(`  - ${e.title} | ${date} | ${e.location} [${e.source}]`);
      });
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
