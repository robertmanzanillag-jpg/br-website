import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

function addKongEvent(allEvents, event) {
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
            type: 'live-event',
            featured: true,
            isPoshEvent: true,
            source: 'manual',
            image: event.image,
            imageUrl: event.image,
            price: event.price || '$25+'
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
        return res.json({
          id: `kong-${kongEvent.slug}`,
          title: kongEvent.title || (kongEvent.fullTitle || '').split('|')[0].trim(),
          date: kongEvent.parsedDate || parseEventDate(kongEvent.dateText),
          location: kongEvent.location,
          description: kongEvent.description,
          ticketLink: kongEvent.poshUrl,
          kongUrl: kongEvent.kongUrl,
          detailUrl: kongEvent.detailUrl,
          purchaseUrl: kongEvent.purchaseUrl,
          image: kongEvent.image,
          imageUrl: kongEvent.imageUrl || kongEvent.image,
          price: kongEvent.price,
          ageRestriction: kongEvent.ageRestriction,
          address: kongEvent.address
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
