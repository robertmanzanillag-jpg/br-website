import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const KONG_PROFILE_URL = 'https://kongnightlife.com/user/414d4b95-6e98-4e2b-8a88-1d660f8f1e1b';
const KONG_EVENT_FIXES = {
  'BLACK ROOM & FRIENDS': {
    url: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    address: 'CASA NUBE WYNWOOD 2060 NW 1st Ave, Miami, FL 33127, USA',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1780593125852-121208103.jpg'
  }
};

const KONG_EVENT_URL_FIXES = {
  'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a': {
    title: 'VOID',
    fullTitle: 'VOID',
    description: 'VOID emerges for the first time. A new chapter from Black Room built for deeper atmospheres, relentless energy, and hard techno.',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1782253024342-542185282.jpg',
    imageUrl: 'https://kongnightlife.com/api/objects/public/uploads/1782253024342-542185282.jpg',
    dateText: 'Jul 11 · 10:00 PM',
    parsedDate: '2026-07-11',
    date: '2026-07-11',
    time: '10:00 PM',
    location: 'M2 [Back Room]',
    venue: 'M2 [Back Room]',
    address: 'M2 [Back Room] 1235 Washington Ave, Miami Beach, FL 33139, USA',
    price: '$9.99'
  }
};

const KNOWN_BLACK_ROOM_KONG_EVENTS = [
  {
    title: 'BLACK ROOM & FRIENDS',
    fullTitle: 'BLACK ROOM & FRIENDS',
    description: 'BLACK ROOM & FRIENDS @ CASA NUBE WYNWOOD June 21st, 2026. Contact: info@blackroom.live or DM @blackroom.us',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1780593125852-121208103.jpg',
    imageUrl: 'https://kongnightlife.com/api/objects/public/uploads/1780593125852-121208103.jpg',
    dateText: 'Jun 21 · 12:00 PM',
    parsedDate: '2026-06-21',
    date: '2026-06-21',
    time: '12:00 PM',
    location: 'CASA NUBE WYNWOOD',
    address: 'CASA NUBE WYNWOOD 2060 NW 1st Ave, Miami, FL 33127, USA',
    slug: 'black-room-friends-2026-06-21',
    kongUrl: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    poshUrl: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    ticketUrl: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    detailUrl: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    purchaseUrl: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    price: '$25',
    source: 'kong-known'
  },
  {
    title: 'VOID',
    fullTitle: 'VOID',
    description: 'VOID emerges for the first time. A new chapter from Black Room built for deeper atmospheres, relentless energy, and hard techno.',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1782253024342-542185282.jpg',
    imageUrl: 'https://kongnightlife.com/api/objects/public/uploads/1782253024342-542185282.jpg',
    dateText: 'Jul 11 · 10:00 PM',
    parsedDate: '2026-07-11',
    date: '2026-07-11',
    time: '10:00 PM',
    location: 'M2 [Back Room]',
    address: 'M2 [Back Room] 1235 Washington Ave, Miami Beach, FL 33139, USA',
    slug: 'void-2026-07-11',
    kongUrl: 'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a',
    poshUrl: 'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a',
    ticketUrl: 'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a',
    detailUrl: 'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a',
    purchaseUrl: 'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a',
    price: '$9.99',
    source: 'kong-known'
  },
  {
    title: 'ZAPEROCO II',
    fullTitle: 'ZAPEROCO II',
    description: 'ZAPEROCO @ M2 MIAMI [Back Room] July 18th, 2026. Contact: info@blackroom.live or DM @blackroom.us',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1781197698719-493457825.jpg',
    imageUrl: 'https://kongnightlife.com/api/objects/public/uploads/1781197698719-493457825.jpg',
    dateText: 'Jul 18 · 10:00 PM',
    parsedDate: '2026-07-18',
    date: '2026-07-18',
    time: '10:00 PM',
    location: 'M2 Miami [Back Room]',
    address: 'M2 Miami [Back Room] 1235 Washington Ave, Miami Beach, FL 33139',
    slug: 'zaperoco-ii-2026-07-18',
    kongUrl: 'https://kongnightlife.com/event/06c55ef4-73b5-4df1-834f-0ea49d2b9ba0',
    poshUrl: 'https://kongnightlife.com/event/06c55ef4-73b5-4df1-834f-0ea49d2b9ba0',
    ticketUrl: 'https://kongnightlife.com/event/06c55ef4-73b5-4df1-834f-0ea49d2b9ba0',
    detailUrl: 'https://kongnightlife.com/event/06c55ef4-73b5-4df1-834f-0ea49d2b9ba0',
    purchaseUrl: 'https://kongnightlife.com/event/06c55ef4-73b5-4df1-834f-0ea49d2b9ba0',
    price: '$4.99',
    source: 'kong-known'
  }
];

function isBlackRoomEvent(event = {}) {
  const haystack = [
    event.title,
    event.fullTitle,
    event.name,
    event.description,
    event.organizer,
    event.location,
    event.venue,
    event.address
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes('black room') ||
    haystack.includes('blackroom.us') ||
    haystack.includes('@blackroom') ||
    haystack.includes('[back room]');
}

function normalizeKongEvent(event) {
  const eventUrls = [event.ticketUrl, event.purchaseUrl, event.detailUrl, event.kongUrl, event.poshUrl].filter(Boolean);
  const urlFix = eventUrls.map(url => KONG_EVENT_URL_FIXES[url]).find(Boolean);
  if (urlFix) {
    event = {
      ...event,
      ...urlFix,
      ticketUrl: event.ticketUrl || eventUrls[0],
      purchaseUrl: event.purchaseUrl || eventUrls[0],
      detailUrl: event.detailUrl || eventUrls[0],
      kongUrl: event.kongUrl || eventUrls[0],
      poshUrl: event.poshUrl || eventUrls[0]
    };
  }

  const fix = KONG_EVENT_FIXES[(event.title || '').toUpperCase()];
  if (!fix) return event;

  const hasProfileUrl = [event.ticketUrl, event.purchaseUrl, event.detailUrl, event.kongUrl, event.poshUrl]
    .some(url => url === KONG_PROFILE_URL);

  if (!hasProfileUrl && !fix.address && !fix.image) return event;

  return {
    ...event,
    ticketUrl: hasProfileUrl ? fix.url : event.ticketUrl,
    purchaseUrl: hasProfileUrl ? fix.url : event.purchaseUrl,
    detailUrl: hasProfileUrl ? fix.url : event.detailUrl,
    kongUrl: hasProfileUrl ? fix.url : event.kongUrl,
    poshUrl: hasProfileUrl ? fix.url : event.poshUrl,
    address: fix.address || event.address,
    image: fix.image || event.image,
    imageUrl: fix.image || event.imageUrl || event.image
  };
}

function addKongEvent(allEvents, event) {
  event = normalizeKongEvent(event);
  if (!isBlackRoomEvent(event)) return;
  const eventTitle = event.title || (event.fullTitle || '').split('|')[0].trim();
  const exists = allEvents.some(e =>
    (e.poshvipUrl && e.poshvipUrl === event.poshUrl) ||
    (e.kongUrl && event.kongUrl && e.kongUrl === event.kongUrl) ||
    (e.title.toLowerCase() === eventTitle.toLowerCase() && e.date === (event.parsedDate || parseEventDate(event.dateText)))
  );
  if (exists) return;

  const date = event.parsedDate || parseEventDate(event.dateText);

  allEvents.push({
    id: `kong-${event.slug}`,
    title: eventTitle,
    name: eventTitle,
    date: date,
    time: event.time || extractTime(event.dateText),
    location: event.location || 'Miami, FL',
    description: event.description,
    ticketLink: event.poshUrl,
    poshvipUrl: event.poshUrl,
    kongUrl: event.kongUrl,
    detailUrl: event.detailUrl,
    purchaseUrl: event.purchaseUrl,
    type: 'live-event',
    featured: true,
    isPoshEvent: true,
    source: 'kong',
    image: event.image,
    imageUrl: event.imageUrl || event.image,
    price: event.price,
    ageRestriction: event.ageRestriction,
    address: event.address
  });
}

function addMissingKnownKongEvents(allEvents, today) {
  for (const event of KNOWN_BLACK_ROOM_KONG_EVENTS) {
    const eventDate = parseDateAtLocalMidnight(event.date);
    if (!isNaN(eventDate.getTime()) && eventDate < today) continue;

    const exists = allEvents.some(e => {
      const eventTitle = (e.title || e.name || '').toLowerCase();
      return eventTitle === event.title.toLowerCase() ||
        e.kongUrl === event.kongUrl ||
        e.ticketLink === event.ticketUrl ||
        e.poshvipUrl === event.poshUrl ||
        e.purchaseUrl === event.purchaseUrl ||
        e.detailUrl === event.detailUrl;
    });

    if (!exists) addKongEvent(allEvents, { ...event });
  }
}

function parseDateAtLocalMidnight(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) date.setHours(0, 0, 0, 0);
  return date;
}

router.get('/', async (req, res) => {
  try {
    const allEvents = [];
    const now = new Date();
    
    // PRIORITY 1: Load manual events (most reliable)
    const manualEventsFile = path.join(__dirname, '../db/manual-events.json');
    if (fs.existsSync(manualEventsFile)) {
      const manualData = JSON.parse(fs.readFileSync(manualEventsFile, 'utf8'));
      if (manualData.events && manualData.events.length > 0) {
        for (const event of manualData.events) {
          const manualEvent = {
            id: `manual-${event.title.toLowerCase().replace(/\s+/g, '-')}`,
            title: event.title,
            name: event.title,
            venue: event.venue,
            date: event.date,
            time: event.time || '11:00 PM',
            location: event.location || 'Miami, FL',
            description: event.description || `${event.title} at ${event.venue}`,
            ticketLink: event.ticketUrl,
            poshvipUrl: event.ticketUrl,
            kongUrl: event.ticketUrl,
            detailUrl: event.ticketUrl,
            purchaseUrl: event.ticketUrl,
            type: 'live-event',
            featured: true,
            isPoshEvent: true,
            source: event.source || 'manual',
            image: event.image,
            imageUrl: event.image,
            price: event.price || '$25+',
            address: event.address || ''
          };

          if (isBlackRoomEvent(manualEvent)) allEvents.push(manualEvent);
        }
        console.log(`📋 Loaded ${manualData.events.length} manual events`);
      }
    }
    
    const kongCacheFile = path.join(__dirname, '../db/kong-events-cache.json');
    if (fs.existsSync(kongCacheFile)) {
      const kongData = JSON.parse(fs.readFileSync(kongCacheFile, 'utf8'));
      if (kongData.events && kongData.events.length > 0) {
        for (const event of kongData.events) {
          addKongEvent(allEvents, event);
        }
        console.log(`📦 Loaded ${kongData.events.length} events from Kong cache`);
      }
    } else {
      try {
        const { getUpcomingKongEvents } = await import('../scripts/kong-scraper.js');
        const kongEvents = await getUpcomingKongEvents();
        for (const event of kongEvents) {
          addKongEvent(allEvents, event);
        }
        console.log(`🔄 Generated Kong cache and loaded ${kongEvents.length} events`);
      } catch (error) {
        console.error('❌ Kong fallback sync failed:', error.message);
      }
    }
    
    const eventsFile = path.join(__dirname, '../db/events.json');
    if (fs.existsSync(eventsFile)) {
      const data = fs.readFileSync(eventsFile, 'utf8');
      const localEvents = JSON.parse(data || '[]');
      const poshLocalEvents = localEvents.filter(event => 
        event.type === 'live-event' || 
        event.isPoshEvent === true ||
        event.source === 'posh' ||
        event.source === 'kong'
      );
      
      for (const event of poshLocalEvents) {
        const exists = allEvents.some(e => 
          e.title === event.title || 
          (e.poshvipUrl && event.poshvipUrl && e.poshvipUrl === event.poshvipUrl)
        );
        if (!exists) {
          allEvents.push(event);
        }
      }
      console.log(`📅 Added ${poshLocalEvents.length} local Posh events`);
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    addMissingKnownKongEvents(allEvents, today);
    
    const upcomingEvents = allEvents.filter(event => {
      if (!event.date) return false;
      const eventDate = parseDateAtLocalMidnight(event.date);
      return eventDate >= today;
    });
    
    upcomingEvents.sort((a, b) => {
      const dateA = parseDateAtLocalMidnight(a.date || '2099-01-01');
      const dateB = parseDateAtLocalMidnight(b.date || '2099-01-01');
      return dateA - dateB;
    });
    
    console.log(`✅ Upcoming events returned: ${upcomingEvents.length} (filtered from ${allEvents.length})`);
    res.json(upcomingEvents);
  } catch (error) {
    console.error('❌ Error reading events:', error);
    res.status(500).json({ message: 'Error loading events', error: error.message });
  }
});

function parseEventDate(dateText) {
  if (!dateText) return null;
  
  const months = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };
  
  const match = dateText.match(/(\w{3}),?\s+(\w{3})\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const month = months[match[2].toLowerCase()] || '01';
    const day = match[3].padStart(2, '0');
    const year = match[4];
    return `${year}-${month}-${day}`;
  }
  
  const match2 = dateText.match(/(\w{3})\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match2) {
    const month = months[match2[1].toLowerCase()] || '01';
    const day = match2[2].padStart(2, '0');
    const year = match2[3];
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

function extractTime(dateText) {
  if (!dateText) return '10:00 PM';
  const timeMatch = dateText.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  return timeMatch ? timeMatch[1] : '10:00 PM';
}

router.get('/:id', (req, res) => {
  try {
    const eventId = req.params.id;
    
    const kongCacheFile = path.join(__dirname, '../db/kong-events-cache.json');
    if (fs.existsSync(kongCacheFile)) {
      const kongData = JSON.parse(fs.readFileSync(kongCacheFile, 'utf8'));
      const kongEvent = kongData.events?.find(e => `kong-${e.slug}` === eventId);
      if (kongEvent) {
        const normalizedEvent = normalizeKongEvent(kongEvent);
        return res.json({
          id: `kong-${normalizedEvent.slug}`,
          title: normalizedEvent.title || (normalizedEvent.fullTitle || '').split('|')[0].trim(),
          date: normalizedEvent.parsedDate || parseEventDate(normalizedEvent.dateText),
          location: normalizedEvent.location,
          description: normalizedEvent.description,
          ticketLink: normalizedEvent.poshUrl,
          kongUrl: normalizedEvent.kongUrl,
          detailUrl: normalizedEvent.detailUrl,
          purchaseUrl: normalizedEvent.purchaseUrl,
          image: normalizedEvent.image,
          imageUrl: normalizedEvent.imageUrl || normalizedEvent.image,
          price: normalizedEvent.price,
          ageRestriction: normalizedEvent.ageRestriction,
          address: normalizedEvent.address
        });
      }
    }
    
    const eventsFile = path.join(__dirname, '../db/events.json');
    if (fs.existsSync(eventsFile)) {
      const data = fs.readFileSync(eventsFile, 'utf8');
      const events = JSON.parse(data || '[]');
      const event = events.find(e => e.id === eventId || e.id === parseInt(eventId));
      if (event) {
        return res.json(event);
      }
    }

    return res.status(404).json({ message: 'Event not found' });
  } catch (error) {
    console.error('❌ Error reading event:', error);
    res.status(500).json({ message: 'Error loading event', error: error.message });
  }
});

export default router;
