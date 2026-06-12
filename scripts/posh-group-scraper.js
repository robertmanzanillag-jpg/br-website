import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POSH_GROUP_URL = 'https://posh.vip/g/black-room';
const CACHE_FILE = path.join(__dirname, '../db/posh-events-cache.json');

async function scrapeGroupPage() {
  console.log('🚀 Scraping Posh.vip Black Room group page...');
  
  try {
    const response = await fetch(POSH_GROUP_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    
    const html = await response.text();
    
    const eventSlugs = new Set();
    
    const patterns = [
      /href="\/e\/([a-z0-9-]+)"/gi,
      /\/e\/([a-z0-9-]+)/gi,
      /"slug":"([a-z0-9-]+)"/gi,
      /"eventSlug":"([a-z0-9-]+)"/gi
    ];
    
    for (const pattern of patterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        const slug = match[1].toLowerCase();
        if (slug && slug.length > 3 && !slug.includes('undefined')) {
          eventSlugs.add(slug);
        }
      }
    }
    
    console.log(`📋 Found ${eventSlugs.size} event slugs from group page`);
    return Array.from(eventSlugs);
    
  } catch (error) {
    console.error('❌ Error scraping group page:', error.message);
    return [];
  }
}

async function scrapeEventPage(slug) {
  const url = `https://posh.vip/e/${slug}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    if (!response.ok) {
      console.log(`⚠️ Event not found: ${slug}`);
      return null;
    }
    
    const html = await response.text();
    
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(' | Posh', '').trim() : slug;
    
    const descMatch = html.match(/<meta name="description" content="([^"]+)"/i);
    const description = descMatch ? descMatch[1] : '';
    
    const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const image = imageMatch ? imageMatch[1] : '';
    
    const isBlackRoom = title.toLowerCase().includes('black room') ||
                        title.toLowerCase().includes('black pass') ||
                        title.toLowerCase().includes('variance') ||
                        title.toLowerCase().includes('red room') ||
                        title.toLowerCase().includes('blood') ||
                        description.toLowerCase().includes('black room');
    
    if (!isBlackRoom) {
      console.log(`⏭️ Skipping non-Black Room event: ${title}`);
      return null;
    }
    
    const datePatterns = [
      /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i
    ];
    
    let dateText = '';
    for (const pattern of datePatterns) {
      const match = title.match(pattern) || description.match(pattern);
      if (match) {
        dateText = match[0];
        break;
      }
    }
    
    const locationMatch = title.match(/\|\s*([^|]+)$/);
    const location = locationMatch ? locationMatch[1].trim() : 'Miami, FL';
    
    console.log(`✅ Scraped: ${title.substring(0, 50)}...`);
    
    return {
      title,
      description,
      image,
      dateText,
      location,
      slug,
      poshUrl: url,
      scrapedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`❌ Error scraping ${slug}:`, error.message);
    return null;
  }
}

async function loadManualSlugs() {
  try {
    const manualFile = path.join(__dirname, '../db/posh-manual-events.json');
    const data = await fs.readFile(manualFile, 'utf-8');
    const manual = JSON.parse(data);
    
    if (manual.eventUrls && manual.eventUrls.length > 0) {
      const slugs = manual.eventUrls
        .map(url => url.replace('https://posh.vip/e/', '').split('?')[0])
        .filter(slug => slug && slug.length > 3);
      
      console.log(`📋 Loaded ${slugs.length} manual event slugs`);
      return slugs;
    }
  } catch (e) {
    console.log('ℹ️ No manual events file found');
  }
  
  return [];
}

async function scrapeAllEvents() {
  console.log('🔄 Starting full Posh.vip scrape...\n');
  
  const groupSlugs = await scrapeGroupPage();
  const manualSlugs = await loadManualSlugs();
  
  const allSlugs = [...new Set([...groupSlugs, ...manualSlugs])];
  console.log(`\n📊 Total unique slugs to scrape: ${allSlugs.length}\n`);
  
  const events = [];
  
  for (const slug of allSlugs) {
    const event = await scrapeEventPage(slug);
    if (event) {
      events.push(event);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  events.sort((a, b) => {
    const dateA = new Date(a.dateText || '1970-01-01');
    const dateB = new Date(b.dateText || '1970-01-01');
    return dateB - dateA;
  });
  
  const cacheData = {
    lastUpdated: new Date().toISOString(),
    source: POSH_GROUP_URL,
    eventCount: events.length,
    events
  };
  
  await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
  
  console.log(`\n✅ Scraped ${events.length} Black Room events`);
  console.log(`💾 Saved to ${CACHE_FILE}`);
  
  return events;
}

scrapeAllEvents().catch(console.error);
