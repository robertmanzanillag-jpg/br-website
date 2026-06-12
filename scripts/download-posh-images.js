import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadImage = async (url, filepath) => {
  try {
    console.log(`   📥 Downloading from: ${url}`);
    
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*',
        'Referer': 'https://posh.vip/'
      },
      timeout: 30000
    });

    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filepath, response.data);
    console.log(`   ✅ Saved: ${filepath}`);
    return true;

  } catch (error) {
    console.error(`   ❌ Download error: ${error.message}`);
    return false;
  }
};

const scrapeEventImages = async (eventUrl, eventId) => {
  console.log(`\n🔍 Opening: ${eventUrl}`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('   ⏳ Loading page (this may take a moment)...');
    await page.goto(eventUrl, { 
      waitUntil: 'networkidle0',
      timeout: 45000 
    });

    await page.waitForTimeout(3000);

    console.log('   📸 Extracting images...');
    const images = await page.evaluate(() => {
      const imageElements = [];
      
      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.src.startsWith('http')) {
          const isLogo = (img.alt || '').toLowerCase().includes('logo') || 
                        img.src.toLowerCase().includes('logo');
          const isIcon = (img.alt || '').toLowerCase().includes('icon');
          
          if (!isLogo && !isIcon) {
            imageElements.push({
              src: img.src,
              alt: img.alt || '',
              width: img.naturalWidth || 0,
              height: img.naturalHeight || 0
            });
          }
        }
      });

      const metaOg = document.querySelector('meta[property="og:image"]');
      if (metaOg && metaOg.content) {
        imageElements.unshift({
          src: metaOg.content,
          alt: 'Event Cover',
          width: 1200,
          height: 630,
          priority: true
        });
      }

      return imageElements;
    });

    console.log(`   📊 Found ${images.length} potential images`);

    if (images.length === 0) {
      console.log('   ⚠️ No images found on page');
      await browser.close();
      return [];
    }

    const validImages = images
      .filter(img => img.width > 200 && img.height > 200)
      .sort((a, b) => {
        if (a.priority) return -1;
        if (b.priority) return 1;
        return (b.width * b.height) - (a.width * a.height);
      });

    if (validImages.length === 0) {
      console.log('   ⚠️ No valid images (all too small)');
      await browser.close();
      return [];
    }

    const topImage = validImages[0];
    console.log(`   🎯 Best image: ${topImage.width}x${topImage.height}px`);

    const imageExtension = topImage.src.split('.').pop().split('?')[0].toLowerCase() || 'jpg';
    const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    const finalExtension = validExtensions.includes(imageExtension) ? imageExtension : 'jpg';
    
    const localImagePath = `public/images/events/${eventId}.${finalExtension}`;
    const absolutePath = path.join(__dirname, '..', localImagePath);

    const success = await downloadImage(topImage.src, absolutePath);

    await browser.close();

    if (success) {
      return [{
        url: topImage.src,
        localPath: `/images/events/${eventId}.${finalExtension}`
      }];
    }

    return [];

  } catch (error) {
    console.error(`   ❌ Scraping error: ${error.message}`);
    if (browser) {
      await browser.close();
    }
    return [];
  }
};

const updateEventsWithImages = async () => {
  console.log('🎯 BLACK ROOM - Posh.vip Image Downloader');
  console.log('═'.repeat(60));

  const eventsPath = path.join(__dirname, '../db/events.json');
  const eventsData = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

  const poshEvents = eventsData.filter(e => e.type === 'live-event' && e.poshvipUrl);
  console.log(`\n📋 Found ${poshEvents.length} Posh.vip events to process\n`);

  let updated = 0;

  for (const event of poshEvents) {
    console.log(`${'='.repeat(60)}`);
    console.log(`📅 ${event.title}`);

    const images = await scrapeEventImages(event.poshvipUrl, event.id);

    if (images.length > 0) {
      event.image = images[0].localPath;
      event.imageUrl = images[0].url;
      updated++;
      console.log(`   ✅ Image added: ${event.image}`);
    } else {
      console.log(`   ⚠️ No image could be downloaded`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  fs.writeFileSync(eventsPath, JSON.stringify(eventsData, null, 2));
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ COMPLETE! Successfully updated ${updated}/${poshEvents.length} events`);
  console.log(`📁 Updated: db/events.json`);
  console.log(`\n🎨 Images saved to: public/images/events/`);
};

updateEventsWithImages().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
