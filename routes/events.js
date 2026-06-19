import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const KONG_PROFILE_URL = 'https://kongnightlife.com/user/414d4b95-6e98-4e2b-8a88-1d660f8f1e1b';
const KONG_EVENT_FIXES = {
  "CHRIS LORENZO, JAZZY & RUZE": {
    url: 'https://kongnightlife.com/event/3720b036-6bbe-4080-8afa-36f8ada05320'
  },
  'BLACK ROOM & FRIENDS': {
    url: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    address: 'CASA NUBE WYNWOOD 2060 NW 1st Ave, Miami, FL 33127, USA'
  },
  'RAVE CUP: WORLD CUP QUARTER FINALS WATCH PARTY + RAVE': {
    url: 'https://kongnightlife.com/event/15e6dc23-dcdb-4409-a558-4f689f5dd09a'
  }
};

function normalizeKongEvent(event) {
  const fix = KONG_EVENT_FIXES[(event.title || '').toUpperCase()];
  if (!fix) return event;

  const hasProfileUrl = [event.ticketUrl, event.purchaseUrl, event.detailUrl, event.kongUrl, event.poshUrl]
    .some(url => url === KONG_PROFILE_URL);

  if (!hasProfileUrl && !fix.address) return event;

  return {
    ...event,
    ticketUrl: hasProfileUrl ? fix.url : event.ticketUrl,
    purchaseUrl: hasProfileUrl ? fix.url : event.purchaseUrl,
    detailUrl: hasProfileUrl ? fix.url : event.detailUrl,
    kongUrl: hasProfileUrl ? fix.url : event.kongUrl,
    poshUrl: hasProfileUrl ? fix.url : event.poshUrl,
    address: fix.address || event.address
  };
}

function addKongEvent(allEvents, event) {
  event = normalizeKongEvent(event);
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
          allEvents.push({
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
          });
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
    
    const upcomingEvents = allEvents.filter(event => {
      if (!event.date) return false;
      const eventDate = new Date(event.date);
      return eventDate >= today;
    });
    
    upcomingEvents.sort((a, b) => {
      const dateA = new Date(a.date || '2099-01-01');
      const dateB = new Date(b.date || '2099-01-01');
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
