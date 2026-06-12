import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANUAL_EVENTS_FILE = path.join(__dirname, '../db/manual-events.json');

async function validateEventUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    return response.ok || response.status === 200 || response.status === 301 || response.status === 302;
  } catch (error) {
    console.log(`⚠️ Could not validate: ${url} - ${error.message}`);
    return true;
  }
}

async function validateAllEvents() {
  console.log('🔍 Starting event validation...\n');
  
  try {
    const data = await fs.readFile(MANUAL_EVENTS_FILE, 'utf-8');
    const manualEvents = JSON.parse(data);
    
    if (!manualEvents.events || manualEvents.events.length === 0) {
      console.log('ℹ️ No manual events to validate');
      return { valid: 0, invalid: 0, events: [] };
    }
    
    console.log(`📋 Validating ${manualEvents.events.length} events...\n`);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let validCount = 0;
    let invalidCount = 0;
    let expiredCount = 0;
    const validEvents = [];
    
    for (const event of manualEvents.events) {
      const eventDate = new Date(event.date);
      const isExpired = eventDate < today;
      
      if (isExpired) {
        console.log(`⏰ EXPIRED: ${event.title} (${event.date})`);
        expiredCount++;
        continue;
      }
      
      const isValid = await validateEventUrl(event.ticketUrl);
      
      if (isValid) {
        console.log(`✅ VALID: ${event.title} - ${event.date}`);
        validCount++;
        validEvents.push(event);
      } else {
        console.log(`❌ INVALID URL: ${event.title} - ${event.ticketUrl}`);
        invalidCount++;
      }
      
      await new Promise(r => setTimeout(r, 300));
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 VALIDATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Valid upcoming events: ${validCount}`);
    console.log(`❌ Invalid URLs: ${invalidCount}`);
    console.log(`⏰ Expired events: ${expiredCount}`);
    console.log('='.repeat(50));
    
    return {
      valid: validCount,
      invalid: invalidCount,
      expired: expiredCount,
      events: validEvents,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Error validating events:', error.message);
    return { valid: 0, invalid: 0, error: error.message };
  }
}

async function cleanExpiredEvents() {
  console.log('🧹 Cleaning expired events...\n');
  
  try {
    const data = await fs.readFile(MANUAL_EVENTS_FILE, 'utf-8');
    const manualEvents = JSON.parse(data);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const originalCount = manualEvents.events.length;
    manualEvents.events = manualEvents.events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= today;
    });
    
    const removedCount = originalCount - manualEvents.events.length;
    
    if (removedCount > 0) {
      manualEvents.lastUpdated = new Date().toISOString().split('T')[0];
      await fs.writeFile(MANUAL_EVENTS_FILE, JSON.stringify(manualEvents, null, 2));
      console.log(`🗑️ Removed ${removedCount} expired events`);
    } else {
      console.log('✅ No expired events to remove');
    }
    
    return { removed: removedCount, remaining: manualEvents.events.length };
    
  } catch (error) {
    console.error('❌ Error cleaning events:', error.message);
    return { removed: 0, error: error.message };
  }
}

export { validateAllEvents, cleanExpiredEvents };

if (import.meta.url === `file://${process.argv[1]}`) {
  validateAllEvents()
    .then(result => {
      console.log('\n📝 Full result:', JSON.stringify(result, null, 2));
    })
    .catch(console.error);
}
