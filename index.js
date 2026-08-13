import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import compression from 'compression';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pg from 'pg';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import * as cheerio from 'cheerio';
import { requireApplicationsAccess } from './utils/applicationsAccess.js';

dotenv.config();

// PostgreSQL session store
const PGStore = pgSession(session);
const sessionPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

// Configure email transporter
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'theblackroom.us@gmail.com',
    pass: process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS
  },
  secure: true,
  port: 465
});

// Verify email configuration
emailTransporter.verify(function(error, success) {
  if (error) {
    console.log('âŒ Email configuration error:', error.message);
  } else {
    console.log('âœ… Email transporter ready for order notifications');
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

console.log(`ðŸ”§ Configuring server on port: ${PORT}`);
console.log(`ðŸ” process.env.PORT: ${process.env.PORT}`);
console.log(`ðŸŒ Server will bind to: 0.0.0.0:${PORT}`);
console.log(`ðŸŒ Domain: blackroomus.com`);

// Check database connection
import('./database/connection.js').then(async ({ default: pool }) => {
  try {
    const client = await pool.connect();
    console.log('âœ… PostgreSQL connected successfully');
    console.log('ðŸ”— Database URL configured:', !!process.env.DATABASE_URL ? 'Yes' : 'No');
    client.release();
  } catch (error) {
    console.error('âŒ Error connecting to PostgreSQL:', error.message);
    console.log('ðŸ’¡ Please make sure you have created a PostgreSQL database in Replit');
    console.log('ðŸ’¡ Go to Database tab and create a PostgreSQL database');
  }
}).catch(error => {
  console.error('âŒ Error importing database connection:', error.message);
});

// Middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// No cache for HTML files (force browser to get latest version)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Servir archivos estÃ¡ticos
app.use(express.static(path.join(__dirname, 'public')));

// Servir imÃ¡genes de productos con headers correctos
app.use('/images/product-images', express.static(path.join(__dirname, 'public/images/product-images'), {
  setHeaders: (res, path) => {
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache por 1 aÃ±o
  }
}));

// Trust proxy for secure cookies behind Replit's proxy
app.set('trust proxy', 1);

// Session configuration - persistent login (30 days) with PostgreSQL store
// Replit always uses HTTPS via proxy, so we force secure cookies
console.log('ðŸ”§ Session config - Replit HTTPS mode (forced)');
console.log('ðŸ”§ Session store: PostgreSQL (persistent)');
console.log('ðŸª Cookie: secure=true, sameSite=none (for iframe support)');
app.use(session({
  store: new PGStore({
    pool: sessionPool,
    tableName: 'session',
    pruneSessionInterval: 60 * 15 // Prune expired sessions every 15 min
  }),
  secret: process.env.SESSION_SECRET || 'blackroom-secret-key-2024',
  resave: false, // PostgreSQL store handles this
  saveUninitialized: false,
  rolling: true, // Reset expiry on each request
  cookie: {
    secure: true, // Always true - Replit proxy handles HTTPS
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'none', // Required for cross-site cookies in iframes
    path: '/'
  },
  proxy: true,
  name: 'blackroom.sid' // Custom session ID name
}));

// CORS and CSP headers
app.use((req, res, next) => {
  const allowedOrigins = ['*', 'https://blackroomus.com', 'https://www.blackroomus.com'];
  const origin = req.headers.origin;

  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Content Security Policy - Updated to allow Stripe
  res.header('Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com https://www.googleapis.com https://i.ytimg.com https://youtube.com https://www.youtube.com https://js.stripe.com https://checkout.stripe.com; " +
    "img-src 'self' data: blob: https: http: https://files.stripe.com; " +
    "connect-src 'self' https://www.googleapis.com https://googleapis.com https://api.stripe.com https://checkout.stripe.com; " +
    "media-src 'self' https: http: data: blob:; " +
    "frame-src 'self' https://www.youtube.com https://youtube.com https://checkout.stripe.com https://js.stripe.com;"
  );

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// CORS for frontend requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  next();
});

// Cleanup expired event images every 6 hours
import EventImageManager from './utils/eventImageManager.js';
const imageManager = new EventImageManager();

setInterval(async () => {
  console.log('ðŸ§¹ Ejecutando limpieza automÃ¡tica de imÃ¡genes de eventos...');
  await imageManager.cleanupExpiredImages();
}, 6 * 60 * 60 * 1000); // 6 horas

// Cleanup on startup
setTimeout(async () => {
  console.log('ðŸ§¹ Limpieza inicial de imÃ¡genes de eventos...');
  await imageManager.cleanupExpiredImages();
}, 30000); // 30 segundos despuÃ©s del inicio

// Define paths
const usersFile = path.join(__dirname, "db/users.json");

// Import routes
import registerRouter from './routes/register.js';
import loginRouter from './routes/login.js';
import logoutRouter from './routes/logout.js';
import profileRouter from './routes/profile.js';
import likesRouter from './routes/likes.js';
import ordersRouter from './routes/orders.js';
import adminRouter from './routes/admin.js';
import eventsRouter from './routes/events.js';
import shopRouter from './routes/shop.js';
import videosRouter from './routes/videos.js';
import ticketQrRouter from './routes/ticket-qr.js';
import registerAcademyRouter from './routes/register-academy.js';
import playlistsRouter from './routes/playlists.js';
import adminTokensRouter from './routes/admin-tokens.js';
import claimRouter from './routes/claim.js';
import tokensRouter from './routes/tokens.js';
import trackingRouter from './routes/tracking.js';
import adminStatsRouter from './routes/admin-stats.js';
import communityRouter from './routes/community.js';
import communityAdminRouter from './routes/community-admin.js';
import uploadRouter from './routes/upload.js';
import youtubeCalendarSyncRouter from './routes/youtube-calendar-sync.js';
import autoSyncRouter from './routes/auto-sync.js';
import {
  addManualEvent,
  extractEventFromLink,
  markDraftConfirmed,
  readEventDraft,
  saveEventDraft
} from './utils/eventLinkAssistant.js';

// Use routes
app.use('/api/register', registerRouter);
app.use('/api/login', loginRouter);
app.use('/api/logout', logoutRouter);
app.use('/api/profile', profileRouter);
app.use('/api/like', likesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/admin', adminRouter); // Direct admin routes for file uploads
// IMPORTANT: Order matters! Specific routes must come BEFORE wildcards
// /api/events is handled separately below (line ~1799) to return ALL events for calendar
app.use('/events', eventsRouter); // Returns filtered Posh.vip events for events.html
app.use('/api/tracking', trackingRouter); // User tracking API
app.use('/api/admin/stats', adminStatsRouter); // Admin statistics API
app.use('/api/community', communityRouter); // Community system API
app.use('/api/community/admin', communityAdminRouter); // Community admin API
app.use('/api/upload', uploadRouter); // File upload API
app.use('/api/youtube-calendar-sync', youtubeCalendarSyncRouter); // YouTube to Calendar sync
app.use('/api/auto-sync', autoSyncRouter); // Auto sync every Thursday 8PM
// Shop route is removed as per the request to disable the shop functionality
// app.use('/api/shop', shopRouter);

// Note: /api/profile is handled by profileRouter above

// Import Object Storage
import { Client } from '@replit/object-storage';
const objectStorage = new Client();

// API endpoint to serve images from Object Storage
app.get('/api/storage/*', async (req, res) => {
  try {
    const filePath = req.params[0]; // Get the path after '/api/storage/'
    console.log(`ðŸ“ Requesting file from Object Storage: ${filePath}`);

    const objectStorage = new Client();

    // Try to download the file
    let fileBuffer;
    try {
      console.log(`ðŸ” Attempting to download: ${filePath}`);
      fileBuffer = await objectStorage.downloadAsBytes(filePath);
      console.log(`âœ… Successfully downloaded: ${filePath}`);
    } catch (downloadError) {
      console.log(`âŒ Failed to download ${filePath}:`, downloadError.message);

      // Get filename for fallback attempts
      const filename = path.basename(filePath);
      let foundInFallback = false;

      // If file not found and it's a product-images request, try batch-images as fallback
      if (filePath.startsWith('product-images/') && downloadError.message?.includes('404')) {
        const batchPath = `batch-images/${filename}`;
        console.log(`ðŸ”„ Product image not found, trying batch path: ${batchPath}`);

        try {
          fileBuffer = await objectStorage.downloadAsBytes(batchPath);
          console.log(`âœ… Found image in batch-images folder: ${batchPath}`);
          foundInFallback = true;
        } catch (batchError) {
          console.log(`âŒ Image not found in batch-images either: ${batchPath}`);
        }
      }
      // If batch-images not found, try product-images as fallback
      else if (filePath.startsWith('batch-images/') && downloadError.message?.includes('404')) {
        const productPath = `product-images/${filename}`;
        console.log(`ðŸ”„ Batch image not found, trying product path: ${productPath}`);

        try {
          fileBuffer = await objectStorage.downloadAsBytes(productPath);
          console.log(`âœ… Found image in product-images folder: ${productPath}`);
          foundInFallback = true;
        } catch (productError) {
          console.log(`âŒ Image not found in product-images either: ${productPath}`);
        }
      }

      // If no fallback worked, throw the original error
      if (!foundInFallback) {
        throw downloadError;
      }
    }

    // Set appropriate content type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(fileBuffer);

  } catch (error) {
    console.error(`âŒ Error serving file ${req.params[0]}:`, error);

    // Fallback to default image
    if (req.params[0] !== 'images/logo.png') {
      console.log('ðŸ”„ Redirecting to default logo...');
      return res.redirect('/api/storage/images/logo.png');
    }

    res.status(404).json({ error: 'File not found' });
  }
});

// Helper function to serve default image
function serveDefaultImage(res) {
  try {
    const defaultImagePath = path.join(__dirname, 'public/images/logo.png');

    if (fs.existsSync(defaultImagePath)) {
      console.log('ðŸ”„ Serving default image: logo.png');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Image-Source', 'default-logo');
      return res.sendFile(defaultImagePath);
    } else {
      console.error('âŒ Default image not found at:', defaultImagePath);

      // Try to serve a placeholder image
      const placeholderSvg = `
        <svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#000000"/>
          <text x="50%" y="50%" font-family="Arial" font-size="20" fill="#ffffff" text-anchor="middle" dy="0.3em">
            Black Room
          </text>
        </svg>
      `;

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Image-Source', 'generated-placeholder');
      return res.send(placeholderSvg);
    }
  } catch (error) {
    console.error('âŒ Error serving default image:', error.message);

    // Last resort - simple text response
    res.setHeader('Content-Type', 'text/plain');
    return res.status(500).send('Image not available');
  }
}


app.use('/api/videos', videosRouter);
app.use('/api/ticket-qr', ticketQrRouter);
// Legacy unpaid academy registration disabled â€” enrollment now requires Stripe payment
// (see /api/course-checkout and /api/verify-course-payment). Kept mounted but blocked.
app.use('/api/register-academy', (req, res) => {
  return res.status(410).json({ success: false, message: 'Academy enrollment now requires payment. Please use the checkout.' });
});
app.use('/api/playlists', playlistsRouter);

// Use routes for tokens
app.use('/admin/tokens', adminTokensRouter);
app.use('/claim', claimRouter);
app.use('/', tokensRouter);

// Token API routes
app.use('/api/tokens', tokensRouter);

// Import test extraction route
import testExtractionRouter from './routes/test-extraction.js';
app.use('/api/extract', testExtractionRouter);

// Endpoint de extracciÃ³n completa de eventos
app.post('/api/admin/extract-complete-event', async (req, res) => {
  try {
    console.log('ðŸ” Complete event extraction request received');
    console.log('ðŸ“¤ Request body:', JSON.stringify(req.body, null, 2));

    // Usar la misma lÃ³gica del endpoint de extracciÃ³n de imagen
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL requerida para extraer informaciÃ³n del evento'
      });
    }

    // Llamar al endpoint de extracciÃ³n de imagen internamente
    const imageExtractionResult = await fetch(`http://localhost:${PORT}/api/extract-event-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const imageData = await imageExtractionResult.json();

    if (!imageData.success) {
      return res.json({
        success: false,
        error: imageData.error || 'No se pudo extraer la informaciÃ³n del evento'
      });
    }

    // Crear respuesta completa
    const completeEventData = {
      title: imageData.eventInfo?.title || 'Evento sin tÃ­tulo',
      description: imageData.eventInfo?.description || 'Sin descripciÃ³n disponible',
      image: imageData.imageUrl,
      date: 'Por definir',
      location: 'Por definir', 
      price: 'Consultar precio',
      ticketLink: url
    };

    res.json({
      success: true,
      data: completeEventData
    });

  } catch (error) {
    console.error('âŒ Complete event extraction error:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al extraer informaciÃ³n completa del evento'
    });
  }
});


// Authentication routes handled by routes/login.js and routes/logout.js





// Endpoint para obtener la publishable key de Stripe
app.get('/api/stripe-config', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (!publishableKey) {
    console.error('âŒ STRIPE_PUBLISHABLE_KEY not configured');
    return res.status(500).json({ 
      error: 'Stripe publishable key not configured' 
    });
  }

  console.log('ðŸ”‘ Providing Stripe config, key starts with:', publishableKey.substring(0, 20) + '...');

  res.json({
    publishableKey: publishableKey
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const { category } = req.query;

    console.log('ðŸ“¦ Loading products from all sources...');

    // Load Stripe products
    let stripeProducts = [];
    try {
      const products = await stripe.products.list({
        limit: 100,
        active: true,
        expand: ['data.default_price']
      });

      stripeProducts = products.data
        .filter(product => {
          const category = (product.metadata?.category || '').toLowerCase();
          const nameLower = product.name.toLowerCase();
          const price = product.default_price;
          const priceAmount = price ? (price.unit_amount / 100) : 0;
          
          // Filter out events, tickets, and test products
          return category !== 'tickets' &&
                 category !== 'events' &&
                 !nameLower.includes('event') &&
                 !nameLower.includes('ticket') &&
                 !nameLower.includes('rave') &&
                 !nameLower.includes('prueba') &&
                 !nameLower.includes('test') &&
                 priceAmount >= 1;
        })
        .map(product => {
          const price = product.default_price;
          const priceAmount = price ? (price.unit_amount / 100) : 0;
          
          // Map local images based on product name
          const localImageMap = {
            'red room': { front: '/images/products/red-room-front.jpg', back: '/images/products/red-room-back.jpg' },
            'electric': { front: '/images/products/electric-front.jpg', back: '/images/products/electric-back.jpg' },
            'phoenix': { front: '/images/products/phoenix-front.jpg', back: '/images/products/phoenix-back.jpg' },
            'time less': { front: '/images/products/timeless-front.jpg', back: '/images/products/timeless-back.png' },
            'timeless': { front: '/images/products/timeless-front.jpg', back: '/images/products/timeless-back.png' }
          };
          
          const productNameLower = product.name.toLowerCase();
          let localImages = null;
          for (const [key, images] of Object.entries(localImageMap)) {
            if (productNameLower.includes(key)) {
              localImages = images;
              break;
            }
          }

          return {
            i…54117 tokens truncated…name; } catch(e) {}
    }
    
    // Get geo location
    let country = null, city = null, region = null;
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,regionName`);
      const geo = await geoRes.json();
      if (geo.country) { country = geo.country; city = geo.city; region = geo.regionName; }
    } catch(e) {}
    
    await pool.query(
      `INSERT INTO page_views (page_url, page_title, session_id, ip_address, device_type, browser, referrer_url, referrer_domain, screen_width, screen_height, language, timezone, country, city, region, os, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)`,
      [page_url, page_title, session_id, ip, device_type, browser, referrer, referrer_domain, screen_width, screen_height, language, timezone, country, city, region, os]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking pageview:', error);
    res.status(500).json({ error: 'Error tracking' });
  }
});

// Update time on page
app.post('/api/analytics/pageview/update', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { session_id, page_url, time_spent, scroll_depth } = req.body;
    
    await pool.query(
      `UPDATE page_views SET time_spent_seconds = $1, scroll_depth = $2 
       WHERE session_id = $3 AND page_url = $4 
       AND timestamp = (SELECT MAX(timestamp) FROM page_views WHERE session_id = $3 AND page_url = $4)`,
      [time_spent, scroll_depth, session_id, page_url]
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error updating' });
  }
});

// Track shop event
app.post('/api/analytics/shop', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { event_type, product_id, product_name, product_price, product_size, quantity, session_id, referrer_domain } = req.body;
    
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    
    let device_type = 'desktop';
    if (/mobile/i.test(ua)) device_type = 'mobile';
    else if (/tablet|ipad/i.test(ua)) device_type = 'tablet';
    
    let browser = 'Unknown';
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    
    let country = null, city = null;
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,city`);
      const geo = await geoRes.json();
      if (geo.country) { country = geo.country; city = geo.city; }
    } catch(e) {}
    
    await pool.query(
      `INSERT INTO shop_events (event_type, product_id, product_name, product_price, product_size, quantity, session_id, ip_address, country, city, device_type, browser, referrer_domain)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [event_type, product_id, product_name, product_price, product_size, quantity || 1, session_id, ip, country, city, device_type, browser, referrer_domain]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking shop event:', error);
    res.status(500).json({ error: 'Error tracking' });
  }
});

// Track video event
app.post('/api/analytics/video', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { event_type, video_id, video_title, video_duration, watch_time, watch_percentage, session_id } = req.body;
    
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    let device_type = 'desktop';
    if (/mobile/i.test(ua)) device_type = 'mobile';
    else if (/tablet|ipad/i.test(ua)) device_type = 'tablet';
    
    await pool.query(
      `INSERT INTO video_events (event_type, video_id, video_title, video_duration, watch_time, watch_percentage, session_id, ip_address, device_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [event_type, video_id, video_title, video_duration, watch_time || 0, watch_percentage || 0, session_id, ip, device_type]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking video:', error);
    res.status(500).json({ error: 'Error tracking' });
  }
});

// ============================================
// ADMIN ANALYTICS DASHBOARD ENDPOINTS
// ============================================

// Get page analytics overview
app.get('/api/admin/analytics/pages', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const days = parseInt(req.query.days) || 30;
    
    const result = await pool.query(`
      SELECT 
        page_url,
        page_title,
        COUNT(*) as views,
        COUNT(DISTINCT session_id) as unique_visitors,
        COUNT(DISTINCT ip_address) as unique_ips,
        ROUND(AVG(COALESCE(time_spent_seconds, 0))) as avg_time,
        ROUND(AVG(COALESCE(scroll_depth, 0))) as avg_scroll
      FROM page_views
      WHERE timestamp > NOW() - INTERVAL '${days} days'
      GROUP BY page_url, page_title
      ORDER BY views DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting page analytics:', error);
    res.status(500).json({ error: 'Error getting analytics' });
  }
});

// Get page analytics summary
app.get('/api/admin/analytics/pages/summary', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    
    const totals = await pool.query(`
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT session_id) as unique_sessions,
        COUNT(DISTINCT ip_address) as unique_visitors
      FROM page_views
    `);
    
    const today = await pool.query(`
      SELECT COUNT(*) as views FROM page_views WHERE timestamp::date = CURRENT_DATE
    `);
    
    const week = await pool.query(`
      SELECT COUNT(*) as views FROM page_views WHERE timestamp > NOW() - INTERVAL '7 days'
    `);
    
    const devices = await pool.query(`
      SELECT device_type, COUNT(*) as count FROM page_views 
      WHERE timestamp > NOW() - INTERVAL '30 days'
      GROUP BY device_type ORDER BY count DESC
    `);
    
    const countries = await pool.query(`
      SELECT country, COUNT(*) as count FROM page_views 
      WHERE timestamp > NOW() - INTERVAL '30 days' AND country IS NOT NULL
      GROUP BY country ORDER BY count DESC LIMIT 10
    `);
    
    const hourly = await pool.query(`
      SELECT EXTRACT(HOUR FROM timestamp) as hour, COUNT(*) as count 
      FROM page_views WHERE timestamp > NOW() - INTERVAL '30 days'
      GROUP BY hour ORDER BY hour
    `);
    
    res.json({
      total_views: parseInt(totals.rows[0].total_views),
      unique_sessions: parseInt(totals.rows[0].unique_sessions),
      unique_visitors: parseInt(totals.rows[0].unique_visitors),
      today_views: parseInt(today.rows[0].views),
      week_views: parseInt(week.rows[0].views),
      devices: devices.rows,
      countries: countries.rows,
      hourly: hourly.rows
    });
  } catch (error) {
    console.error('Error getting page summary:', error);
    res.status(500).json({ error: 'Error getting summary' });
  }
});

// Get daily page views for chart
app.get('/api/admin/analytics/pages/daily', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const allowedDays = [7, 14, 30, 60, 90];
    let days = parseInt(req.query.days) || 14;
    if (!allowedDays.includes(days)) days = 14;
    
    const result = await pool.query(`
      SELECT 
        timestamp::date as view_date,
        COUNT(*) as views,
        COUNT(DISTINCT ip_address) as unique_visitors
      FROM page_views 
      WHERE timestamp > NOW() - INTERVAL '1 day' * $1
      GROUP BY timestamp::date 
      ORDER BY view_date ASC
    `, [days]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting daily stats:', error);
    res.status(500).json({ error: 'Error getting daily stats' });
  }
});

// Get detailed page views
app.get('/api/admin/analytics/pages/detailed', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const limit = parseInt(req.query.limit) || 100;
    const page = req.query.page_url || null;
    
    let query = `
      SELECT * FROM page_views 
      ${page ? "WHERE page_url = $1" : ""}
      ORDER BY timestamp DESC LIMIT ${limit}
    `;
    
    const result = await pool.query(query, page ? [page] : []);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error getting data' });
  }
});

// Get shop analytics overview
app.get('/api/admin/analytics/shop', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const days = parseInt(req.query.days) || 30;
    
    const products = await pool.query(`
      SELECT 
        product_id,
        product_name,
        COUNT(*) FILTER (WHERE event_type = 'view_product') as views,
        COUNT(*) FILTER (WHERE event_type = 'add_to_cart') as add_to_cart,
        COUNT(*) FILTER (WHERE event_type = 'remove_from_cart') as removed,
        COUNT(*) FILTER (WHERE event_type = 'checkout_start') as checkouts
      FROM shop_events
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY product_id, product_name
      ORDER BY views DESC
    `);
    
    const sizes = await pool.query(`
      SELECT product_size, COUNT(*) as count FROM shop_events 
      WHERE event_type = 'add_to_cart' AND created_at > NOW() - INTERVAL '${days} days' AND product_size IS NOT NULL
      GROUP BY product_size ORDER BY count DESC
    `);
    
    const eventCounts = await pool.query(`
      SELECT event_type, COUNT(*) as count FROM shop_events
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY event_type
    `);
    
    res.json({
      products: products.rows,
      sizes: sizes.rows,
      events: eventCounts.rows
    });
  } catch (error) {
    console.error('Error getting shop analytics:', error);
    res.status(500).json({ error: 'Error getting analytics' });
  }
});

// Get shop analytics summary
app.get('/api/admin/analytics/shop/summary', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    
    const totals = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'view_product') as total_views,
        COUNT(*) FILTER (WHERE event_type = 'add_to_cart') as total_add_to_cart,
        COUNT(*) FILTER (WHERE event_type = 'checkout_start') as total_checkouts,
        COUNT(DISTINCT session_id) as unique_shoppers
      FROM shop_events
    `);
    
    const today = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'view_product') as views,
        COUNT(*) FILTER (WHERE event_type = 'add_to_cart') as add_to_cart
      FROM shop_events WHERE created_at::date = CURRENT_DATE
    `);
    
    const topProduct = await pool.query(`
      SELECT product_name, COUNT(*) as views FROM shop_events 
      WHERE event_type = 'view_product' GROUP BY product_name ORDER BY views DESC LIMIT 1
    `);
    
    res.json({
      ...totals.rows[0],
      today_views: parseInt(today.rows[0].views) || 0,
      today_add_to_cart: parseInt(today.rows[0].add_to_cart) || 0,
      top_product: topProduct.rows[0]?.product_name || 'N/A'
    });
  } catch (error) {
    console.error('Error getting shop summary:', error);
    res.status(500).json({ error: 'Error getting summary' });
  }
});

// Get detailed shop events
app.get('/api/admin/analytics/shop/detailed', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const limit = parseInt(req.query.limit) || 100;
    const product = req.query.product_id || null;
    const eventType = req.query.event_type || null;
    
    let conditions = [];
    let params = [];
    let paramIndex = 1;
    
    if (product) { conditions.push(`product_id = $${paramIndex++}`); params.push(product); }
    if (eventType) { conditions.push(`event_type = $${paramIndex++}`); params.push(eventType); }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const result = await pool.query(
      `SELECT * FROM shop_events ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error getting data' });
  }
});

// Get video analytics
app.get('/api/admin/analytics/videos', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const days = parseInt(req.query.days) || 30;
    
    const videos = await pool.query(`
      SELECT 
        video_id,
        video_title,
        COUNT(*) FILTER (WHERE event_type = 'play') as plays,
        COUNT(*) FILTER (WHERE event_type = 'complete') as completions,
        ROUND(AVG(watch_percentage)) as avg_watch_percent,
        SUM(watch_time) as total_watch_time
      FROM video_events
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY video_id, video_title
      ORDER BY plays DESC
    `);
    
    const summary = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'play') as total_plays,
        COUNT(DISTINCT video_id) as unique_videos,
        SUM(watch_time) as total_watch_time
      FROM video_events
      WHERE created_at > NOW() - INTERVAL '${days} days'
    `);
    
    res.json({
      videos: videos.rows,
      summary: summary.rows[0]
    });
  } catch (error) {
    console.error('Error getting video analytics:', error);
    res.status(500).json({ error: 'Error getting analytics' });
  }
});

// Get all analytics for export
app.get('/api/admin/analytics/export/:type', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { type } = req.params;
    const limit = parseInt(req.query.limit) || 10000;
    
    let result;
    switch(type) {
      case 'pages':
        result = await pool.query(`SELECT * FROM page_views ORDER BY timestamp DESC LIMIT ${limit}`);
        break;
      case 'shop':
        result = await pool.query(`SELECT * FROM shop_events ORDER BY created_at DESC LIMIT ${limit}`);
        break;
      case 'videos':
        result = await pool.query(`SELECT * FROM video_events ORDER BY created_at DESC LIMIT ${limit}`);
        break;
      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error exporting data' });
  }
});

app.get('*', (req, res) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    const filePath = path.join(__dirname, 'public', req.path);
    const filePathHtml = path.join(__dirname, 'public', req.path + '.html');
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.sendFile(filePath);
    } else if (fs.existsSync(filePathHtml) && fs.statSync(filePathHtml).isFile()) {
      res.sendFile(filePathHtml);
    } else {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  }
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('âŒ Express Error:', err.stack || err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Old Posh automatic scraper disabled. Kong sync is handled by routes/auto-sync.js.

async function handleAdminKongScrape(req, res) {
  const scraper = await loadKongScraper();
  if (!scraper) {
    return res.status(500).json({ success: false, error: 'Kong scraper not available' });
  }
  await scraper.scrapeKongEvents();
  const cachePath = path.join(__dirname, 'db/kong-events-cache.json');
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf-8')) : {};
  res.json({ success: true, eventCount: cache.eventCount || 0 });
}

app.post('/api/admin/scrape-kong', handleAdminKongScrape);
app.post('/api/admin/scrape-posh', handleAdminKongScrape);

// Ensure required tables/columns exist (safe to run every startup)
async function ensureSchema() {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_email_log (
        stripe_session_id VARCHAR(255) PRIMARY KEY,
        customer_email VARCHAR(255),
        amount NUMERIC,
        sent_at TIMESTAMP DEFAULT now()
      )
    `);
    await pool.query(`
      ALTER TABLE academy_registrations
        ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS paid BOOLEAN DEFAULT false
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS academy_stripe_session_uidx
        ON academy_registrations(stripe_session_id)
        WHERE stripe_session_id IS NOT NULL
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS argentina_applications (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        instagram VARCHAR(100) NOT NULL,
        email VARCHAR(254) NOT NULL,
        genres VARCHAR(180) NOT NULL,
        set_url TEXT NOT NULL,
        interest VARCHAR(500) NOT NULL,
        contacted BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS label_applications (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NOT NULL,
        email VARCHAR(254) NOT NULL,
        artist_name VARCHAR(120) NOT NULL,
        instagram VARCHAR(120) NOT NULL,
        soundcloud_url TEXT NOT NULL,
        track_url TEXT NOT NULL,
        contacted BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    console.log('âœ… Schema ensured (order_email_log, academy payment columns, argentina_applications, label_applications)');
  } catch (err) {
    console.error('âš ï¸ ensureSchema failed:', err.message);
  }
}
ensureSchema();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`ðŸš€ Black Room Server started on port: ${PORT}`);
  console.log(`ðŸ“± Local access: http://localhost:${PORT}`);
  console.log(`ðŸŒ External access: Available on 0.0.0.0:${PORT}`);
  console.log(`ðŸŒ Custom domain: blackroomus.com configured`);
  console.log(`âœ… Server ready for external connections`);
  console.log(`âš¡ Server listening successfully at ${new Date().toISOString()}`);
});

server.on('error', (error) => {
  console.error('âŒ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`âŒ Port ${PORT} is already in use`);
  }
});

process.on('uncaughtException', (error) => {
  console.error('âŒ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('âŒ Unhandled Rejection at:', promise, 'reason:', reason);
});

