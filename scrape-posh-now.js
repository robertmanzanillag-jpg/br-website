import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function scrapeGroupPage() {
  console.log('🚀 Launching Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
           '--disable-software-rasterizer','--disable-extensions','--disable-background-networking']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    console.log('📄 Navigating to posh.vip/g/black-room ...');
    await page.goto('https://posh.vip/g/black-room', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for event cards to render
    console.log('⏳ Waiting for JS to render events...');
    await new Promise(r => setTimeout(r, 6000));

    // Extract all event links and info
    const events = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Look for any anchor linking to an event page
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        if (!href.includes('/e/')) return;
        if (seen.has(href)) return;
        seen.add(href);

        // Walk up to find the card container
        let card = a;
        for (let i = 0; i < 6; i++) {
          if (card.parentElement) card = card.parentElement;
        }

        const text = card.innerText || a.innerText || '';
        const img = card.querySelector('img');
        const image = img ? (img.src || img.dataset.src || '') : '';

        results.push({
          poshUrl: href,
          rawText: text.trim().substring(0, 400),
          image
        });
      });

      return results;
    });

    console.log(`🔗 Found ${events.length} event links`);

    if (events.length === 0) {
      // Dump page structure for debugging
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
      console.log('Page title:', title);
      console.log('Body preview:', bodyText);
      await browser.close();
      return;
    }

    // Now visit each event page to get full details
    const detailed = [];
    for (const ev of events) {
      console.log(`\n📌 Visiting: ${ev.poshUrl}`);
      try {
        const ep = await browser.newPage();
        await ep.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36');
        await ep.goto(ev.poshUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2500));

        const info = await ep.evaluate(() => {
          const getText = sel => {
            const el = document.querySelector(sel);
            return el ? el.innerText.trim() : '';
          };

          // Title
          const title = getText('h1') || document.title.split('|')[0].trim();

          // Date — look for structured data first
          let date = '';
          let dateText = '';
          const ldJson = document.querySelector('script[type="application/ld+json"]');
          if (ldJson) {
            try {
              const data = JSON.parse(ldJson.textContent);
              const items = Array.isArray(data) ? data : [data];
              for (const item of items) {
                if (item.startDate) { date = item.startDate; break; }
              }
            } catch {}
          }

          // Fallback: scrape visible date text
          const body = document.body.innerText;
          const dateMatch = body.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i);
          if (dateMatch) dateText = dateMatch[0];

          // Image
          const ogImage = document.querySelector('meta[property="og:image"]');
          const image = ogImage ? ogImage.content : (document.querySelector('img[src*="posh"]')?.src || '');

          // Venue / location
          const ogDescription = document.querySelector('meta[property="og:description"]');
          const description = ogDescription ? ogDescription.content : '';

          // Price
          const priceMatch = body.match(/\$\d+(\.\d{2})?/);
          const price = priceMatch ? priceMatch[0] : '$25+';

          // Venue name
          let venue = 'Miami, FL';
          const venueMatch = body.match(/(?:at|@)\s+([A-Z][^,\n]{2,40})/);
          if (venueMatch) venue = venueMatch[1].trim();

          return { title, date, dateText, image, venue, price, description };
        });

        console.log(`  ✅ ${info.title} | ${info.date || info.dateText} | ${info.venue} | ${info.price}`);
        console.log(`     Image: ${info.image.substring(0, 80)}`);

        detailed.push({
          title: info.title,
          date: info.date ? info.date.split('T')[0] : '',
          dateText: info.dateText || info.date,
          image: info.image || ev.image,
          venue: info.venue,
          location: 'Miami, FL',
          price: info.price,
          description: info.description,
          poshUrl: ev.poshUrl,
          source: 'puppeteer-scrape',
          scrapedAt: new Date().toISOString()
        });

        await ep.close();
      } catch (err) {
        console.error(`  ❌ Error on ${ev.poshUrl}:`, err.message);
      }
    }

    // Save to cache
    const cachePath = path.join(__dirname, 'db/posh-events-cache.json');
    const cache = {
      lastUpdated: new Date().toISOString(),
      eventCount: detailed.length,
      events: detailed
    };
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    console.log(`\n✅ Saved ${detailed.length} events to posh-events-cache.json`);
    console.log(JSON.stringify(detailed, null, 2));

  } finally {
    await browser.close();
  }
}

scrapeGroupPage().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
