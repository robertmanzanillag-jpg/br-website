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
    console.log('❌ Email configuration error:', error.message);
  } else {
    console.log('✅ Email transporter ready for order notifications');
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

console.log(`🔧 Configuring server on port: ${PORT}`);
console.log(`🔍 process.env.PORT: ${process.env.PORT}`);
console.log(`🌐 Server will bind to: 0.0.0.0:${PORT}`);
console.log(`🌍 Domain: blackroomus.com`);

// Check database connection
import('./database/connection.js').then(async ({ default: pool }) => {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected successfully');
    console.log('🔗 Database URL configured:', !!process.env.DATABASE_URL ? 'Yes' : 'No');
    client.release();
  } catch (error) {
    console.error('❌ Error connecting to PostgreSQL:', error.message);
    console.log('💡 Please make sure you have created a PostgreSQL database in Replit');
    console.log('💡 Go to Database tab and create a PostgreSQL database');
  }
}).catch(error => {
  console.error('❌ Error importing database connection:', error.message);
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

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Servir imágenes de productos con headers correctos
app.use('/images/product-images', express.static(path.join(__dirname, 'public/images/product-images'), {
  setHeaders: (res, path) => {
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año
  }
}));

// Trust proxy for secure cookies behind Replit's proxy
app.set('trust proxy', 1);

// Session configuration - persistent login (30 days) with PostgreSQL store
// Replit always uses HTTPS via proxy, so we force secure cookies
console.log('🔧 Session config - Replit HTTPS mode (forced)');
console.log('🔧 Session store: PostgreSQL (persistent)');
console.log('🍪 Cookie: secure=true, sameSite=none (for iframe support)');
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
  console.log('🧹 Ejecutando limpieza automática de imágenes de eventos...');
  await imageManager.cleanupExpiredImages();
}, 6 * 60 * 60 * 1000); // 6 horas

// Cleanup on startup
setTimeout(async () => {
  console.log('🧹 Limpieza inicial de imágenes de eventos...');
  await imageManager.cleanupExpiredImages();
}, 30000); // 30 segundos después del inicio

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
    console.log(`📁 Requesting file from Object Storage: ${filePath}`);

    const objectStorage = new Client();

    // Try to download the file
    let fileBuffer;
    try {
      console.log(`🔍 Attempting to download: ${filePath}`);
      fileBuffer = await objectStorage.downloadAsBytes(filePath);
      console.log(`✅ Successfully downloaded: ${filePath}`);
    } catch (downloadError) {
      console.log(`❌ Failed to download ${filePath}:`, downloadError.message);

      // Get filename for fallback attempts
      const filename = path.basename(filePath);
      let foundInFallback = false;

      // If file not found and it's a product-images request, try batch-images as fallback
      if (filePath.startsWith('product-images/') && downloadError.message?.includes('404')) {
        const batchPath = `batch-images/${filename}`;
        console.log(`🔄 Product image not found, trying batch path: ${batchPath}`);

        try {
          fileBuffer = await objectStorage.downloadAsBytes(batchPath);
          console.log(`✅ Found image in batch-images folder: ${batchPath}`);
          foundInFallback = true;
        } catch (batchError) {
          console.log(`❌ Image not found in batch-images either: ${batchPath}`);
        }
      }
      // If batch-images not found, try product-images as fallback
      else if (filePath.startsWith('batch-images/') && downloadError.message?.includes('404')) {
        const productPath = `product-images/${filename}`;
        console.log(`🔄 Batch image not found, trying product path: ${productPath}`);

        try {
          fileBuffer = await objectStorage.downloadAsBytes(productPath);
          console.log(`✅ Found image in product-images folder: ${productPath}`);
          foundInFallback = true;
        } catch (productError) {
          console.log(`❌ Image not found in product-images either: ${productPath}`);
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
    console.error(`❌ Error serving file ${req.params[0]}:`, error);

    // Fallback to default image
    if (req.params[0] !== 'images/logo.png') {
      console.log('🔄 Redirecting to default logo...');
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
      console.log('🔄 Serving default image: logo.png');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Image-Source', 'default-logo');
      return res.sendFile(defaultImagePath);
    } else {
      console.error('❌ Default image not found at:', defaultImagePath);

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
    console.error('❌ Error serving default image:', error.message);

    // Last resort - simple text response
    res.setHeader('Content-Type', 'text/plain');
    return res.status(500).send('Image not available');
  }
}


app.use('/api/videos', videosRouter);
app.use('/api/ticket-qr', ticketQrRouter);
// Legacy unpaid academy registration disabled — enrollment now requires Stripe payment
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

// Endpoint de extracción completa de eventos
app.post('/api/admin/extract-complete-event', async (req, res) => {
  try {
    console.log('🔍 Complete event extraction request received');
    console.log('📤 Request body:', JSON.stringify(req.body, null, 2));

    // Usar la misma lógica del endpoint de extracción de imagen
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL requerida para extraer información del evento'
      });
    }

    // Llamar al endpoint de extracción de imagen internamente
    const imageExtractionResult = await fetch(`http://localhost:${PORT}/api/extract-event-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const imageData = await imageExtractionResult.json();

    if (!imageData.success) {
      return res.json({
        success: false,
        error: imageData.error || 'No se pudo extraer la información del evento'
      });
    }

    // Crear respuesta completa
    const completeEventData = {
      title: imageData.eventInfo?.title || 'Evento sin título',
      description: imageData.eventInfo?.description || 'Sin descripción disponible',
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
    console.error('❌ Complete event extraction error:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al extraer información completa del evento'
    });
  }
});


// Authentication routes handled by routes/login.js and routes/logout.js





// Endpoint para obtener la publishable key de Stripe
app.get('/api/stripe-config', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (!publishableKey) {
    console.error('❌ STRIPE_PUBLISHABLE_KEY not configured');
    return res.status(500).json({ 
      error: 'Stripe publishable key not configured' 
    });
  }

  console.log('🔑 Providing Stripe config, key starts with:', publishableKey.substring(0, 20) + '...');

  res.json({
    publishableKey: publishableKey
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const { category } = req.query;

    console.log('📦 Loading products from all sources...');

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
            id: product.id,
            priceId: price ? price.id : null,
            name: product.name,
            description: product.description || '',
            price: priceAmount,
            image: localImages ? localImages.front : (product.images?.[0] || '/images/products/red-room-front.jpg'),
            images: localImages || { front: product.images?.[0] || '/images/products/red-room-front.jpg', back: null },
            category: product.metadata?.category || 'clothing',
            metadata: product.metadata || {},
            source: 'stripe'
          };
        });

      console.log(`💳 Loaded ${stripeProducts.length} products from Stripe (filtered for clothing only)`);
    } catch (stripeError) {
      console.warn('⚠️ Stripe products unavailable:', stripeError.message);
    }

    // 2. Batch products are NOT included in shop - they are managed separately in admin
    console.log(`ℹ️ Batch products excluded from shop - they are managed separately in the tokens system`);

    // 3. Only use Stripe products for shop
    const allProducts = [...stripeProducts];

    // Filter by category if specified
    const filtered = category && category !== 'all'
      ? allProducts.filter(p => p.category === category)
      : allProducts;

    console.log(`✅ Returning ${filtered.length} total products (${stripeProducts.length} from Stripe only - batches excluded)`);
    res.json(filtered);

  } catch (error) {
    console.error('❌ Error fetching products:', error);

    // Fallback with basic products
    const fallbackProducts = [
      {
        id: "fallback-1",
        name: "Black Room T-Shirt",
        price: 25.00,
        category: "clothing",
        image: "/api/storage/images/logo.png",
        description: "Official Black Room merchandise",
        priceId: "price_fallback_1",
        source: 'fallback'
      }
    ];

    const filtered = req.query.category && req.query.category !== 'all'
      ? fallbackProducts.filter(p => p.category === req.query.category)
      : fallbackProducts;

    console.log(`🔄 Using fallback products for shop (batches are managed separately)`);
    res.json(filtered);
  }
});

// Radio Schedule API endpoint - merges local JSON + Google Calendar for Thursdays
app.get('/api/radio-schedule', async (req, res) => {
  try {
    const schedulePath = path.join(__dirname, 'db/radio-schedule.json');
    let localData = { schedule: [] };
    if (fs.existsSync(schedulePath)) {
      localData = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
    }

    if (process.env.GOOGLE_API_KEY) {
      try {
        const calendarId = 'theblackroom.us@gmail.com';
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59);

        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
        const params = new URLSearchParams({
          key: process.env.GOOGLE_API_KEY,
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100'
        });

        const { default: fetch } = await import('node-fetch');
        const response = await fetch(`${calendarUrl}?${params}`);

        if (response.ok) {
          const data = await response.json();
          const gcalEvents = data.items || [];

          const radioEvents = gcalEvents.filter(e =>
            (e.summary || '').toLowerCase().includes('radio')
          );

          console.log(`📅 Google Calendar: ${radioEvents.length} radio events found`);

          for (const gcEvent of radioEvents) {
            const eventDate = gcEvent.start?.date || (gcEvent.start?.dateTime || '').split('T')[0];
            if (!eventDate) continue;

            const description = gcEvent.description || '';
            const djs = parseGoogleCalendarDJs(description);

            const existingIdx = localData.schedule.findIndex(s => s.date === eventDate);
            if (djs.length > 0) {
              if (existingIdx >= 0) {
                localData.schedule[existingIdx].djs = djs;
                localData.schedule[existingIdx].source = 'google-calendar';
              } else {
                localData.schedule.push({
                  date: eventDate,
                  djs: djs,
                  source: 'google-calendar'
                });
              }
            }
            /* If Google Calendar has a radio entry but no parsed DJs, skip it
               (do not insert a TBA placeholder). */
          }

          localData.schedule.sort((a, b) => a.date.localeCompare(b.date));
        }
      } catch (gcError) {
        console.log('⚠️ Google Calendar merge failed, using local only:', gcError.message);
      }
    }

    res.json(localData);
  } catch (error) {
    console.error('Error loading radio schedule:', error);
    res.status(500).json({ error: 'Error loading radio schedule' });
  }
});

function parseGoogleCalendarDJs(description) {
  if (!description) return [];
  const djs = [];
  const lines = description.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\d{1,2})\s*:\s*(.+)/);
    if (match) {
      const hour = parseInt(match[1]);
      let djName = match[2].trim();

      djName = djName.replace(/https?:\/\/\S+/g, '').trim();
      djName = djName.replace(/[?!]+$/, '').trim();

      if (djName && djName.length > 0) {
        const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
        const ampm = hour >= 12 ? 'PM' : (hour < 7 ? 'AM' : 'PM');
        djs.push({
          name: djName.toUpperCase(),
          time: `${displayHour}:00 ${ampm}`,
          genre: 'Techno'
        });
      }
    }
  }

  return djs;
}

// Calendar API endpoint
app.get('/api/calendar/events', async (req, res) => {
  const { calendarId, year, month, includeHistorical } = req.query;

  // Construct start and end dates for the month
  const startDate = new Date(parseInt(year), parseInt(month), 1);
  const endDate = new Date(parseInt(year), parseInt(month) + 1, 0, 23, 59, 59);

  let googleEvents = [];
  let localEvents = [];

  // Load local events from events.json
  try {
    const localEventsPath = path.join(__dirname, 'db/events.json');
    const localEventsData = fs.readFileSync(localEventsPath, 'utf-8');
    const allLocalEvents = JSON.parse(localEventsData);

    // Filter local events for the requested month
    localEvents = allLocalEvents.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.getFullYear() === parseInt(year) &&
             eventDate.getMonth() === parseInt(month);
    });

    // Convert local events to Google Calendar format (preserve YouTube fields)
    localEvents = localEvents.map(event => ({
      summary: event.title,
      start: {
        date: event.date // All-day event format
      },
      description: event.description,
      htmlLink: event.youtubeUrl || 'https://blackroomus.com',
      youtubeUrl: event.youtubeUrl,
      youtubeId: event.youtubeId,
      djs: event.djs || [],
      id: event.id,
      source: 'local',
      type: event.type,
      autoGenerated: event.autoGenerated || false
    }));

    console.log(`📄 Eventos locales cargados: ${localEvents.length} para ${year}-${month}`);
  } catch (error) {
    console.log('📄 No hay eventos locales o error al cargar:', error.message);
  }

  // Try to load Google Calendar events
  if (process.env.GOOGLE_API_KEY) {
    const timeMin = startDate.toISOString();
    const timeMax = endDate.toISOString();

    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const params = new URLSearchParams({
      key: process.env.GOOGLE_API_KEY,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500'
    });

    console.log(`📅 OBTENIENDO EVENTOS COMPLETOS DEL CALENDARIO: ${year}-${month}`);

    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(`${calendarUrl}?${params}`);

      if (response.ok) {
        const data = await response.json();
        googleEvents = data.items || [];
        console.log(`✅ API del calendario devolvió ${googleEvents.length} eventos para ${year}-${month}`);
      }
    } catch (error) {
      console.log('⚠️ Error de Google Calendar API:', error.message);
    }
  }

  // Combine Google and local events
  const allEvents = [...googleEvents, ...localEvents];

  console.log(`📊 Total eventos combinados: ${allEvents.length} (Google: ${googleEvents.length}, Local: ${localEvents.length})`);

  // If no events found, use mock data for fallback
  if (allEvents.length === 0) {
    console.log('⚠️ No se encontraron eventos, usando datos de prueba.');
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);
    const mockEvents = generateMockEvents(targetYear, targetMonth);
    return res.json(mockEvents);
  }

  res.json(allEvents);
});

// Mock events generator for fallback
function generateMockEvents(year, month) {
  const events = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Generate events for weekends
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();

    // Friday and Saturday events
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      const eventDate = date.toISOString();

      // Sample DJs from our video data
      const sampleDJs = [
        { name: 'ADELO', videoId: 'e3x7fXI6D6Y' },
        { name: 'KRYZ', videoId: '5S9rIRi-1-8' },
        { name: 'SICK', videoId: 'u4saimdlbdE' },
        { name: 'ONEFIVE', videoId: 'YbqP1g-dQP4' },
        { name: 'STEFANO', videoId: 'YsMDixg_RWM' },
        { name: 'VIOLETA', videoId: 'dBaDRBm1JgU' },
        { name: 'INSTINCT', videoId: 'X9ctODmrcZY' }
      ];

      // Shuffle and pick up to 3 DJs
      const randomDJs = sampleDJs.sort(() => 0.5 - Math.random()).slice(0, 3);
      const djList = randomDJs.map(dj => `${dj.name} https://youtube.com/watch?v=${dj.videoId}`).join('\n');

      events.push({
        summary: 'Black Room Radio - Live Session',
        start: {
          dateTime: eventDate.replace('T00:00:00.000Z', 'T20:00:00.000Z') // Set to 8 PM
        },
        description: `Tonight's lineup:\n${djList}`,
        htmlLink: 'https://blackroom.com' // Generic link
      });
    }
  }
  console.log(`Generated ${events.length} mock events for ${year}-${month}`);
  return events;
}


// YouTube API endpoints
app.get('/api/youtube/search', async (req, res) => {
  const { q, maxResults = 50, channelId } = req.query;
  const API_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyBQeCjv948kI1CJDd9fzK6WYyLCbyMwHG8";

  try {
    // Si se especifica channelId, buscar solo en ese canal (Black Room)
    if (channelId) {
      console.log(`🎵 Searching Black Room channel for: ${q}`);

      const { default: fetch } = await import('node-fetch');
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&channelId=${channelId}&maxResults=${maxResults}&type=video&key=${API_KEY}`
      );

      if (!response.ok) {
        console.error(`YouTube API error: ${response.status} ${response.statusText}`);
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ Found ${data.items.length} Black Room videos for query: ${q}`);
      res.json(data.items);

    } else {
      // Búsqueda general en YouTube (solo para compatibilidad, no debería usarse)
      console.log(`🔎 Searching YouTube general for: ${q} (WARNING: Should use channelId)`);

      const { default: fetch } = await import('node-fetch');
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${API_KEY}`
      );

      if (!response.ok) {
        console.error(`YouTube API error: ${response.status} ${response.statusText}`);
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ Found ${data.items.length} general videos on YouTube for query: ${q}`);
      res.json(data.items);
    }

  } catch (error) {
    console.error('Error searching YouTube:', error);
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});

// Cache para playlists de YouTube 
let playlistsCache = {
  data: null,
  timestamp: 0,
  expires: 10 * 60 * 1000 // 10 minutos en milisegundos
};

// YouTube API route to get all playlists from channel
app.get('/api/youtube/playlists', async (req, res) => {
  const CHANNEL_ID = "UCi__qHBfHLlYg0fu86BUA8g";
  const API_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyBQeCjv948kI1CJDd9fzK6WYyLCbyMwHG8";

  // Verificar si tenemos datos en caché válidos
  const now = Date.now();
  if (playlistsCache.data && (now - playlistsCache.timestamp) < playlistsCache.expires) {
    console.log(`📺 Using cached playlists (${playlistsCache.data.length} playlists)`);
    return res.json({ playlists: playlistsCache.data });
  }

  console.log(`📺 Loading all playlists from channel: ${CHANNEL_ID}`);

  try {
    const { default: fetch } = await import('node-fetch');
    let allPlaylists = [];
    let nextPageToken = null;

    // Obtener todos los playlists usando paginación
    do {
      let url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${CHANNEL_ID}&maxResults=50&key=${API_KEY}`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`YouTube API error for playlists:`, response.status, errorText);
        return res.json({ playlists: [] });
      }

      const data = await response.json();

      if (data.items) {
        // Filtrar playlists no deseados
        const filteredPlaylists = data.items.filter(playlist => {
          const title = playlist.snippet.title.toLowerCase();
          return !title.includes('watch later') && 
                 !title.includes('liked videos') &&
                 !title.includes('likes') &&
                 playlist.contentDetails.itemCount > 0; // Solo playlists con videos
        });

        allPlaylists = allPlaylists.concat(filteredPlaylists);
      }

      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    console.log(`✅ Found ${allPlaylists.length} valid playlists from channel`);

    // Mapear a formato simplificado
    const simplifiedPlaylists = allPlaylists.map(playlist => ({
      id: playlist.id,
      title: playlist.snippet.title,
      description: playlist.snippet.description,
      thumbnails: playlist.snippet.thumbnails,
      itemCount: playlist.contentDetails.itemCount,
      publishedAt: playlist.snippet.publishedAt
    }));

    // Guardar en caché
    playlistsCache.data = simplifiedPlaylists;
    playlistsCache.timestamp = Date.now();
    console.log(`💾 Playlists cached for ${playlistsCache.expires / 60000} minutes`);

    res.json({ playlists: simplifiedPlaylists });

  } catch (error) {
    console.error('Error fetching channel playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// YouTube API routes - Connect to the actual YouTube API
app.get('/api/youtube/playlistItems', async (req, res) => {
  const { playlistId, maxResults = 50 } = req.query;
  const API_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyBQeCjv948kI1CJDd9fzK6WYyLCbyMwHG8";

  console.log(`📺 Loading real playlist from YouTube: ${playlistId}`);

  try {
    // Call the actual YouTube API
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${maxResults}&key=${API_KEY}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`YouTube API error for playlist ${playlistId}:`, response.status, errorText);

      // If there's an API error, use a minimal fallback
      return res.json({
        items: [],
        error: `YouTube API error: ${response.status}`
      });
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      console.warn(`No videos found in playlist ${playlistId}`);
      return res.json({
        items: []
      });
    }

    console.log(`✅ Loaded ${data.items.length} real videos from YouTube playlist ${playlistId}`);

    // Return the actual YouTube data
    res.json({
      items: data.items.map(item => ({
        snippet: {
          title: item.snippet.title,
          resourceId: {
            videoId: item.snippet.resourceId.videoId
          },
          thumbnails: item.snippet.thumbnails,
          description: item.snippet.description,
          publishedAt: item.snippet.publishedAt
        }
      }))
    });

  } catch (error) {
    console.error(`Error fetching real YouTube playlist ${playlistId}:`, error);

    // Fallback in case of error
    res.json({
      items: [],
      error: error.message
    });
  }
});

// Endpoint to get REAL latest videos from the channel with local cache
app.get('/api/youtube/latest', async (req, res) => {
  const API_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyBQeCjv948kI1CJDd9fzK6WYyLCbyMwHG8";
  const CHANNEL_ID = "UCi__qHBfHLlYg0fu86BUA8g"; // Your Black Room channel
  const cacheFile = path.join(__dirname, "public/data/latest-videos-cache.json");
  const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds - Refresh more frequently for latest videos

  try {
    // 1. Try to load from local cache first
    if (fs.existsSync(cacheFile)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        const cacheAge = Date.now() - cacheData.timestamp;

        if (cacheAge < CACHE_DURATION) {
          console.log(`📦 Using cached latest videos (${Math.round(cacheAge / (60 * 60 * 1000))}h old)`);
          return res.json(cacheData.videos);
        } else {
          console.log(`⏰ Cache expired (${Math.round(cacheAge / (60 * 60 * 1000))}h old), fetching from YouTube...`);
        }
      } catch (cacheError) {
        console.warn('Error reading cache, fetching from YouTube:', cacheError);
      }
    } else {
      console.log(`🎬 No cache found, fetching REAL latest videos from YouTube channel: ${CHANNEL_ID}`);
    }

    // 2. If no valid cache, query YouTube
    const { default: fetch } = await import('node-fetch');

    // Get ALL latest videos from the channel using the search API - ORDER BY DATE to ensure latest first
    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&type=video&order=date&maxResults=50&key=${API_KEY}`
    );

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('YouTube Search API error:', searchResponse.status, errorText);

      // If there's an API error but cache exists (even if expired), use it
      if (fs.existsSync(cacheFile)) {
        try {
          const fallbackCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          console.log('🔄 Using expired cache due to API error');
          return res.json(fallbackCache.videos);
        } catch (fallbackError) {
          console.error('Error reading fallback cache:', fallbackError);
        }
      }

      throw new Error(`YouTube API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json(); // Corrected from response.json()

    if (!searchData.items || searchData.items.length === 0) {
      console.warn('No videos found in channel');
      return res.json([]);
    }

    console.log(`✅ Found ${searchData.items.length} REAL latest videos from your channel`);

    // Format the data to match the expected format
    const latestVideos = searchData.items.map(item => ({
      id: { videoId: item.id.videoId },
      snippet: {
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
        thumbnails: item.snippet.thumbnails,
        description: item.snippet.description,
        channelTitle: item.snippet.channelTitle
      }
    }));

    // Sort by most recent date
    latestVideos.sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));

    // 3. Save to local cache
    try {
      const cacheData = {
        timestamp: Date.now(),
        videos: latestVideos
      };

      // Ensure the directory exists
      const dataDir = path.dirname(cacheFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
      console.log(`💾 Saved ${latestVideos.length} latest videos to cache`);
    } catch (saveError) {
      console.error('Error saving cache:', saveError);
    }

    console.log(`✅ Returning ${latestVideos.length} REAL latest videos from your YouTube channel`);
    console.log(`🎬 LATEST VIDEO: "${latestVideos[0]?.snippet?.title}" - ${latestVideos[0]?.snippet?.publishedAt}`);
    res.json(latestVideos);

  } catch (error) {
    console.error('Error loading REAL latest videos:', error);

    // If there's an error but cache exists (even if expired), use it as a last resort
    if (fs.existsSync(cacheFile)) {
      try {
        const emergencyCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        console.log('🆘 Using emergency cache due to error');
        return res.json(emergencyCache.videos);
      } catch (emergencyError) {
        console.error('Error reading emergency cache:', emergencyError);
      }
    }

    // In case of total failure, use fallback data
    console.log('🔄 Using fallback data due to API quota exceeded');
    const fallbackVideos = [
      {
        id: { videoId: "HVIwlYgXCok" },
        snippet: {
          title: "SCHWARZ - Industrial Techno Live Set | Black Room Miami",
          publishedAt: "2024-12-15T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Industrial techno live set from SCHWARZ at Black Room Miami",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "7FrdvQCv1Uk" },
        snippet: {
          title: "KATALINA - Melodic Techno Journey | Black Room Radio",
          publishedAt: "2024-12-12T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Melodic techno journey with KATALINA on Black Room Radio",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "gSLsZo4qN14" },
        snippet: {
          title: "MVRPH - Acid Techno Set | Underground Series",
          publishedAt: "2024-12-10T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Acid techno set from MVRPH in our Underground Series",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "n85C7QaAwG0" },
        snippet: {
          title: "DR_REIN - Hypnotic Minimal Set | Black Room Sessions",
          publishedAt: "2024-12-08T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Hypnotic minimal set from DR_REIN at Black Room Sessions",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "Sdcr4D6jmdg" },
        snippet: {
          title: "ANAÎNA - Progressive Techno Live | Miami Underground",
          publishedAt: "2024-11-28T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Progressive techno live performance from ANAÎNA",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "2U4-Oeng3rA" },
        snippet: {
          title: "DADREV - Dark Techno Set | Black Room Radio Episode 150",
          publishedAt: "2024-12-03T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Dark techno set from DADREV on Black Room Radio Episode 150",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "Lr_FzTxMGRY" },
        snippet: {
          title: "PROLETAR - Peak Time Techno | Warehouse Sessions",
          publishedAt: "2024-12-01T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Peak time techno from PROLETAR at our Warehouse Sessions",
          channelTitle: "Black Room"
        }
      },
      {
        id: { videoId: "0H2h7t8qu6M" },
        snippet: {
          title: "CRISCA - Underground Techno Journey | Black Room Miami",
          publishedAt: "2024-11-28T00:00:00Z",
          thumbnails: { medium: { url: "/api/storage/images/logo.png" } },
          description: "Underground techno journey with CRISCA at Black Room Miami",
          channelTitle: "Black Room"
        }
      }
    ];

    res.json(fallbackVideos);
  }
});

// Endpoint to clear the latest videos cache (for manual use)
app.post('/api/clear-latest-cache', (req, res) => {
  const cacheFile = path.join(__dirname, "public/data/latest-videos-cache.json");

  try {
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
      console.log('🗑️ Latest videos cache cleared');
      res.json({ message: 'Cache cleared successfully' });
    } else {
      res.json({ message: 'No cache file found' });
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Error clearing cache' });
  }
});

// Stripe checkout session - maneja ambos formatos: cart e items
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    console.log('🛒 Checkout request received:', req.body);
    const { cart, items } = req.body;

    // Manejar ambos formatos: cart (productos personalizados) e items (productos de Stripe)
    let dataToProcess = [];
    let dataFormat = '';

    if (cart && Array.isArray(cart) && cart.length > 0) {
      dataToProcess = cart;
      dataFormat = 'cart';
      console.log('📦 Using cart format (custom products)');
    } else if (items && Array.isArray(items) && items.length > 0) {
      dataToProcess = items;
      dataFormat = 'items';
      console.log('📦 Using items format (Stripe products)');
    } else {
      console.error('❌ Invalid data:', { cart, items });
      return res.status(400).json({ 
        error: 'Carrito vacío o formato inválido',
        receivedCart: cart,
        receivedItems: items,
        hint: 'Envía "cart" para productos personalizados o "items" para productos de Stripe'
      });
    }

    // Validate Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('❌ STRIPE_SECRET_KEY not configured');
      return res.status(500).json({ error: 'Stripe no está configurado correctamente' });
    }

    // Generar line_items basado en el formato
    let line_items = [];
    let validatedCart = dataToProcess; // Initialize with dataToProcess

    if (dataFormat === 'items') {
      // Formato items: usar priceId directamente (productos de Stripe)
      line_items = dataToProcess.map((item, index) => {
        if (!item.priceId || !item.priceId.trim()) {
          throw new Error(`Item ${index + 1} inválido: falta priceId`);
        }

        console.log(`📦 Using Stripe price ID for item ${index + 1}:`, item.priceId);
        return {
          price: item.priceId.trim(),
          quantity: parseInt(item.quantity || 1),
        };
      });
    } else {
      // Formato cart: ALWAYS use price_data, IGNORE any priceId
      validatedCart = dataToProcess.map((item, index) => {
        if (!item.name || !item.price) {
          throw new Error(`Item ${index + 1} inválido: falta nombre o precio`);
        }

        return {
          ...item,
          price: parseFloat(item.price),
          qty: parseInt(item.qty || item.quantity || 1)
        };
      });

      line_items = validatedCart.map((item, index) => {
        try {
          // ALWAYS use price_data for cart items - never use priceId
          // Include size in product name for order visibility
          const productName = item.size ? `${item.name} - Size ${item.size}` : item.name;
          console.log(`💰 Creating price for item ${index + 1}:`, productName, '$' + item.price);

          if (!item.price || item.price <= 0) {
            throw new Error(`Precio inválido para ${item.name}: ${item.price}`);
          }

          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: productName,
                ...(item.description && item.description.trim() ? { description: item.description.trim() } : {}),
                ...(item.image && item.image.startsWith('http') ? { images: [item.image] } : {}),
              },
              unit_amount: Math.round(item.price * 100), // Convertir a centavos
            },
            quantity: item.qty || item.quantity || 1,
          };
        } catch (itemError) {
          console.error(`❌ Error processing item ${index + 1}:`, itemError.message, item);
          throw new Error(`Error en producto "${item.name}": ${itemError.message}`);
        }
      });
    }

    console.log('💳 Creating Stripe session with items:', line_items);

    // Calculate total amount from the original cart data (in cents)
    const totalAmount = validatedCart.reduce((sum, item) => {
      const price = parseFloat(item.price) || 0;
      const qty = parseInt(item.qty || item.quantity || 1);
      return sum + (Math.round(price * 100) * qty);
    }, 0);

    console.log(`💵 Cart subtotal: $${(totalAmount / 100).toFixed(2)}`);

    // Determine shipping options based on cart total
    const shippingOptions = [];
    
    // Free shipping for orders over $75
    if (totalAmount >= 7500) {
      shippingOptions.push({
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'usd' },
          display_name: 'Free Standard Shipping',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 5 },
            maximum: { unit: 'business_day', value: 10 },
          },
        },
      });
    } else {
      // Standard shipping for orders under $75
      shippingOptions.push({
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: 799, currency: 'usd' },
          display_name: 'Standard Shipping ($7.99)',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 5 },
            maximum: { unit: 'business_day', value: 10 },
          },
        },
      });
    }
    
    // Express shipping always available
    shippingOptions.push({
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 1499, currency: 'usd' },
        display_name: 'Express Shipping ($14.99) - 2-3 Days',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 3 },
        },
      },
    });
    
    // Priority overnight shipping
    shippingOptions.push({
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 2499, currency: 'usd' },
        display_name: 'Priority Overnight ($24.99) - Next Day',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 1 },
          maximum: { unit: 'business_day', value: 1 },
        },
      },
    });

    console.log(`💰 Total amount: $${totalAmount/100}, Shipping options:`, shippingOptions.map(opt => opt.shipping_rate_data.display_name));

    // Use HTTPS and proper domain for Stripe URLs
    const host = req.get('host');
    const baseUrl = host.includes('replit') || host.includes('localhost') 
      ? `https://${host}` 
      : `https://${process.env.DOMAIN || host}`;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      locale: 'en',
      line_items,
      mode: 'payment',
      success_url: `${baseUrl}/shop.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/shop.html?canceled=true`,
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'MX'],
      },
      shipping_options: shippingOptions,
    });

    console.log('✅ Stripe session created successfully:', session.id);
    console.log('🔗 Stripe session URL:', session.url);

    // Ensure URL is always present for mobile compatibility
    const checkoutUrl = session.url || `https://checkout.stripe.com/c/pay/${session.id}`;

    console.log('📱 Final checkout URL for mobile:', checkoutUrl);

    res.json({ 
      success: true,
      id: session.id,
      url: checkoutUrl
    });
  } catch (error) {
    console.error('❌ Stripe checkout error:', error);

    // Detailed error logging
    const errorDetails = {
      message: error.message,
      type: error.type || 'unknown',
      code: error.code || 'unknown',
      param: error.param || 'unknown',
      requestBody: req.body
    };

    console.error('❌ Full error details:', errorDetails);

    // User-friendly error messages
    let userError = 'Error al crear la sesión de pago';

    if (error.type === 'StripeCardError') {
      userError = 'Error de tarjeta: ' + error.message;
    } else if (error.type === 'StripeInvalidRequestError') {
      userError = 'Datos de pago inválidos: ' + error.message;
    } else if (error.message.includes('price')) {
      userError = 'Error en el precio del producto: ' + error.message;
    } else if (error.message.includes('Item') && error.message.includes('inválido')) {
      userError = error.message;
    }

    res.status(500).json({ 
      error: userError,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stripeError: process.env.NODE_ENV === 'development' ? errorDetails : undefined
    });
  }
});

// Checkout directo para curso $400
app.post('/api/course-checkout', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const host = req.headers.host || req.hostname;
    const baseUrl = host.includes('replit') || host.includes('repl.co')
      ? `https://${host}`
      : `https://${process.env.DOMAIN || host}`;

    const { name, email, phone, course } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email and phone are required' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'affirm', 'klarna'],
      locale: 'en',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Black Room DJ Academy — Full Course',
            description: 'Full access to the Black Room DJ Academy course',
          },
          unit_amount: 40000,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email || undefined,
      metadata: {
        type: 'academy',
        name: name,
        email: email.toLowerCase(),
        phone: phone,
        course: course || 'basic'
      },
      success_url: `${baseUrl}/curso-gracias.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/academy.html`,
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'MX', 'AR', 'BR', 'CO', 'CL', 'PE', 'ES', 'GB', 'AU'],
      },
    });

    console.log('✅ Course checkout session created:', session.id);
    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('❌ Course checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create payment session: ' + error.message });
  }
});

// Verify course payment and register the student ONLY when paid
app.get('/api/verify-course-payment', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session || session.payment_status !== 'paid') {
      return res.status(402).json({ paid: false, error: 'Payment not completed' });
    }

    const m = session.metadata || {};

    // Security: only accept genuine $400 USD academy checkouts
    if (m.type !== 'academy' || session.amount_total !== 40000 || session.currency !== 'usd') {
      return res.status(400).json({ paid: false, error: 'Not a valid academy enrollment payment' });
    }

    const name = m.name || session.customer_details?.name || 'Student';
    const email = (m.email || session.customer_details?.email || '').toLowerCase();
    const phone = m.phone || session.customer_details?.phone || '';
    const course = m.course || 'basic';

    const pool = (await import('./database/connection.js')).default;

    // Atomic dedup: insert only once per Stripe session (unique index on stripe_session_id)
    const inserted = await pool.query(
      `INSERT INTO academy_registrations (name, email, phone, course, paid, stripe_session_id)
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id`,
      [name, email, phone, course, session_id]
    );
    if (inserted.rows.length === 0) {
      // Already registered by a previous (or concurrent) request
      return res.json({ paid: true, alreadyRegistered: true });
    }
    console.log(`✅ Academy student registered (PAID): ${name} (${email})`);

    // Send confirmation + admin notification emails
    try {
      await emailTransporter.sendMail({
        from: '"Black Room Academy" <theblackroom.us@gmail.com>',
        to: email,
        bcc: 'theblackroom.us@gmail.com',
        subject: 'Welcome to Black Room Academy! 🎵',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #000; color: #fff; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #fff; margin: 0; letter-spacing:2px;">BLACK ROOM ACADEMY</h1></div>
            <h2 style="color: #fff;">Welcome ${name}!</h2>
            <p>Your payment has been received and your spot in the Black Room DJ Academy is confirmed. 🎧</p>
            <div style="background: #111; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Enrollment Details:</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Course:</strong> Full Course</p>
              <p><strong>Amount Paid:</strong> $${(session.amount_total/100).toFixed(2)} USD</p>
            </div>
            <p>We'll reach out shortly with your schedule and next steps.</p>
            <p style="font-size: 14px; color: #ccc; text-align: center; margin-top: 40px;">Black Room Academy<br>Revolutionizing Miami's Techno Scene</p>
          </div>`
      });
      await emailTransporter.sendMail({
        from: '"Black Room Academy" <theblackroom.us@gmail.com>',
        to: 'theblackroom.us@gmail.com',
        subject: `💳 PAID Academy Enrollment: ${name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>New PAID Academy Enrollment</h2>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Amount Paid:</strong> $${(session.amount_total/100).toFixed(2)} USD</p>
              <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
            </div>
            <p>Follow up to schedule their course.</p>
          </div>`
      });
    } catch (emailErr) {
      console.error('⚠️ Academy payment emails failed:', emailErr.message);
    }

    res.json({ paid: true, registered: true });
  } catch (error) {
    console.error('❌ Verify course payment error:', error.message);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// ── ADMIN ORDERS ───────────────────────────────────────────────────────────
function fmtAddress(a) {
  if (!a) return '—';
  return [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ');
}

// GET /api/admin/orders — list all paid shop orders from Stripe
app.get('/api/admin/orders', async (req, res) => {
  const u = req.session?.user;
  const isAdmin = u?.isAdmin || u?.role === 'admin' || u?.email === 'robert.manzanillag@gmail.com';
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    // Paginate through ALL Stripe checkout sessions (max 100 per page)
    let allSessions = [];
    let lastId = undefined;
    let hasMore = true;
    while (hasMore) {
      const params = { limit: 100, expand: ['data.line_items'] };
      if (lastId) params.starting_after = lastId;
      const page = await stripe.checkout.sessions.list(params);
      allSessions = allSessions.concat(page.data);
      hasMore = page.has_more;
      if (page.data.length > 0) lastId = page.data[page.data.length - 1].id;
    }
    const orders = allSessions
      .filter(s => s.payment_status === 'paid' && s.metadata?.type !== 'academy')
      .map(s => ({
        id: s.id,
        created: s.created,
        date: new Date(s.created * 1000).toISOString(),
        customerName: s.customer_details?.name || '—',
        customerEmail: s.customer_details?.email || '—',
        phone: s.customer_details?.phone || '—',
        amount: (s.amount_total / 100).toFixed(2),
        currency: (s.currency || 'usd').toUpperCase(),
        shippingAddress: fmtAddress(s.shipping_details?.address),
        shippingAddressRaw: s.shipping_details?.address || null,
        shippingName: s.shipping_details?.name || s.customer_details?.name || '—',
        items: (s.line_items?.data || []).map(i => ({
          name: i.description,
          qty: i.quantity,
          amount: (i.amount_total / 100).toFixed(2)
        }))
      }));
    res.json({ success: true, orders, total: orders.length });
  } catch (err) {
    console.error('❌ Admin orders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/send-shipping-email — send shipping notification to customer
app.post('/api/admin/send-shipping-email', async (req, res) => {
  const u = req.session?.user;
  const isAdmin = u?.isAdmin || u?.role === 'admin' || u?.email === 'robert.manzanillag@gmail.com';
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const { sessionId, trackingNumber, carrier, message } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'Customer';
    if (!customerEmail) return res.status(400).json({ error: 'No customer email found' });

    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId);
    const itemsList = lineItems.data.map(i => `${i.description} x${i.quantity}`).join(', ');
    const addrStr = fmtAddress(session.shipping_details?.address);
    const trackingHtml = trackingNumber
      ? `<tr><td style="padding:8px 0;font-size:13px;color:#888;border-bottom:1px solid #1a1a1a"><strong style="color:#fff">Tracking Number</strong></td><td style="padding:8px 0;font-size:13px;color:#fff;border-bottom:1px solid #1a1a1a">${trackingNumber}${carrier ? ` — ${carrier}` : ''}</td></tr>`
      : '';
    const customHtml = message
      ? `<p style="font-size:13px;color:#888;margin:20px 0 0;line-height:1.6">${message}</p>` : '';

    await emailTransporter.sendMail({
      from: '"BLACK ROOM" <theblackroom.us@gmail.com>',
      to: customerEmail,
      bcc: 'theblackroom.us@gmail.com',
      subject: 'Your BLACK ROOM Order Has Shipped! 🚚',
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;"><tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#000;border:1px solid #1a1a1a;">
          <tr><td style="padding:30px 40px;text-align:center;background:#0a0a0a;border-bottom:1px solid #1a1a1a;">
            <h1 style="margin:0;font-size:20px;letter-spacing:4px;color:#fff;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;">BLACK ROOM</h1>
            <p style="margin:8px 0 0;font-size:10px;letter-spacing:3px;color:#555;text-transform:uppercase;">Order Shipped ✓</p>
          </td></tr>
          <tr><td style="padding:36px 40px;">
            <p style="font-size:15px;color:#fff;margin:0 0 8px">Hi ${customerName},</p>
            <p style="font-size:13px;color:#666;margin:0 0 28px;line-height:1.6">Great news — your order is on the way!</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1a1a1a;margin-bottom:24px;">
              <tr><td colspan="2" style="padding:12px 16px;background:#0a0a0a;border-bottom:1px solid #1a1a1a">
                <p style="margin:0;font-size:10px;letter-spacing:2px;color:#555;text-transform:uppercase;">Order Details</p>
              </td></tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#888;border-bottom:1px solid #1a1a1a"><strong style="color:#fff">Items</strong></td>
                <td style="padding:10px 16px;font-size:13px;color:#ccc;border-bottom:1px solid #1a1a1a">${itemsList}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#888;border-bottom:1px solid #1a1a1a"><strong style="color:#fff">Ship To</strong></td>
                <td style="padding:10px 16px;font-size:13px;color:#ccc;border-bottom:1px solid #1a1a1a">${addrStr}</td>
              </tr>
              ${trackingHtml}
            </table>
            ${customHtml}
            <p style="font-size:12px;color:#444;margin:24px 0 0;line-height:1.6">Questions? Email us at <a href="mailto:theblackroom.us@gmail.com" style="color:#777;text-decoration:none">theblackroom.us@gmail.com</a></p>
          </td></tr>
          <tr><td style="padding:18px 40px;border-top:1px solid #1a1a1a;text-align:center;">
            <p style="font-size:10px;color:#333;margin:0;letter-spacing:2px;text-transform:uppercase;">BLACK ROOM MIAMI</p>
          </td></tr>
        </table></td></tr></table>
      </body></html>`
    });
    console.log(`✅ Shipping email sent to ${customerEmail} for session ${sessionId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Send shipping email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Function to send order confirmation emails
async function sendOrderEmails(session) {
  try {
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'Customer';
    const shippingAddress = session.shipping_details?.address;
    const amountTotal = (session.amount_total / 100).toFixed(2);
    
    // Get line items from the session
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    
    // Format items for email
    const itemsList = lineItems.data.map(item => 
      `• ${item.description} x${item.quantity} - $${(item.amount_total / 100).toFixed(2)}`
    ).join('\n');
    
    const itemsHtml = lineItems.data.map(item => 
      `<tr>
        <td style="padding: 10px; border-bottom: 1px solid #333;">${item.description}</td>
        <td style="padding: 10px; border-bottom: 1px solid #333; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #333; text-align: right;">$${(item.amount_total / 100).toFixed(2)}</td>
      </tr>`
    ).join('');
    
    const shippingAddressText = shippingAddress ? 
      `${shippingAddress.line1}${shippingAddress.line2 ? ', ' + shippingAddress.line2 : ''}, ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}, ${shippingAddress.country}` : 
      'No shipping address provided';
    
    const orderDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    
    // Generate unique order number
    const orderNumber = `BR-${Date.now().toString(36).toUpperCase()}`;
    
    // Email to ADMIN (you) - Professional Design
    const adminEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #000000; font-family: 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000000; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #000000; border: 1px solid #1a1a1a;">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 30px 40px; text-align: center; background: linear-gradient(135deg, #ff1744 0%, #d50000 100%);">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 2px; color: #ffffff;">NEW ORDER RECEIVED</h1>
                  </td>
                </tr>
                
                <!-- Order Summary -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #000000; text-align: center; border-bottom: 1px solid #1a1a1a;">
                    <p style="margin: 0 0 5px 0; font-size: 12px; letter-spacing: 2px; color: #666666; text-transform: uppercase;">Order Number</p>
                    <p style="margin: 0 0 15px 0; font-size: 20px; font-weight: 600; color: #ffffff;">${orderNumber}</p>
                    <p style="margin: 0; font-size: 32px; font-weight: 700; color: #ff1744;">$${amountTotal}</p>
                    <p style="margin: 10px 0 0 0; font-size: 12px; color: #666666;">${orderDate}</p>
                  </td>
                </tr>
                
                <!-- Customer Info -->
                <tr>
                  <td style="padding: 25px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 15px 0; border-bottom: 2px solid #ff1744;">
                          <p style="margin: 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Customer Information</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 20px 0;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding: 8px 0; font-size: 13px; color: #666666; width: 100px;">Name:</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; font-weight: 500;">${customerName}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 13px; color: #666666;">Email:</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ff1744;"><a href="mailto:${customerEmail}" style="color: #ff1744; text-decoration: none;">${customerEmail}</a></td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 13px; color: #666666; vertical-align: top;">Ship To:</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; line-height: 1.6;">${shippingAddressText}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Order Items -->
                <tr>
                  <td style="padding: 0 40px 25px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 15px 0; border-bottom: 2px solid #ff1744;">
                          <p style="margin: 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Order Items</p>
                        </td>
                      </tr>
                    </table>
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 15px;">
                      <tr style="background-color: #000000;">
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; border-bottom: 1px solid #1a1a1a;">Product</td>
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a1a;">Qty</td>
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; text-align: right; border-bottom: 1px solid #1a1a1a;">Price</td>
                      </tr>
                      ${lineItems.data.map(item => `
                      <tr>
                        <td style="padding: 15px; font-size: 14px; color: #ffffff; border-bottom: 1px solid #1a1a1a;">${item.description}</td>
                        <td style="padding: 15px; font-size: 14px; color: #888888; text-align: center; border-bottom: 1px solid #1a1a1a;">${item.quantity}</td>
                        <td style="padding: 15px; font-size: 14px; color: #ffffff; text-align: right; border-bottom: 1px solid #1a1a1a;">$${(item.amount_total / 100).toFixed(2)}</td>
                      </tr>
                      `).join('')}
                    </table>
                  </td>
                </tr>
                
                <!-- Total & Shipping -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000000; border: 1px solid #1a1a1a;">
                      <tr>
                        <td style="padding: 20px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #888888;">Subtotal</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; text-align: right;">$${amountTotal}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #888888;">Shipping</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; text-align: right;">${session.shipping_cost ? '$' + (session.shipping_cost.amount_total / 100).toFixed(2) : 'Included'}</td>
                            </tr>
                            <tr>
                              <td colspan="2" style="padding: 15px 0 0 0; border-top: 1px solid #333333;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size: 16px; font-weight: 600; color: #ff1744; text-transform: uppercase; letter-spacing: 1px;">TOTAL</td>
                                    <td style="font-size: 24px; font-weight: 700; color: #ffffff; text-align: right;">$${amountTotal}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Action Buttons -->
                <tr>
                  <td style="padding: 0 40px 30px 40px; text-align: center;">
                    <a href="https://dashboard.stripe.com/payments" style="display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #ff1744 0%, #d50000 100%); color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; border-radius: 3px;">View in Stripe Dashboard</a>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 40px; background-color: #000000; border-top: 1px solid #1a1a1a; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #444444;">BLACK ROOM - Order Notification System</p>
                    <p style="margin: 8px 0 0 0; font-size: 11px; color: #333333;">Stripe Session: ${session.id}</p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    
    // Email to CUSTOMER - Professional Design
    const customerEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #000000; font-family: 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000000; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #000000; border: 1px solid #1a1a1a;">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 40px 40px 30px 40px; text-align: center; border-bottom: 1px solid #1a1a1a;">
                    <h1 style="margin: 0; font-size: 32px; font-weight: 300; letter-spacing: 8px; color: #ffffff;">BLACK ROOM</h1>
                    <p style="margin: 15px 0 0 0; font-size: 12px; letter-spacing: 3px; color: #666666; text-transform: uppercase;">Miami's Underground Techno Experience</p>
                  </td>
                </tr>
                
                <!-- Order Confirmation Banner -->
                <tr>
                  <td style="padding: 30px 40px; background: linear-gradient(135deg, #1a1a1a 0%, #000000 100%); text-align: center;">
                    <p style="margin: 0 0 10px 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Order Confirmed</p>
                    <h2 style="margin: 0; font-size: 24px; font-weight: 400; color: #ffffff;">Thank You for Your Order</h2>
                    <p style="margin: 15px 0 0 0; font-size: 14px; color: #888888;">Order #${orderNumber}</p>
                  </td>
                </tr>
                
                <!-- Greeting -->
                <tr>
                  <td style="padding: 30px 40px 20px 40px;">
                    <p style="margin: 0; font-size: 16px; color: #ffffff; line-height: 1.6;">Dear ${customerName},</p>
                    <p style="margin: 15px 0 0 0; font-size: 14px; color: #aaaaaa; line-height: 1.8;">We're thrilled to confirm your order. Your items are being prepared with care and will be shipped shortly. Below you'll find all the details of your purchase.</p>
                  </td>
                </tr>
                
                <!-- Order Details Header -->
                <tr>
                  <td style="padding: 10px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 15px 0; border-bottom: 2px solid #ff1744;">
                          <p style="margin: 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Order Details</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Products Table -->
                <tr>
                  <td style="padding: 0 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr style="background-color: #000000;">
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; border-bottom: 1px solid #1a1a1a;">Item</td>
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a1a;">Qty</td>
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; text-align: right; border-bottom: 1px solid #1a1a1a;">Price</td>
                      </tr>
                      ${lineItems.data.map(item => `
                      <tr>
                        <td style="padding: 18px 15px; font-size: 14px; color: #ffffff; border-bottom: 1px solid #1a1a1a;">${item.description}</td>
                        <td style="padding: 18px 15px; font-size: 14px; color: #888888; text-align: center; border-bottom: 1px solid #1a1a1a;">${item.quantity}</td>
                        <td style="padding: 18px 15px; font-size: 14px; color: #ffffff; text-align: right; border-bottom: 1px solid #1a1a1a;">$${(item.amount_total / 100).toFixed(2)}</td>
                      </tr>
                      `).join('')}
                    </table>
                  </td>
                </tr>
                
                <!-- Order Summary -->
                <tr>
                  <td style="padding: 25px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000000; border: 1px solid #1a1a1a;">
                      <tr>
                        <td style="padding: 20px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #888888;">Subtotal</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; text-align: right;">$${amountTotal}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #888888;">Shipping</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; text-align: right;">${session.shipping_cost ? '$' + (session.shipping_cost.amount_total / 100).toFixed(2) : 'Calculated'}</td>
                            </tr>
                            <tr>
                              <td colspan="2" style="padding: 15px 0 0 0; border-top: 1px solid #333333;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size: 16px; font-weight: 600; color: #ff1744; text-transform: uppercase; letter-spacing: 1px;">Total</td>
                                    <td style="font-size: 20px; font-weight: 600; color: #ffffff; text-align: right;">$${amountTotal}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Shipping Address -->
                <tr>
                  <td style="padding: 10px 40px 25px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 15px 0; border-bottom: 2px solid #ff1744;">
                          <p style="margin: 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Shipping Address</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 20px 0;">
                          <p style="margin: 0; font-size: 14px; color: #ffffff; line-height: 1.8;">${shippingAddressText}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Shipping Notice -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a0a0a 0%, #000000 100%); border-left: 3px solid #ff1744;">
                      <tr>
                        <td style="padding: 20px 25px;">
                          <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #ff1744; text-transform: uppercase; letter-spacing: 1px;">Shipping Information</p>
                          <p style="margin: 0; font-size: 14px; color: #aaaaaa; line-height: 1.6;">Your order will be processed within 1-2 business days. Once shipped, you will receive a confirmation email with tracking information.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #000000; border-top: 1px solid #1a1a1a; text-align: center;">
                    <p style="margin: 0 0 15px 0; font-size: 18px; letter-spacing: 4px; color: #ffffff;">BLACK ROOM</p>
                    <p style="margin: 0 0 20px 0; font-size: 12px; color: #666666;">Miami's Premier Underground Techno Venue</p>
                    <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <td style="padding: 0 10px;"><a href="https://blackroomus.com" style="font-size: 11px; color: #888888; text-decoration: none; letter-spacing: 1px;">WEBSITE</a></td>
                        <td style="color: #333333;">|</td>
                        <td style="padding: 0 10px;"><a href="https://instagram.com/blackroom.us" style="font-size: 11px; color: #888888; text-decoration: none; letter-spacing: 1px;">INSTAGRAM</a></td>
                      </tr>
                    </table>
                    <p style="margin: 25px 0 0 0; font-size: 11px; color: #444444;">Questions about your order? Reply to this email or contact us at theblackroom.us@gmail.com</p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    
    // Send email to admin
    await emailTransporter.sendMail({
      from: '"BLACK ROOM Orders" <theblackroom.us@gmail.com>',
      to: process.env.EMAIL_USER || 'theblackroom.us@gmail.com',
      subject: `🛒 New Order: $${amountTotal} from ${customerName}`,
      html: adminEmailHtml
    });
    console.log('✅ Admin notification email sent');
    
    // Send email to customer
    if (customerEmail) {
      await emailTransporter.sendMail({
        from: '"BLACK ROOM" <theblackroom.us@gmail.com>',
        to: customerEmail,
        bcc: 'theblackroom.us@gmail.com',
        subject: 'Your BLACK ROOM Order Confirmation',
        html: customerEmailHtml
      });
      console.log('✅ Customer confirmation email sent to:', customerEmail);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error sending order emails:', error);
    return false;
  }
}

// Endpoint to verify payment and send emails (called from success page)
app.get('/api/verify-payment/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId || sessionId === 'undefined') {
      return res.status(400).json({ error: 'Session ID required' });
    }
    
    console.log('🔍 Verifying payment for session:', sessionId);
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status === 'paid') {
      console.log('✅ Payment verified for session:', sessionId);

      // Dedup: only send order emails once per Stripe session.
      // Send FIRST, then record success — so a transient email failure can be retried
      // (the success page cleans the URL, so accidental re-sends are unlikely).
      const pool = (await import('./database/connection.js')).default;
      const already = await pool.query(
        'SELECT 1 FROM order_email_log WHERE stripe_session_id = $1',
        [sessionId]
      );

      let emailsSent = true;
      if (already.rows.length === 0) {
        emailsSent = await sendOrderEmails(session);
        if (emailsSent) {
          await pool.query(
            `INSERT INTO order_email_log (stripe_session_id, customer_email, amount)
             VALUES ($1, $2, $3)
             ON CONFLICT (stripe_session_id) DO NOTHING`,
            [sessionId, session.customer_details?.email || null, (session.amount_total / 100)]
          );
        }
      } else {
        console.log('ℹ️ Order emails already sent for session:', sessionId);
      }

      res.json({ 
        success: true, 
        paid: true,
        emailsSent,
        customerEmail: session.customer_details?.email,
        amount: (session.amount_total / 100).toFixed(2)
      });
    } else {
      res.json({ 
        success: true, 
        paid: false,
        status: session.payment_status
      });
    }
  } catch (error) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({ error: 'Error verifying payment', details: error.message });
  }
});

// Test email endpoint - sends sample order emails
app.get('/api/test-order-email', async (req, res) => {
  try {
    console.log('📧 Sending test order emails...');
    
    const orderNumber = `BR-${Date.now().toString(36).toUpperCase()}`;
    const orderDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    
    // Sample order data
    const testOrder = {
      customerName: 'John Smith',
      customerEmail: 'customer@example.com',
      shippingAddress: '1234 Ocean Drive, Miami Beach, FL 33139, US',
      items: [
        { name: 'Black Room Classic Tee - Size L', quantity: 2, price: 38.50 },
        { name: 'Black Room Logo Tee - Size M', quantity: 1, price: 38.50 }
      ],
      subtotal: 115.50,
      shipping: 0,
      total: 115.50
    };
    
    const itemsHtml = testOrder.items.map(item => `
      <tr>
        <td style="padding: 15px; font-size: 14px; color: #ffffff; border-bottom: 1px solid #1a1a1a;">${item.name}</td>
        <td style="padding: 15px; font-size: 14px; color: #888888; text-align: center; border-bottom: 1px solid #1a1a1a;">${item.quantity}</td>
        <td style="padding: 15px; font-size: 14px; color: #ffffff; text-align: right; border-bottom: 1px solid #1a1a1a;">$${(item.price * item.quantity).toFixed(2)}</td>
      </tr>
    `).join('');
    
    // Admin Email
    const adminEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #000000; font-family: 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000000; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #000000; border: 1px solid #1a1a1a;">
                
                <tr>
                  <td style="padding: 30px 40px; text-align: center; background: linear-gradient(135deg, #ff1744 0%, #d50000 100%);">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 2px; color: #ffffff;">NEW ORDER RECEIVED</h1>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 30px 40px; background-color: #000000; text-align: center; border-bottom: 1px solid #1a1a1a;">
                    <p style="margin: 0 0 5px 0; font-size: 12px; letter-spacing: 2px; color: #666666; text-transform: uppercase;">Order Number</p>
                    <p style="margin: 0 0 15px 0; font-size: 20px; font-weight: 600; color: #ffffff;">${orderNumber}</p>
                    <p style="margin: 0; font-size: 32px; font-weight: 700; color: #ff1744;">$${testOrder.total.toFixed(2)}</p>
                    <p style="margin: 10px 0 0 0; font-size: 12px; color: #666666;">${orderDate}</p>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 25px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 15px 0; border-bottom: 2px solid #ff1744;">
                          <p style="margin: 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Customer Information</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 20px 0;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding: 8px 0; font-size: 13px; color: #666666; width: 100px;">Name:</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; font-weight: 500;">${testOrder.customerName}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 13px; color: #666666;">Email:</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ff1744;"><a href="mailto:${testOrder.customerEmail}" style="color: #ff1744; text-decoration: none;">${testOrder.customerEmail}</a></td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 13px; color: #666666; vertical-align: top;">Ship To:</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; line-height: 1.6;">${testOrder.shippingAddress}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 0 40px 25px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 15px 0; border-bottom: 2px solid #ff1744;">
                          <p style="margin: 0; font-size: 11px; letter-spacing: 2px; color: #ff1744; text-transform: uppercase;">Order Items</p>
                        </td>
                      </tr>
                    </table>
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 15px;">
                      <tr style="background-color: #000000;">
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; border-bottom: 1px solid #1a1a1a;">Product</td>
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a1a;">Qty</td>
                        <td style="padding: 12px 15px; font-size: 10px; letter-spacing: 1px; color: #666666; text-transform: uppercase; text-align: right; border-bottom: 1px solid #1a1a1a;">Price</td>
                      </tr>
                      ${itemsHtml}
                    </table>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000000; border: 1px solid #1a1a1a;">
                      <tr>
                        <td style="padding: 20px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #888888;">Subtotal</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; text-align: right;">$${testOrder.subtotal.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0; font-size: 14px; color: #888888;">Shipping</td>
                              <td style="padding: 8px 0; font-size: 14px; color: #ffffff; text-align: right;">FREE</td>
                            </tr>
                            <tr>
                              <td colspan="2" style="padding: 15px 0 0 0; border-top: 1px solid #333333;">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size: 16px; font-weight: 600; color: #ff1744; text-transform: uppercase; letter-spacing: 1px;">TOTAL</td>
                                    <td style="font-size: 24px; font-weight: 700; color: #ffffff; text-align: right;">$${testOrder.total.toFixed(2)}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 0 40px 30px 40px; text-align: center;">
                    <a href="https://dashboard.stripe.com/payments" style="display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #ff1744 0%, #d50000 100%); color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; border-radius: 3px;">View in Stripe Dashboard</a>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 20px 40px; background-color: #000000; border-top: 1px solid #1a1a1a; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #444444;">BLACK ROOM - Order Notification System</p>
                    <p style="margin: 8px 0 0 0; font-size: 11px; color: #333333;">This is a TEST email</p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    
    // Customer Email HTML (what the buyer receives)
    const customerEmailHtml = `
      <!DOCTYPE html><html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin:0;padding:0;background-color:#000000;font-family:'Helvetica Neue',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;padding:40px 20px;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#000000;border:1px solid #1a1a1a;">
              <tr><td style="padding:40px 40px 30px 40px;text-align:center;border-bottom:1px solid #1a1a1a;">
                <h1 style="margin:0;font-size:32px;font-weight:300;letter-spacing:8px;color:#ffffff;">BLACK ROOM</h1>
                <p style="margin:15px 0 0 0;font-size:12px;letter-spacing:3px;color:#666666;text-transform:uppercase;">Miami's Underground Techno Experience</p>
              </td></tr>
              <tr><td style="padding:30px 40px;background:linear-gradient(135deg,#1a1a1a 0%,#000000 100%);text-align:center;">
                <p style="margin:0 0 10px 0;font-size:11px;letter-spacing:2px;color:#ff1744;text-transform:uppercase;">Order Confirmed</p>
                <h2 style="margin:0;font-size:24px;font-weight:400;color:#ffffff;">Thank You for Your Order</h2>
                <p style="margin:15px 0 0 0;font-size:14px;color:#888888;">Order #${orderNumber}</p>
              </td></tr>
              <tr><td style="padding:30px 40px 20px 40px;">
                <p style="margin:0;font-size:16px;color:#ffffff;line-height:1.6;">Dear ${testOrder.customerName},</p>
                <p style="margin:15px 0 0 0;font-size:14px;color:#aaaaaa;line-height:1.8;">We're thrilled to confirm your order. Your items are being prepared with care and will be shipped shortly. Below you'll find all the details of your purchase.</p>
              </td></tr>
              <tr><td style="padding:10px 40px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:15px 0;border-bottom:2px solid #ff1744;">
                    <p style="margin:0;font-size:11px;letter-spacing:2px;color:#ff1744;text-transform:uppercase;">Order Details</p>
                  </td></tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 40px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:12px 15px;font-size:10px;letter-spacing:1px;color:#666666;text-transform:uppercase;border-bottom:1px solid #1a1a1a;">Item</td>
                    <td style="padding:12px 15px;font-size:10px;letter-spacing:1px;color:#666666;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a1a1a;">Qty</td>
                    <td style="padding:12px 15px;font-size:10px;letter-spacing:1px;color:#666666;text-transform:uppercase;text-align:right;border-bottom:1px solid #1a1a1a;">Price</td>
                  </tr>
                  ${testOrder.items.map(item => `
                  <tr>
                    <td style="padding:18px 15px;font-size:14px;color:#ffffff;border-bottom:1px solid #1a1a1a;">${item.name}</td>
                    <td style="padding:18px 15px;font-size:14px;color:#888888;text-align:center;border-bottom:1px solid #1a1a1a;">${item.quantity}</td>
                    <td style="padding:18px 15px;font-size:14px;color:#ffffff;text-align:right;border-bottom:1px solid #1a1a1a;">$${(item.price * item.quantity).toFixed(2)}</td>
                  </tr>`).join('')}
                </table>
              </td></tr>
              <tr><td style="padding:25px 40px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1a1a1a;">
                  <tr><td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;font-size:14px;color:#888888;">Subtotal</td>
                        <td style="padding:8px 0;font-size:14px;color:#ffffff;text-align:right;">$${testOrder.subtotal.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;font-size:14px;color:#888888;">Shipping</td>
                        <td style="padding:8px 0;font-size:14px;color:#22c55e;text-align:right;">Free</td>
                      </tr>
                      <tr><td colspan="2" style="padding:15px 0 0 0;border-top:1px solid #333333;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-size:16px;font-weight:600;color:#ffffff;text-transform:uppercase;letter-spacing:1px;">Total</td>
                            <td style="font-size:24px;font-weight:700;color:#ffffff;text-align:right;">$${testOrder.total.toFixed(2)}</td>
                          </tr>
                        </table>
                      </td></tr>
                    </table>
                  </td></tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 40px 30px 40px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:15px 0;border-bottom:2px solid #ff1744;">
                    <p style="margin:0;font-size:11px;letter-spacing:2px;color:#ff1744;text-transform:uppercase;">Shipping Address</p>
                  </td></tr>
                  <tr><td style="padding:20px 0;font-size:14px;color:#ffffff;line-height:1.8;">${testOrder.shippingAddress}</td></tr>
                </table>
              </td></tr>
              <tr><td style="padding:20px 40px 30px 40px;text-align:center;border-top:1px solid #1a1a1a;">
                <p style="margin:0 0 5px 0;font-size:12px;color:#666666;">Questions about your order?</p>
                <a href="mailto:theblackroom.us@gmail.com" style="font-size:13px;color:#ffffff;text-decoration:none;">theblackroom.us@gmail.com</a>
              </td></tr>
              <tr><td style="padding:20px 40px;background-color:#000000;border-top:1px solid #1a1a1a;text-align:center;">
                <p style="margin:0;font-size:12px;color:#444444;">© BLACK ROOM MIAMI</p>
                <p style="margin:8px 0 0 0;font-size:11px;color:#333333;">⚠️ This is a TEST email — preview only</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>`;

    // Send admin notification
    await emailTransporter.sendMail({
      from: '"BLACK ROOM Orders" <theblackroom.us@gmail.com>',
      to: process.env.EMAIL_USER || 'theblackroom.us@gmail.com',
      subject: `🧪 [TEST] New Order: $${testOrder.total.toFixed(2)} from ${testOrder.customerName}`,
      html: adminEmailHtml
    });

    // Send customer confirmation preview (to your inbox so you can see exactly what buyers get)
    await emailTransporter.sendMail({
      from: '"BLACK ROOM" <theblackroom.us@gmail.com>',
      to: process.env.EMAIL_USER || 'theblackroom.us@gmail.com',
      subject: `🧪 [TEST — Customer View] Your BLACK ROOM Order Confirmation`,
      html: customerEmailHtml
    });

    console.log('✅ Test order emails sent (admin + customer preview)');
    
    res.json({ 
      success: true, 
      message: 'Both test emails sent to ' + (process.env.EMAIL_USER || 'theblackroom.us@gmail.com'),
      orderNumber,
      note: 'Check your inbox: one email shows what YOU receive (admin), the other shows what THE BUYER receives.'
    });
    
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    res.status(500).json({ error: 'Failed to send test email', details: error.message });
  }
});

// Event image extraction endpoint with enhanced error handling
app.post('/api/extract-event-image', async (req, res) => {
  try {
    console.log('🔍 Event image extraction request received');
    console.log('📤 Request body:', JSON.stringify(req.body, null, 2));

    // Validación más robusta del body y URL
    if (!req.body || Object.keys(req.body).length === 0) {
      console.warn('❌ No request body provided');
      return res.status(400).json({ 
        success: false, 
        error: 'No se recibió información en la solicitud',
        timestamp: new Date().toISOString()
      });
    }

    const { url } = req.body;

    // Verificar múltiples formas de recibir la URL
    const finalUrlInput = url || req.body.eventUrl || req.body.link || req.body.uri;

    if (!finalUrlInput) {
      console.warn('❌ No URL provided in request body');
      console.log('🔍 Available keys in body:', Object.keys(req.body));
      return res.status(400).json({ 
        success: false, 
        error: 'URL requerida - por favor ingresa un enlace válido',
        receivedBody: req.body,
        availableKeys: Object.keys(req.body),
        timestamp: new Date().toISOString()
      });
    }

    if (typeof finalUrlInput !== 'string') {
      console.warn('❌ URL is not a string:', typeof finalUrlInput, finalUrlInput);
      return res.status(400).json({ 
        success: false, 
        error: 'URL debe ser texto válido',
        receivedType: typeof finalUrlInput,
        receivedValue: finalUrlInput,
        timestamp: new Date().toISOString()
      });
    }

    const cleanUrl = finalUrlInput.trim();

    if (cleanUrl === '') {
      console.warn('❌ Empty URL after trimming');
      return res.status(400).json({ 
        success: false, 
        error: 'URL no puede estar vacía',
        timestamp: new Date().toISOString()
      });
    }

    // Enhanced URL validation - be more flexible with protocols
    let urlObj;
    let finalUrl = cleanUrl;

    // Add protocol if missing
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      finalUrl = 'https://' + cleanUrl;
      console.log('🔧 Added HTTPS protocol to URL:', finalUrl);
    }

    // Special handling for common event platforms
    const eventPlatforms = ['posh.vip', 'eventbrite.com', 'facebook.com', 'instagram.com'];
    const isEventPlatform = eventPlatforms.some(platform => finalUrl.includes(platform));

    try {
      urlObj = new URL(finalUrl);
      console.log('✅ URL validation passed:', urlObj.hostname);

      if (isEventPlatform) {
        console.log('🎟️ Detected event platform:', urlObj.hostname);
      }
    } catch (urlError) {
      console.warn('❌ URL validation failed:', urlError);
      return res.status(400).json({ 
        success: false, 
        error: 'Formato de URL inválido - verifica que sea una URL válida de evento (ej: posh.vip/e/evento-nombre)',
        providedUrl: cleanUrl,
        processedUrl: finalUrl,
        suggestions: [
          'Asegúrate de incluir el dominio completo',
          'Ejemplo: posh.vip/e/nombre-del-evento',
          'Ejemplo: eventbrite.com/e/evento-123'
        ],
        timestamp: new Date().toISOString()
      });
    }

    // Dynamic import of node-fetch
    const { default: fetch } = await import('node-fetch');

    console.log('🌐 Fetching content from:', finalUrl);

    // Enhanced request with better headers and multiple retry strategies
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];

    let response;
    let lastError;

    // Try multiple user agents and strategies
    for (let attempt = 0; attempt < userAgents.length; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt + 1} with user agent: ${userAgents[attempt].substring(0, 50)}...`);

        const headers = {
          'User-Agent': userAgents[attempt],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8,fr;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1'
        };

        // Add Chrome-specific headers for Chrome user agents
        if (userAgents[attempt].includes('Chrome')) {
          headers['Sec-Ch-Ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
          headers['Sec-Ch-Ua-Mobile'] = '?0';
          headers['Sec-Ch-Ua-Platform'] = '"Windows"';
        }

        response = await fetch(finalUrl, {
          method: 'GET',
          headers: headers,
          timeout: 25000,
          follow: 10,
          compress: true,
          size: 50 * 1024 * 1024 // 50MB limit
        });

        if (response.ok) {
          console.log(`✅ Success on attempt ${attempt + 1}`);
          break;
        } else {
          console.log(`⚠️ Attempt ${attempt + 1} returned ${response.status}`);
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

      } catch (fetchError) {
        console.log(`❌ Attempt ${attempt + 1} failed:`, fetchError.message);
        lastError = fetchError;

        // Wait a bit before next attempt
        if (attempt < userAgents.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // If all attempts failed
    if (!response || !response.ok) {
      console.error('❌ All fetch attempts failed');
      return res.status(500).json({
        success: false,
        error: 'No se pudo conectar con el sitio web. Verifica que la URL sea accesible y esté funcionando correctamente.',
        details: lastError ? lastError.message : 'All connection attempts failed',
        url: finalUrl,
        timestamp: new Date().toISOString()
      });
    }

    const contentType = response.headers.get('content-type') || '';
    console.log('📋 Content type:', contentType);

    // Check if response is HTML or acceptable content
    if (!contentType.includes('text/html') && 
        !contentType.includes('application/xhtml') && 
        !contentType.includes('text/plain') &&
        !contentType.includes('application/xml')) {

      console.warn('❌ Unexpected content type:', contentType);
      return res.status(400).json({
        success: false,
        error: 'El enlace no apunta a una página web válida (HTML esperado)',
        contentType: contentType,
        timestamp: new Date().toISOString()
      });
    }

    let html;
    try {
      html = await response.text();
      console.log('📄 HTML content length:', html.length);
    } catch (textError) {
      console.error('❌ Error reading response text:', textError);
      return res.status(500).json({
        success: false,
        error: 'Error al leer el contenido de la página web',
        details: textError.message,
        timestamp: new Date().toISOString()
      });
    }

    if (html.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'La página web parece estar vacía o no contiene contenido suficiente',
        htmlLength: html.length,
        timestamp: new Date().toISOString()
      });
    }

    console.log('🔍 Extracting metadata from HTML...');

    // Enhanced image extraction with multiple strategies and better patterns
    let finalImageUrl = null;
    let title = null;
    let description = null;
    let foundBy = null;

    // Function to safely extract with multiple patterns
    const safeExtractMultiple = (html, patterns, name) => {
      for (const pattern of patterns) {
        try {
          const match = html.match(pattern);
          if (match && match[1] && match[1].trim()) {
            console.log(`✅ Found ${name} with pattern:`, pattern.toString().substring(0, 50));
            return match[1].trim();
          }
        } catch (error) {
          console.warn(`⚠️ Pattern error for ${name}:`, error.message);
        }
      }
      return null;
    };

    // Strategy 1: OpenGraph images (most reliable)
    const ogImagePatterns = [
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /<meta[^>]*property=['"]og:image['"][^>]*content=['"]([^'"]+)['"]>/i,
      /<meta[^>]*content=['"]([^'"]+)['"][^>]*property=['"]og:image['"]>/i
    ];

    finalImageUrl = safeExtractMultiple(html, ogImagePatterns, 'OpenGraph image');
    if (finalImageUrl) foundBy = 'OpenGraph og:image';

    // Strategy 2: Twitter card images
    if (!finalImageUrl) {
      const twitterImagePatterns = [
        /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
        /<meta[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/i,
        /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image:src["']/i
      ];

      finalImageUrl = safeExtractMultiple(html, twitterImagePatterns, 'Twitter image');
      if (finalImageUrl) foundBy = 'Twitter Card';
    }

    // Strategy 3: JSON-LD structured data
    if (!finalImageUrl) {
      const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
      if (jsonLdMatches) {
        for (const jsonMatch of jsonLdMatches) {
          try {
            const jsonContent = jsonMatch.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
            const data = JSON.parse(jsonContent);

            if (data.image) {
              if (typeof data.image === 'string') {
                finalImageUrl = data.image;
                foundBy = 'JSON-LD image (string)';
                break;
              } else if (Array.isArray(data.image) && data.image.length > 0) {
                finalImageUrl = typeof data.image[0] === 'string' ? data.image[0] : data.image[0].url;
                foundBy = 'JSON-LD image (array)';
                break;
              } else if (data.image.url) {
                finalImageUrl = data.image.url;
                foundBy = 'JSON-LD image (object)';
                break;
              }
            }
          } catch (jsonError) {
            console.warn('⚠️ Error parsing JSON-LD:', jsonError.message);
          }
        }
      }
    }

    // Strategy 4: Look for event/banner images in img tags
    if (!finalImageUrl) {
      const imgMatches = [...html.matchAll(/<img[^>]+>/gi)];

      for (const imgMatch of imgMatches) {
        const imgTag = imgMatch[0];
        const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);

        if (srcMatch && srcMatch[1]) {
          const imgSrc = srcMatch[1].trim();

          // Check if it's a valid image and looks like a main/event image
          if (imgSrc.match(/\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i)) {
            const imgUrl = imgSrc.toLowerCase();

            // Priority keywords for event images
            const eventKeywords = ['event', 'banner', 'hero', 'main', 'cover', 'featured', 'poster', 'flyer'];
            const hasEventKeyword = eventKeywords.some(keyword => imgUrl.includes(keyword));

            if (hasEventKeyword) {
              finalImageUrl = imgSrc;
              foundBy = 'IMG tag (event keyword)';
              break;
            }
          }
        }
      }
    }

    // Strategy 5: Look for larger images (by dimensions or file size indicators)
    if (!finalImageUrl) {
      const imgMatches = [...html.matchAll(/<img[^>]+>/gi)];

      for (const imgMatch of imgMatches) {
        const imgTag = imgMatch[0];
        const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);

        if (srcMatch && srcMatch[1]) {
          const imgSrc = srcMatch[1].trim();

          if (imgSrc.match(/\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i)) {
            // Skip obvious icons/logos/small images
            const imgUrl = imgSrc.toLowerCase();
            const skipKeywords = ['icon', 'logo', 'avatar', 'thumb', 'small', 'mini'];
            const shouldSkip = skipKeywords.some(keyword => imgUrl.includes(keyword));

            if (!shouldSkip) {
              // Check for size indicators in the img tag
              const widthMatch = imgTag.match(/width=["']?(\d+)/i);
              const heightMatch = imgTag.match(/height=["']?(\d+)/i);

              if (widthMatch && parseInt(widthMatch[1]) >= 300) {
                finalImageUrl = imgSrc;
                foundBy = 'IMG tag (large width)';
                break;
              } else if (heightMatch && parseInt(heightMatch[1]) >= 200) {
                finalImageUrl = imgSrc;
                foundBy = 'IMG tag (large height)';
                break;
              }
            }
          }
        }
      }
    }

    // Strategy 6: First reasonable image as fallback
    if (!finalImageUrl) {
      const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];

      for (const imgMatch of imgMatches) {
        const imgSrc = imgMatch[1].trim();

        if (imgSrc.match(/\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i)) {
          const imgUrl = imgSrc.toLowerCase();
          const skipKeywords = ['icon', 'logo', 'avatar', 'button', 'bullet', 'arrow'];
          const shouldSkip = skipKeywords.some(keyword => imgUrl.includes(keyword));

          if (!shouldSkip && imgSrc.length > 10) {
            finalImageUrl = imgSrc;
            foundBy = 'First reasonable IMG tag';
            break;
          }
        }
      }
    }

    // Extract title with enhanced patterns
    const titlePatterns = [
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
      /<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i
    ];

    title = safeExtractMultiple(html, titlePatterns, 'title');

    // Extract description with enhanced patterns
    const descPatterns = [
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i,
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i
    ];

    description = safeExtractMultiple(html, descPatterns, 'description');

    // If no image found, return detailed error
    if (!finalImageUrl) {
      console.warn('❌ No image found after trying all strategies');

      // Analyze what was found for debugging
      const debugInfo = {
        hasOgTags: html.includes('og:image'),
        hasTwitterTags: html.includes('twitter:image'),
        hasImgTags: html.includes('<img'),
        hasJsonLd: html.includes('application/ld+json'),
        imgTagCount: (html.match(/<img[^>]+>/gi) || []).length,
        htmlLength: html.length,
        title: title,
        description: description,
        contentType: contentType,
        url: finalUrl
      };

      return res.status(404).json({
        success: false,
        error: 'No se encontró ninguna imagen en esta página web. La página puede no tener imágenes de eventos o usar un formato no compatible.',
        strategiesAttempted: [
          'OpenGraph og:image',
          'Twitter Card images',
          'JSON-LD structured data',
          'IMG tags with event keywords',
          'IMG tags with large dimensions',
          'First reasonable IMG tag'
        ],
        debug: debugInfo,
        suggestions: [
          'Verifica que la URL sea correcta y accesible',
          'Asegúrate de que la página contenga imágenes',
          'Intenta con una URL diferente del mismo evento'
        ],
        timestamp: new Date().toISOString()
      });
    }

    // Ensure image URL is absolute
    if (finalImageUrl.startsWith('//')) {
      finalImageUrl = 'https:' + finalImageUrl;
    } else if (finalImageUrl.startsWith('/')) {
      finalImageUrl = urlObj.origin + finalImageUrl;
    }

    // Validate final image URL after potential modifications
    try {
      new URL(finalImageUrl);
    } catch (imageUrlError) {
      console.warn('❌ Invalid final image URL after resolving:', finalImageUrl);
      return res.status(400).json({
        success: false,
        error: 'La URL de imagen extraída no es válida o está mal formada',
        extractedImageUrl: finalImageUrl,
        originalUrl: cleanUrl,
        timestamp: new Date().toISOString()
      });
    }

    const eventInfo = {
      title: title || 'Evento sin título',
      description: description || 'Sin descripción disponible'
    };

    const successResponse = { 
      success: true,
      imageUrl: finalImageUrl,
      originalUrl: cleanUrl,
      eventInfo: eventInfo,
      extractionMethod: foundBy || 'unknown',
      timestamp: new Date().toISOString()
    };

    console.log('✅ Successfully extracted event info:', successResponse);
    res.json(successResponse);

  } catch (error) {
    console.error('❌ Unexpected error in event extraction:', error);

    // Prevent segmentation fault by handling all errors gracefully
    const errorResponse = { 
      success: false,
      error: 'Error interno del servidor al procesar la solicitud',
      errorType: error.name || 'UnknownError',
      timestamp: new Date().toISOString()
    };

    // Only include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.message;
      errorResponse.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
});

// Serve HTML files
// Favicon route
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Serve components
app.get('/components/:component', (req, res) => {
  const componentPath = path.join(__dirname, 'public', 'components', req.params.component);
  if (fs.existsSync(componentPath)) {
    res.sendFile(componentPath);
  } else {
    res.status(404).send('Component not found');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add comprehensive storage endpoint
app.get('/api/storage/*', (req, res) => {
  const filePath = req.params[0];
  console.log(`📁 Storage request for: ${filePath}`);

  // Try multiple possible locations
  const possiblePaths = [
    path.join(__dirname, 'public', 'images', 'product-images', filePath),
    path.join(__dirname, 'public', 'images', filePath),
    path.join(__dirname, 'storage', filePath),
    path.join(__dirname, filePath)
  ];

  for (const fullPath of possiblePaths) {
    if (fs.existsSync(fullPath)) {
      console.log(`✅ Found file at: ${fullPath}`);
      return res.sendFile(fullPath);
    }
  }

  console.log(`❌ File not found in any location: ${filePath}`);
  console.log(`🔍 Tried paths:`, possiblePaths);

  // Return default logo as fallback
  const logoPath = path.join(__dirname, 'public', 'images', 'logo.png');
  if (fs.existsSync(logoPath)) {
    return res.sendFile(logoPath);
  } else {
    return res.status(404).json({ error: 'File not found' });
  }
});

// Add direct events endpoint for frontend - returns ALL events (for calendar.html)
app.get('/api/events', (req, res) => {
  try {
    const eventsPath = path.join(__dirname, 'db/events.json');
    if (!fs.existsSync(eventsPath)) {
      console.log('⚠️ events.json not found, returning empty array.');
      return res.json([]);
    }

    const eventsData = fs.readFileSync(eventsPath, 'utf8');
    const allEvents = JSON.parse(eventsData || '[]');

    console.log(`📅 /api/events - Returning ALL ${allEvents.length} events for calendar`);
    res.json(allEvents);
    return;

    // Filter future events
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today

    const futureEvents = allEvents.filter(event => {
      if (!event.date) {
        console.log('Skipping event with no date:', event);
        return false;
      }

      try {
        // Try parsing the date in various formats
        let eventDate = new Date(event.date);

        // If invalid, try common formats (e.g., "Month Day, Year" or "YYYY-MM-DD")
        if (isNaN(eventDate.getTime())) {
          const commonFormats = [
            new Date(event.date.replace(/(\w+),?\s*(\w+)\s+(\d+),?\s*(\d+)/, '$2 $3, $4')), // e.g., "Friday, December 13, 2024" or "December 13, 2024"
            new Date(event.date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3/$1')), // e.g., "2024-12-13" -> "12/13/2024"
            new Date(event.date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$1/$2/$3')), // e.g., "13/12/2024" -> "12/13/2024"
          ];
          for (const format of commonFormats) {
            if (!isNaN(format.getTime())) {
              eventDate = format;
              break;
            }
          }
        }

        if (!isNaN(eventDate.getTime())) {
          eventDate.setHours(23, 59, 59, 999); // End of the day for comparison
          return eventDate >= now;
        } else {
          console.error("Could not parse event date:", event.date, "for event:", event);
          return false;
        }
      } catch (error) {
        console.error("Error processing event date:", event.date, error, "for event:", event);
        return false;
      }
    });

    console.log(`📅 Events loaded: ${allEvents.length} total, ${futureEvents.length} future events`);
    res.json(futureEvents);
  } catch (error) {
    console.error('❌ Error loading events:', error);
    res.status(500).json({ error: 'Error loading events' });
  }
});

// ============================================
// KONG EVENTS API - Upcoming events from Kong Nightlife
// ============================================

// Import Kong scraper functions
let kongScraperModule = null;
async function loadKongScraper() {
  if (!kongScraperModule) {
    try {
      kongScraperModule = await import('./scripts/kong-scraper.js');
    } catch (err) {
      console.error('❌ Could not load Kong scraper:', err.message);
    }
  }
  return kongScraperModule;
}

// Main Kong events endpoint. /api/posh-events remains as a backward-compatible alias.
const KONG_PROFILE_URL = 'https://kongnightlife.com/user/414d4b95-6e98-4e2b-8a88-1d660f8f1e1b';
const KONG_CACHE_MAX_AGE_HOURS = Number.parseFloat(process.env.KONG_CACHE_MAX_AGE_HOURS || '12');
let kongRefreshPromise = null;
const KONG_EVENT_FIXES = {
  'BLACK ROOM & FRIENDS': {
    url: 'https://kongnightlife.com/event/2f1baef4-8bd9-49e6-aec4-a388e66ec684',
    address: 'CASA NUBE WYNWOOD 2060 NW 1st Ave, Miami, FL 33127, USA',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1780593125852-121208103.jpg'
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
    title: 'RAVE CUP: World Cup Quarter Finals Watch Party + Rave',
    fullTitle: 'RAVE CUP: World Cup Quarter Finals Watch Party + Rave',
    description: 'Watch Party + Rave by Black Room at Casa Nube Wynwood. Contact: info@blackroom.live or DM @blackroom.us',
    image: 'https://kongnightlife.com/api/objects/public/uploads/1781805548912-827539442.jpg',
    imageUrl: 'https://kongnightlife.com/api/objects/public/uploads/1781805548912-827539442.jpg',
    dateText: 'Jul 11 · 3:00 PM',
    parsedDate: '2026-07-11',
    date: '2026-07-11',
    time: '3:00 PM',
    location: 'Casa Nube Wynwood',
    address: 'Casa Nube Wynwood 2060 NW 1st Ave, Miami, FL 33127, USA',
    slug: 'rave-cup-world-cup-quarter-finals-watch-party-rave-2026-07-11',
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

function addMissingKnownKongEvents(allEvents, today) {
  for (const event of KNOWN_BLACK_ROOM_KONG_EVENTS) {
    const eventDate = parseDateAtLocalMidnight(event.date);
    if (!isNaN(eventDate.getTime()) && eventDate < today) continue;

    const exists = allEvents.some(e => {
      const eventTitle = (e.title || e.fullTitle || '').toLowerCase();
      return eventTitle === event.title.toLowerCase() ||
        e.kongUrl === event.kongUrl ||
        e.ticketUrl === event.ticketUrl ||
        e.purchaseUrl === event.purchaseUrl ||
        e.detailUrl === event.detailUrl;
    });

    if (!exists) allEvents.push({ ...event });
  }
}

function parseDateAtLocalMidnight(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) date.setHours(0, 0, 0, 0);
  return date;
}

function getKongCacheAgeHours(cachePath) {
  if (!fs.existsSync(cachePath)) return Number.POSITIVE_INFINITY;

  try {
    const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const updatedAt = new Date(cacheData.lastUpdated);
    if (Number.isNaN(updatedAt.getTime())) return Number.POSITIVE_INFINITY;
    return (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function refreshKongEventsCache(reason = 'scheduled') {
  if (kongRefreshPromise) return kongRefreshPromise;

  kongRefreshPromise = (async () => {
    const scraper = await loadKongScraper();
    if (!scraper?.scrapeKongEvents) {
      throw new Error('Kong scraper not available');
    }

    console.log(`🔄 Refreshing Kong events cache (${reason})...`);
    const events = await scraper.scrapeKongEvents();
    console.log(`✅ Kong events cache refreshed (${events.length} events)`);
    return events;
  })().finally(() => {
    kongRefreshPromise = null;
  });

  return kongRefreshPromise;
}

async function handleKongEventsRequest(req, res) {
  try {
    const allEvents = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const cachePath = path.join(__dirname, 'db/kong-events-cache.json');
    const cacheAgeHours = getKongCacheAgeHours(cachePath);

    if (cacheAgeHours >= KONG_CACHE_MAX_AGE_HOURS || req.query.refresh === '1') {
      try {
        await refreshKongEventsCache(req.query.refresh === '1' ? 'manual request' : `stale cache ${cacheAgeHours.toFixed(1)}h`);
      } catch (error) {
        console.error('❌ Kong events refresh failed:', error.message);
      }
    }
    
    // PRIORITY 1: Load manual events (most reliable)
    const manualPath = path.join(__dirname, 'db/manual-events.json');
    if (fs.existsSync(manualPath)) {
      const manualData = JSON.parse(fs.readFileSync(manualPath, 'utf-8'));
      if (manualData.events && manualData.events.length > 0) {
        for (const event of manualData.events) {
          const eventDate = new Date(event.date);
          if (eventDate >= now) {
            const manualEvent = {
              title: event.title,
              fullTitle: event.title,
              description: event.description || `${event.title} at ${event.venue || event.location || 'Miami, FL'}`,
              image: event.image,
              imageUrl: event.image,
              dateText: event.date,
              date: event.date,
              time: event.time || '11:00 PM',
              location: event.location || 'Miami, FL',
              venue: event.venue,
              address: event.address || '',
              slug: event.title.toLowerCase().replace(/\s+/g, '-'),
              poshUrl: event.ticketUrl,
              kongUrl: event.ticketUrl,
              ticketUrl: event.ticketUrl,
              purchaseUrl: event.ticketUrl,
              detailUrl: event.ticketUrl,
              price: event.price || '$25+',
              source: event.source || 'manual'
            };

            if (isBlackRoomEvent(manualEvent)) allEvents.push(manualEvent);
          }
        }
        console.log(`📋 Loaded ${allEvents.length} manual events`);
      }
    }
    
    // PRIORITY 2: Load Kong Nightlife cached events
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const hoursSinceUpdate = (Date.now() - new Date(cacheData.lastUpdated)) / (1000 * 60 * 60);
      console.log(`📦 Kong events cache: ${cacheData.eventCount} events, ${hoursSinceUpdate.toFixed(1)}h old`);
      
      for (const event of (cacheData.events || [])) {
        const eventTitle = event.title || (event.fullTitle || '').split('|')[0].trim();
        const eventDate = event.parsedDate || event.date;
        const exists = allEvents.some(e =>
          (e.poshUrl === event.poshUrl) ||
          (e.kongUrl && event.kongUrl && e.kongUrl === event.kongUrl) ||
          (e.title.toLowerCase() === eventTitle.toLowerCase() && e.date === eventDate)
        );
        if (exists) continue;

        const dateStr = event.parsedDate || event.dateText;
        if (dateStr) {
          try {
            const eventDate = parseDateAtLocalMidnight(dateStr);
            if (!isNaN(eventDate.getTime()) && eventDate < now) continue;
          } catch {}
        }

        const normalizedEvent = normalizeKongEvent({
          ...event,
          title: eventTitle,
          date: event.parsedDate || event.date,
          source: 'kong-cache'
        });

        if (isBlackRoomEvent(normalizedEvent)) allEvents.push(normalizedEvent);
      }
    } else {
      const scraper = await loadKongScraper();
      if (scraper) {
        try {
          const events = await scraper.getUpcomingKongEvents();
          allEvents.push(...events
            .map(event => normalizeKongEvent({
              ...event,
              date: event.parsedDate || event.date,
              source: 'kong-cache'
            }))
            .filter(isBlackRoomEvent));
        } catch (error) {
          console.error('❌ Kong events refresh failed:', error.message);
        }
      }
    }

    addMissingKnownKongEvents(allEvents, now);
    
    // Sort by date ascending
    allEvents.sort((a, b) => {
      const dateA = parseDateAtLocalMidnight(a.date || a.dateText || '2099-01-01');
      const dateB = parseDateAtLocalMidnight(b.date || b.dateText || '2099-01-01');
      return dateA - dateB;
    });
    
    console.log(`✅ Returning ${allEvents.length} upcoming events (manual + kong)`);
    
    return res.json({
      success: true,
      lastUpdated: new Date().toISOString(),
      source: 'kong',
      events: allEvents
    });
  } catch (error) {
    console.error('❌ Error loading events:', error.message);
    res.status(500).json({ error: 'Error loading events' });
  }
}

app.get('/api/kong-events', handleKongEventsRequest);
app.get('/api/posh-events', handleKongEventsRequest);

// Zoho WorkDrive token management
let zohoAccessToken = null;
let zohoTokenExpiry = 0;

async function getZohoAccessToken() {
  if (zohoAccessToken && Date.now() < zohoTokenExpiry) {
    return zohoAccessToken;
  }

  try {
    const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN
      })
    });

    const data = await response.json();
    
    if (data.access_token) {
      zohoAccessToken = data.access_token;
      zohoTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
      console.log('✅ Zoho access token refreshed');
      return zohoAccessToken;
    }
    return null;
  } catch (error) {
    console.error('❌ Zoho token error:', error.message);
    return null;
  }
}

// Zoho external link mappings
const ZOHO_FOLDERS = {
  'main': 'a9ec7d396000a41ae93f70f20826d2236750cc93d83cf8f59b21ac025eb93422',
  '2026': 'ca037c19e61557a703a7d09674fa2d52fa5f0862d696728272a32b470083a7b3'
};

// Gallery events API - returns photo gallery data with local images
app.get('/api/gallery-events', (req, res) => {
  try {
    const galleryPath = path.join(__dirname, 'db/gallery-events.json');
    const galleryImagesDir = path.join(__dirname, 'public/images/gallery');
    
    if (!fs.existsSync(galleryPath)) {
      console.log('⚠️ gallery-events.json not found');
      return res.json([]);
    }
    
    const galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
    
    const eventsWithImages = galleryData.map(event => {
      const folderPath = path.join(galleryImagesDir, event.folder);
      let images = [];
      
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath);
        images = files
          .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
          .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/) || [0]);
            const numB = parseInt(b.match(/\d+/) || [0]);
            return numA - numB;
          })
          .map(file => `/images/gallery/${event.folder}/${file}`);
      }
      
      return {
        ...event,
        images,
        hasImages: images.length > 0
      };
    });
    
    console.log(`📸 Returning ${eventsWithImages.length} gallery events`);
    res.json(eventsWithImages);
  } catch (error) {
    console.error('❌ Error loading gallery events:', error.message);
    res.status(500).json({ error: 'Error loading gallery events' });
  }
});

// Sync gallery images from Zoho WorkDrive
app.post('/api/admin/sync-zoho-gallery', async (req, res) => {
  try {
    const token = await getZohoAccessToken();
    if (!token) {
      return res.status(500).json({ error: 'Failed to get Zoho token' });
    }

    const galleryPath = path.join(__dirname, 'db/gallery-events.json');
    const galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
    const galleryImagesDir = path.join(__dirname, 'public/images/gallery');

    let totalDownloaded = 0;

    for (const event of galleryData) {
      if (!event.zohoFolder || !event.zohoParent) continue;
      
      const externalId = ZOHO_FOLDERS[event.zohoParent];
      if (!externalId) continue;

      console.log(`📂 Syncing: ${event.title}`);
      
      try {
        const listUrl = `https://workdrive.zoho.com/api/v1/files?parent_id=${externalId}`;
        const listRes = await fetch(listUrl, {
          headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
        });
        
        if (listRes.ok) {
          const folderData = await listRes.json();
          console.log(`Found folder data for ${event.title}`);
        }
      } catch (err) {
        console.log(`Could not sync ${event.title}: ${err.message}`);
      }
    }

    res.json({ 
      success: true, 
      message: `Gallery sync initiated`,
      note: 'Images will be available after sync completes'
    });

  } catch (error) {
    console.error('❌ Zoho sync error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

async function handleAdminKongSync(req, res) {
  try {
    console.log('🔄 Manual Kong Nightlife sync triggered...');
    const scraper = await loadKongScraper();
    
    if (!scraper) {
      return res.status(500).json({ error: 'Scraper not available' });
    }
    
    const events = await scraper.scrapeKongEvents();
    
    res.json({
      success: true,
      message: `Synced ${events.length} events from Kong Nightlife`,
      eventCount: events.length,
      events: events.slice(0, 5) // Preview first 5
    });
  } catch (error) {
    console.error('❌ Kong sync error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

app.post('/api/admin/sync-kong', handleAdminKongSync);
app.post('/api/admin/sync-posh', handleAdminKongSync);

// Refresh videos from YouTube
app.post('/api/admin/refresh-videos', async (req, res) => {
  try {
    console.log('🎬 Manual YouTube video refresh triggered...');
    const { default: nodeFetch } = await import('node-fetch');
    const API_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyBJhAOSP4h56n-l1V60zlE_uWtNrKvwhmY";
    const CHANNEL_ID = "UCi__qHBfHLlYg0fu86BUA8g";
    const PUBLISHED_AFTER = "2024-01-01T00:00:00Z";
    const MAX_PAGES = 20;

    let allVideos = [];
    let nextPageToken = null;
    let pageCount = 0;

    while (pageCount < MAX_PAGES) {
      let url = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${CHANNEL_ID}&part=snippet&type=video&order=date&maxResults=50&publishedAfter=${PUBLISHED_AFTER}`;
      if (nextPageToken) url += `&pageToken=${nextPageToken}`;

      const response = await nodeFetch(url);
      const data = await response.json();

      if (!data.items || data.items.length === 0) break;

      const videos = data.items.map(v => ({
        id: v.id.videoId,
        title: v.snippet.title,
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        publishedAt: v.snippet.publishedAt
      }));

      allVideos = allVideos.concat(videos);
      nextPageToken = data.nextPageToken;
      pageCount++;
      if (!nextPageToken) break;
      await new Promise(r => setTimeout(r, 100));
    }

    if (allVideos.length === 0) {
      return res.status(500).json({ error: 'No videos found from YouTube' });
    }

    const videosPath = path.join(__dirname, 'public', 'data', 'videos.json');
    fs.mkdirSync(path.dirname(videosPath), { recursive: true });
    fs.writeFileSync(videosPath, JSON.stringify(allVideos, null, 2));

    console.log(`✅ Refreshed ${allVideos.length} videos from YouTube`);
    res.json({ success: true, count: allVideos.length, message: `Refreshed ${allVideos.length} videos from YouTube` });
  } catch (error) {
    console.error('❌ Video refresh error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── MANUAL EVENTS CRUD ───────────────────────────────────────────
const MANUAL_EVENTS_PATH = path.join(__dirname, 'db/manual-events.json');

function readManualEvents() {
  if (!fs.existsSync(MANUAL_EVENTS_PATH)) return { events: [] };
  try { return JSON.parse(fs.readFileSync(MANUAL_EVENTS_PATH, 'utf-8')); } catch { return { events: [] }; }
}

function saveManualEvents(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(MANUAL_EVENTS_PATH, JSON.stringify(data, null, 2));
}

const EVENT_ASSISTANT_DRAFTS_PATH = path.join(__dirname, 'db/event-assistant-drafts.json');

function canUseEventAssistant(req) {
  const token = process.env.EVENT_ASSISTANT_TOKEN;
  const providedToken = req.headers['x-event-assistant-token'] || req.body?.token;
  return Boolean(req.session?.user?.isAdmin || (token && providedToken === token));
}

app.post('/api/event-assistant/preview', async (req, res) => {
  try {
    if (!canUseEventAssistant(req)) {
      return res.status(401).json({
        success: false,
        error: 'Admin confirmation required',
        question: 'Necesito que estés logueado como admin o que el chat use EVENT_ASSISTANT_TOKEN antes de agregar eventos.'
      });
    }

    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing event link',
        question: 'Mándame el link del evento que quieres agregar.'
      });
    }

    const preview = await extractEventFromLink(url);
    const draftId = `draft-${Date.now()}`;
    const draft = {
      id: draftId,
      status: 'pending-confirmation',
      createdAt: new Date().toISOString(),
      event: preview.event,
      questions: preview.questions
    };

    await saveEventDraft(EVENT_ASSISTANT_DRAFTS_PATH, draft);

    return res.json({
      success: true,
      draftId,
      status: preview.needsInfo ? 'needs-info' : 'needs-confirmation',
      event: preview.event,
      questions: preview.questions,
      confirmationText: preview.needsInfo
        ? `Encontré algo de información, pero me falta: ${preview.questions.join(' ')}`
        : `Encontré este evento: ${preview.event.title} el ${preview.event.date || 'día por definir'} en ${preview.event.location}. ¿Lo agrego a Events?`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      question: 'No pude sacar toda la info de ese link. Pásame título, fecha, imagen y link de ticket, o intenta con otro link público.'
    });
  }
});

app.post('/api/event-assistant/confirm', async (req, res) => {
  try {
    if (!canUseEventAssistant(req)) {
      return res.status(401).json({
        success: false,
        error: 'Admin confirmation required'
      });
    }

    const { draftId, confirm, updates = {} } = req.body || {};
    if (!draftId) return res.status(400).json({ success: false, error: 'draftId is required' });
    if (confirm !== true && String(confirm).toLowerCase() !== 'yes' && String(confirm).toLowerCase() !== 'si' && String(confirm).toLowerCase() !== 'sí') {
      return res.json({ success: true, status: 'cancelled', message: 'No agregué el evento.' });
    }

    const draft = await readEventDraft(EVENT_ASSISTANT_DRAFTS_PATH, draftId);
    if (!draft) return res.status(404).json({ success: false, error: 'Draft not found' });

    const event = { ...draft.event, ...updates };
    const missing = [];
    if (!event.title) missing.push('título');
    if (!event.date) missing.push('fecha');
    if (!event.ticketUrl) missing.push('link de ticket');
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Falta ${missing.join(', ')}`,
        questions: missing.map(field => `Cuál es el ${field} del evento?`)
      });
    }

    const result = await addManualEvent(MANUAL_EVENTS_PATH, event);
    await markDraftConfirmed(EVENT_ASSISTANT_DRAFTS_PATH, draftId);

    return res.json({
      success: true,
      status: result.duplicate ? 'already-exists' : 'added',
      message: result.duplicate ? 'Ese evento ya estaba agregado.' : 'Evento agregado a Events.',
      event: result.event,
      total: result.total
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/manual-events', (req, res) => {
  const data = readManualEvents();
  res.json({ success: true, events: data.events || [] });
});

app.post('/api/admin/manual-events', (req, res) => {
  try {
    const { title, date, venue, location, price, image, ticketUrl, description } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Title and date are required' });

    const data = readManualEvents();
    if (!data.events) data.events = [];

    const newEvent = {
      id: 'evt-' + Date.now(),
      title,
      date,
      venue: venue || 'Miami, FL',
      location: location || 'Miami, FL',
      price: price || '$25+',
      image: image || '',
      ticketUrl: ticketUrl || '',
      description: description || '',
      addedAt: new Date().toISOString()
    };

    data.events.push(newEvent);
    saveManualEvents(data);
    console.log(`➕ Manual event added: ${title} on ${date}`);
    res.json({ success: true, event: newEvent, total: data.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/manual-events/:id', (req, res) => {
  try {
    const data = readManualEvents();
    const before = (data.events || []).length;
    data.events = (data.events || []).filter(e => e.id !== req.params.id);
    if (data.events.length === before) return res.status(404).json({ error: 'Event not found' });
    saveManualEvents(data);
    res.json({ success: true, remaining: data.events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/posh-events/add', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.includes('posh.vip/e/')) {
      return res.status(400).json({ error: 'Invalid Posh.vip event URL' });
    }

    const manualEventsPath = path.join(__dirname, 'db/posh-manual-events.json');
    let manualEvents = { eventUrls: [] };

    if (fs.existsSync(manualEventsPath)) {
      manualEvents = JSON.parse(fs.readFileSync(manualEventsPath, 'utf-8'));
    }

    const isNew = !manualEvents.eventUrls.includes(url);
    if (isNew) {
      manualEvents.eventUrls.push(url);
      manualEvents.lastUpdated = new Date().toISOString();
      fs.writeFileSync(manualEventsPath, JSON.stringify(manualEvents, null, 2));
      console.log(`➕ Added Posh event: ${url}`);
    }

    res.json({
      success: true,
      message: isNew ? 'Event URL saved. Posh auto-sync is disabled.' : 'Event already exists. Posh auto-sync is disabled.',
      eventUrls: manualEvents.eventUrls
    });
  } catch (error) {
    console.error('❌ Error adding Posh event:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get list of manually added Posh event URLs
app.get('/api/admin/posh-events/urls', (req, res) => {
  try {
    const manualEventsPath = path.join(__dirname, 'db/posh-manual-events.json');
    
    if (fs.existsSync(manualEventsPath)) {
      const manualEvents = JSON.parse(fs.readFileSync(manualEventsPath, 'utf-8'));
      res.json({ success: true, ...manualEvents });
    } else {
      res.json({ success: true, eventUrls: [] });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-validate events daily (runs at startup and every 24h)
async function scheduleEventValidation() {
  console.log('⏰ Scheduling daily event validation (every 24 hours)...');
  
  // Initial validation on startup (delayed 30 seconds)
  setTimeout(async () => {
    try {
      console.log('🔍 Initial event validation starting...');
      const validator = await import('./scripts/events-validator.js');
      
      // Clean expired events first
      const cleanResult = await validator.cleanExpiredEvents();
      console.log(`🧹 Cleaned ${cleanResult.removed} expired events`);
      
      // Validate remaining events
      const validateResult = await validator.validateAllEvents();
      console.log(`✅ Validation complete: ${validateResult.valid} valid, ${validateResult.invalid} invalid`);
    } catch (err) {
      console.error('❌ Initial validation failed:', err.message);
    }
  }, 30000);
  
  // Schedule daily validation (every 24 hours)
  setInterval(async () => {
    try {
      console.log('🔄 Daily event validation starting...');
      const validator = await import('./scripts/events-validator.js');
      
      // Clean expired events
      const cleanResult = await validator.cleanExpiredEvents();
      console.log(`🧹 Cleaned ${cleanResult.removed} expired events`);
      
      // Validate events
      const validateResult = await validator.validateAllEvents();
      console.log(`✅ Daily validation: ${validateResult.valid} valid events`);
    } catch (err) {
      console.error('❌ Daily validation failed:', err.message);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours
}

// Start event validation scheduler
scheduleEventValidation();

// ============================================
// BIO LINKS API - Link tracking system with cache
// ============================================

// Cache for bio links (much faster loading)
let bioLinksCache = null;
let bioLinksCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute cache

async function getBioLinks() {
  const now = Date.now();
  if (bioLinksCache && (now - bioLinksCacheTime) < CACHE_TTL) {
    return bioLinksCache;
  }
  
  const pool = (await import('./database/connection.js')).default;
  const result = await pool.query(
    'SELECT id, title, subtitle, url, icon FROM bio_links WHERE is_active = true ORDER BY display_order ASC'
  );
  bioLinksCache = result.rows;
  bioLinksCacheTime = now;
  return bioLinksCache;
}

function invalidateBioLinksCache() {
  bioLinksCache = null;
  bioLinksCacheTime = 0;
}

// Get all active links for public display (cached)
app.get('/api/bio-links', async (req, res) => {
  try {
    const links = await getBioLinks();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(links);
  } catch (error) {
    console.error('Error fetching bio links:', error);
    res.status(500).json({ error: 'Error loading links' });
  }
});

// Track a click on a link - captures detailed analytics
app.post('/api/bio-links/:id/click', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      referrer, 
      screenWidth, 
      screenHeight, 
      timezone, 
      language 
    } = req.body;
    
    const pool = (await import('./database/connection.js')).default;
    
    // Parse user agent for browser/OS/device info
    const userAgent = req.headers['user-agent'] || '';
    const browserInfo = parseUserAgent(userAgent);
    
    // Get referrer domain
    let referrerDomain = null;
    if (referrer && referrer !== 'direct') {
      try {
        referrerDomain = new URL(referrer).hostname;
      } catch (e) {
        referrerDomain = referrer;
      }
    }
    
    // Get IP address
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.socket.remoteAddress || 
               'unknown';
    
    // Get current hour
    const now = new Date();
    const clickHour = now.getHours();
    
    // Try to get geo info from IP (using free service)
    let country = null, city = null, region = null;
    try {
      const geoResponse = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,regionName`);
      if (geoResponse.ok) {
        const geoData = await geoResponse.json();
        if (geoData.status !== 'fail') {
          country = geoData.country;
          city = geoData.city;
          region = geoData.regionName;
        }
      }
    } catch (geoError) {
      console.log('Geo lookup skipped:', geoError.message);
    }
    
    // Insert click record with all details
    await pool.query(`
      INSERT INTO link_clicks (
        link_id, click_hour, referrer, referrer_domain, user_agent,
        browser, browser_version, os, os_version, device_type,
        ip_address, country, city, region, language,
        screen_width, screen_height, timezone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `, [
      id, clickHour, referrer || 'direct', referrerDomain, userAgent,
      browserInfo.browser, browserInfo.browserVersion, browserInfo.os, browserInfo.osVersion, browserInfo.deviceType,
      ip, country, city, region, language,
      screenWidth, screenHeight, timezone
    ]);
    
    // Get the URL to redirect to
    const linkResult = await pool.query('SELECT url FROM bio_links WHERE id = $1', [id]);
    const url = linkResult.rows[0]?.url || '/';
    
    res.json({ success: true, url });
  } catch (error) {
    console.error('Error tracking click:', error);
    res.status(500).json({ error: 'Error tracking click' });
  }
});

// Helper function to parse user agent
function parseUserAgent(ua) {
  const result = {
    browser: 'Unknown',
    browserVersion: '',
    os: 'Unknown',
    osVersion: '',
    deviceType: 'desktop'
  };
  
  // Detect device type
  if (/mobile/i.test(ua)) result.deviceType = 'mobile';
  else if (/tablet|ipad/i.test(ua)) result.deviceType = 'tablet';
  
  // Detect browser
  if (/firefox/i.test(ua)) {
    result.browser = 'Firefox';
    const match = ua.match(/Firefox\/([\d.]+)/);
    if (match) result.browserVersion = match[1];
  } else if (/edg/i.test(ua)) {
    result.browser = 'Edge';
    const match = ua.match(/Edg\/([\d.]+)/);
    if (match) result.browserVersion = match[1];
  } else if (/chrome/i.test(ua)) {
    result.browser = 'Chrome';
    const match = ua.match(/Chrome\/([\d.]+)/);
    if (match) result.browserVersion = match[1];
  } else if (/safari/i.test(ua)) {
    result.browser = 'Safari';
    const match = ua.match(/Version\/([\d.]+)/);
    if (match) result.browserVersion = match[1];
  }
  
  // Detect OS
  if (/windows/i.test(ua)) {
    result.os = 'Windows';
    if (/windows nt 10/i.test(ua)) result.osVersion = '10';
    else if (/windows nt 11/i.test(ua)) result.osVersion = '11';
  } else if (/mac os/i.test(ua)) {
    result.os = 'macOS';
    const match = ua.match(/Mac OS X ([\d_]+)/);
    if (match) result.osVersion = match[1].replace(/_/g, '.');
  } else if (/android/i.test(ua)) {
    result.os = 'Android';
    const match = ua.match(/Android ([\d.]+)/);
    if (match) result.osVersion = match[1];
  } else if (/iphone|ipad/i.test(ua)) {
    result.os = 'iOS';
    const match = ua.match(/OS ([\d_]+)/);
    if (match) result.osVersion = match[1].replace(/_/g, '.');
  } else if (/linux/i.test(ua)) {
    result.os = 'Linux';
  }
  
  return result;
}

// Admin: Get link statistics
app.get('/api/admin/link-stats', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    
    // Get total clicks per element (bio_elements replaces bio_links)
    const linksWithClicks = await pool.query(`
      SELECT 
        be.id, be.title, be.subtitle, be.url, be.icon, be.element_type,
        COUNT(lc.id) as total_clicks,
        COUNT(CASE WHEN lc.click_date = CURRENT_DATE THEN 1 END) as clicks_today,
        COUNT(CASE WHEN lc.click_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as clicks_week,
        COUNT(CASE WHEN lc.click_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as clicks_month
      FROM bio_elements be
      LEFT JOIN link_clicks lc ON be.id = lc.link_id
      WHERE be.element_type IN ('link', 'promo', 'banner', 'social')
      GROUP BY be.id, be.title, be.subtitle, be.url, be.icon, be.element_type
      ORDER BY be.position ASC
    `);
    
    // Get total stats
    const totalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_clicks,
        COUNT(CASE WHEN click_date = CURRENT_DATE THEN 1 END) as clicks_today,
        COUNT(CASE WHEN click_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as clicks_week
      FROM link_clicks
    `);
    
    res.json({
      links: linksWithClicks.rows,
      totals: totalStats.rows[0]
    });
  } catch (error) {
    console.error('Error fetching link stats:', error);
    res.status(500).json({ error: 'Error loading stats' });
  }
});

// Admin: Get clicks by day for a specific link or all links
app.get('/api/admin/link-stats/by-day', async (req, res) => {
  try {
    const { link_id } = req.query;
    const pool = (await import('./database/connection.js')).default;
    const allowedDays = [7, 14, 30, 60, 90];
    let days = parseInt(req.query.days) || 30;
    if (!allowedDays.includes(days)) days = 30;
    
    const params = [days];
    let query = `
      SELECT 
        click_date,
        COUNT(*) as clicks,
        COUNT(DISTINCT ip_address) as unique_visitors
      FROM link_clicks
      WHERE click_date >= CURRENT_DATE - INTERVAL '1 day' * $1
    `;
    
    if (link_id) {
      params.push(parseInt(link_id));
      query += ` AND link_id = $2`;
    }
    
    query += ` GROUP BY click_date ORDER BY click_date DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    res.status(500).json({ error: 'Error loading daily stats' });
  }
});

// Admin: Get detailed click data with filters
app.get('/api/admin/link-stats/detailed', async (req, res) => {
  try {
    const { link_id, date, limit = 100 } = req.query;
    const pool = (await import('./database/connection.js')).default;
    
    let query = `
      SELECT 
        lc.*,
        be.title as link_title
      FROM link_clicks lc
      JOIN bio_elements be ON lc.link_id = be.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (link_id) {
      query += ` AND lc.link_id = $${paramIndex}`;
      params.push(parseInt(link_id));
      paramIndex++;
    }
    
    if (date) {
      query += ` AND lc.click_date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }
    
    query += ` ORDER BY lc.clicked_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching detailed stats:', error);
    res.status(500).json({ error: 'Error loading detailed stats' });
  }
});

// Admin: Get analytics breakdown (referrers, devices, countries, etc)
app.get('/api/admin/link-stats/analytics', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const pool = (await import('./database/connection.js')).default;
    const dateFilter = `click_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'`;
    
    // Top referrers
    const referrers = await pool.query(`
      SELECT referrer_domain, COUNT(*) as clicks
      FROM link_clicks WHERE ${dateFilter} AND referrer_domain IS NOT NULL
      GROUP BY referrer_domain ORDER BY clicks DESC LIMIT 10
    `);
    
    // Device types
    const devices = await pool.query(`
      SELECT device_type, COUNT(*) as clicks
      FROM link_clicks WHERE ${dateFilter}
      GROUP BY device_type ORDER BY clicks DESC
    `);
    
    // Browsers
    const browsers = await pool.query(`
      SELECT browser, COUNT(*) as clicks
      FROM link_clicks WHERE ${dateFilter}
      GROUP BY browser ORDER BY clicks DESC LIMIT 10
    `);
    
    // Countries
    const countries = await pool.query(`
      SELECT country, COUNT(*) as clicks
      FROM link_clicks WHERE ${dateFilter} AND country IS NOT NULL
      GROUP BY country ORDER BY clicks DESC LIMIT 10
    `);
    
    // Cities
    const cities = await pool.query(`
      SELECT city, region, country, COUNT(*) as clicks
      FROM link_clicks WHERE ${dateFilter} AND city IS NOT NULL
      GROUP BY city, region, country ORDER BY clicks DESC LIMIT 15
    `);
    
    // Clicks by hour
    const hourly = await pool.query(`
      SELECT click_hour, COUNT(*) as clicks
      FROM link_clicks WHERE ${dateFilter}
      GROUP BY click_hour ORDER BY click_hour
    `);
    
    res.json({
      referrers: referrers.rows,
      devices: devices.rows,
      browsers: browsers.rows,
      countries: countries.rows,
      cities: cities.rows,
      hourly: hourly.rows
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Error loading analytics' });
  }
});

// Admin: Add new link
app.post('/api/admin/bio-links', async (req, res) => {
  try {
    const { title, subtitle, url, icon, display_order } = req.body;
    const pool = (await import('./database/connection.js')).default;
    
    const result = await pool.query(
      `INSERT INTO bio_links (title, subtitle, url, icon, display_order) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, subtitle || null, url, icon || 'link', display_order || 0]
    );
    
    invalidateBioLinksCache();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding link:', error);
    res.status(500).json({ error: 'Error adding link' });
  }
});

// Admin: Update link
app.put('/api/admin/bio-links/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, url, icon, display_order, is_active } = req.body;
    const pool = (await import('./database/connection.js')).default;
    
    const result = await pool.query(
      `UPDATE bio_links SET 
        title = COALESCE($1, title),
        subtitle = $2,
        url = COALESCE($3, url),
        icon = COALESCE($4, icon),
        display_order = COALESCE($5, display_order),
        is_active = COALESCE($6, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [title, subtitle, url, icon, display_order, is_active, id]
    );
    
    invalidateBioLinksCache();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating link:', error);
    res.status(500).json({ error: 'Error updating link' });
  }
});

// Admin: Delete link
app.delete('/api/admin/bio-links/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = (await import('./database/connection.js')).default;
    
    await pool.query('DELETE FROM bio_links WHERE id = $1', [id]);
    invalidateBioLinksCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({ error: 'Error deleting link' });
  }
});

// ============================================
// BIO ELEMENTS API - Visual Builder System
// ============================================

let bioElementsCache = null;
let bioElementsCacheTime = 0;

async function getBioElements() {
  const now = Date.now();
  if (bioElementsCache && (now - bioElementsCacheTime) < CACHE_TTL) {
    return bioElementsCache;
  }
  const pool = (await import('./database/connection.js')).default;
  const result = await pool.query(
    'SELECT * FROM bio_elements WHERE is_active = true ORDER BY position ASC'
  );
  bioElementsCache = result.rows;
  bioElementsCacheTime = now;
  return bioElementsCache;
}

function invalidateBioElementsCache() {
  bioElementsCache = null;
  bioElementsCacheTime = 0;
}

// Get all active elements for public display
app.get('/api/bio-elements', async (req, res) => {
  try {
    const elements = await getBioElements();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(elements);
  } catch (error) {
    console.error('Error fetching bio elements:', error);
    res.status(500).json({ error: 'Error loading elements' });
  }
});

// Admin: Get all elements (including inactive)
app.get('/api/admin/bio-elements', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const result = await pool.query('SELECT * FROM bio_elements ORDER BY position ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all bio elements:', error);
    res.status(500).json({ error: 'Error loading elements' });
  }
});

// Admin: Create element
app.post('/api/admin/bio-elements', async (req, res) => {
  try {
    const { 
      element_type, title, subtitle, url, icon, metadata,
      promo_code, promo_text, discount_label, promo_start_date, promo_end_date, promo_bg_color,
      video_platform, video_id, video_thumbnail,
      position, is_active 
    } = req.body;
    
    const pool = (await import('./database/connection.js')).default;
    
    // Get max position if not provided
    let pos = position;
    if (pos === undefined || pos === null) {
      const maxPos = await pool.query('SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM bio_elements');
      pos = maxPos.rows[0].next_pos;
    }
    
    // Merge metadata fields with individual fields for backwards compatibility
    const meta = metadata || {};
    const finalPromoCode = promo_code || meta.promo_code;
    const finalDiscountLabel = discount_label || meta.discount_label;
    const finalPromoBgColor = promo_bg_color || meta.promo_bg_color || '#ff1744';
    const finalVideoPlatform = video_platform || meta.video_platform;
    const finalVideoId = video_id || meta.video_id;
    const finalVideoThumbnail = video_thumbnail || meta.video_thumbnail;
    
    const result = await pool.query(
      `INSERT INTO bio_elements (
        element_type, title, subtitle, url, icon,
        promo_code, promo_text, discount_label, promo_start_date, promo_end_date, promo_bg_color,
        video_platform, video_id, video_thumbnail,
        position, is_active, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        element_type || 'link', title, subtitle, url, icon || 'link',
        finalPromoCode, promo_text, finalDiscountLabel, promo_start_date, promo_end_date, finalPromoBgColor,
        finalVideoPlatform, finalVideoId, finalVideoThumbnail,
        pos, is_active !== false, JSON.stringify(meta)
      ]
    );
    
    invalidateBioElementsCache();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating bio element:', error);
    res.status(500).json({ error: 'Error creating element' });
  }
});

// Admin: Update element
app.put('/api/admin/bio-elements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      element_type, title, subtitle, url, icon, metadata,
      promo_code, promo_text, discount_label, promo_start_date, promo_end_date, promo_bg_color,
      video_platform, video_id, video_thumbnail,
      position, is_active 
    } = req.body;
    
    const pool = (await import('./database/connection.js')).default;
    
    // Merge metadata fields with individual fields for backwards compatibility
    const meta = metadata || {};
    const finalPromoCode = promo_code || meta.promo_code;
    const finalDiscountLabel = discount_label || meta.discount_label;
    const finalPromoBgColor = promo_bg_color || meta.promo_bg_color;
    const finalVideoPlatform = video_platform || meta.video_platform;
    const finalVideoId = video_id || meta.video_id;
    const finalVideoThumbnail = video_thumbnail || meta.video_thumbnail;
    
    const result = await pool.query(
      `UPDATE bio_elements SET 
        element_type = COALESCE($1, element_type),
        title = COALESCE($2, title),
        subtitle = $3,
        url = $4,
        icon = COALESCE($5, icon),
        promo_code = $6,
        promo_text = $7,
        discount_label = $8,
        promo_start_date = $9,
        promo_end_date = $10,
        promo_bg_color = COALESCE($11, promo_bg_color),
        video_platform = $12,
        video_id = $13,
        video_thumbnail = $14,
        position = COALESCE($15, position),
        is_active = COALESCE($16, is_active),
        metadata = $17,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $18 RETURNING *`,
      [
        element_type, title, subtitle, url, icon,
        finalPromoCode, promo_text, finalDiscountLabel, promo_start_date, promo_end_date, finalPromoBgColor,
        finalVideoPlatform, finalVideoId, finalVideoThumbnail,
        position, is_active, JSON.stringify(meta), id
      ]
    );
    
    invalidateBioElementsCache();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating bio element:', error);
    res.status(500).json({ error: 'Error updating element' });
  }
});

// Admin: Delete element
app.delete('/api/admin/bio-elements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = (await import('./database/connection.js')).default;
    
    await pool.query('DELETE FROM bio_elements WHERE id = $1', [id]);
    invalidateBioElementsCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting bio element:', error);
    res.status(500).json({ error: 'Error deleting element' });
  }
});

// Admin: Reorder elements (bulk update positions)
app.post('/api/admin/bio-elements/reorder', async (req, res) => {
  try {
    const { order } = req.body; // Array of { id, position }
    const pool = (await import('./database/connection.js')).default;
    
    for (const item of order) {
      await pool.query(
        'UPDATE bio_elements SET position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [item.position, item.id]
      );
    }
    
    invalidateBioElementsCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering bio elements:', error);
    res.status(500).json({ error: 'Error reordering elements' });
  }
});

// Track click on bio element
app.post('/api/bio-elements/:id/click', async (req, res) => {
  try {
    const { id } = req.params;
    const { referrer, screenWidth, screenHeight, timezone, language } = req.body;
    
    const pool = (await import('./database/connection.js')).default;
    
    const userAgent = req.headers['user-agent'] || '';
    const browserInfo = parseUserAgent(userAgent);
    
    let referrerDomain = null;
    if (referrer && referrer !== 'direct') {
      try { referrerDomain = new URL(referrer).hostname; } catch (e) { referrerDomain = referrer; }
    }
    
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
    const now = new Date();
    const clickHour = now.getHours();
    
    let country = null, city = null, region = null;
    try {
      const geoResponse = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,regionName`);
      if (geoResponse.ok) {
        const geoData = await geoResponse.json();
        if (geoData.status !== 'fail') {
          country = geoData.country;
          city = geoData.city;
          region = geoData.regionName;
        }
      }
    } catch (geoError) {}
    
    // Get element info
    const elementResult = await pool.query('SELECT element_type, url FROM bio_elements WHERE id = $1', [id]);
    const element = elementResult.rows[0];
    
    if (element) {
      // Insert into link_clicks table (reusing existing table)
      await pool.query(`
        INSERT INTO link_clicks (
          link_id, click_hour, referrer, referrer_domain, user_agent,
          browser, browser_version, os, os_version, device_type,
          ip_address, country, city, region, language,
          screen_width, screen_height, timezone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        id, clickHour, referrer || 'direct', referrerDomain, userAgent,
        browserInfo.browser, browserInfo.browserVersion, browserInfo.os, browserInfo.osVersion, browserInfo.deviceType,
        ip, country, city, region, language,
        screenWidth, screenHeight, timezone
      ]);
    }
    
    res.json({ success: true, url: element?.url || '/' });
  } catch (error) {
    console.error('Error tracking element click:', error);
    res.status(500).json({ error: 'Error tracking click' });
  }
});

// ============================================
// REDIRECT-BASED CLICK TRACKING (works with Instagram in-app browser)
// ============================================

app.get('/go/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = (await import('./database/connection.js')).default;
    
    // Get element URL
    const elementResult = await pool.query('SELECT element_type, url FROM bio_elements WHERE id = $1', [id]);
    const element = elementResult.rows[0];
    
    if (!element || !element.url) {
      return res.redirect('/links.html');
    }
    
    // Track the click (async, don't wait)
    const userAgent = req.headers['user-agent'] || '';
    const browserInfo = parseUserAgent(userAgent);
    const referrer = req.headers['referer'] || 'instagram';
    let referrerDomain = null;
    if (referrer && referrer !== 'direct') {
      try { referrerDomain = new URL(referrer).hostname; } catch (e) { referrerDomain = 'instagram'; }
    }
    
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
    const now = new Date();
    const clickHour = now.getHours();
    
    // Insert click record (don't await to speed up redirect)
    pool.query(`
      INSERT INTO link_clicks (
        link_id, click_hour, referrer, referrer_domain, user_agent,
        browser, browser_version, os, os_version, device_type,
        ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      id, clickHour, referrer, referrerDomain || 'instagram', userAgent,
      browserInfo.browser, browserInfo.browserVersion, browserInfo.os, browserInfo.osVersion, browserInfo.deviceType,
      ip
    ]).catch(err => console.error('Click tracking error:', err));
    
    console.log(`📊 Click tracked via redirect: element ${id} -> ${element.url}`);
    
    // Redirect to destination
    res.redirect(element.url);
  } catch (error) {
    console.error('Error in redirect tracking:', error);
    res.redirect('/links.html');
  }
});

// ============================================
// VALENTINE'S RAVE REGISTRATION
// ============================================

app.post('/api/valentine-registration', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { name, age, gender, instagram, attending, openToActivities, hopingFor, comfortableFilming } = req.body;
    
    if (!name || !age || !gender || !instagram || !attending || !openToActivities || !hopingFor || !comfortableFilming) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (age < 18) {
      return res.status(400).json({ error: 'You must be 18 or older' });
    }
    
    await pool.query(`
      INSERT INTO valentine_submissions (name, age, gender, instagram, attending_rave, open_to_activities, hoping_for, comfortable_filming)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [name, age, gender, instagram, attending, openToActivities, hopingFor, comfortableFilming]);
    
    console.log(`💕 Valentine registration: ${name} (@${instagram})`);
    
    // Send email notification
    const hopingForLabels = {
      'meet-people': 'Meet new people',
      'flirt-fun': 'Flirt & have fun',
      'real-connection': 'A real connection',
      'just-experience': 'Just the experience'
    };
    
    const filmingLabels = {
      'yes': 'Yes',
      'no': 'No',
      'off-camera': 'Only off-camera'
    };
    
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; padding: 0; background: #0a0a0a; font-family: 'Segoe UI', Arial, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; background: #111; }
          .header { background: linear-gradient(135deg, #8b0000 0%, #c41e3a 100%); padding: 30px; text-align: center; }
          .header h1 { color: #fff; margin: 0; font-size: 24px; letter-spacing: 3px; }
          .header p { color: rgba(255,255,255,0.8); margin: 10px 0 0; font-size: 12px; letter-spacing: 2px; }
          .content { padding: 30px; }
          .field { margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 15px; }
          .field:last-child { border-bottom: none; }
          .label { color: #c41e3a; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
          .value { color: #fff; font-size: 16px; }
          .footer { background: #0a0a0a; padding: 20px; text-align: center; }
          .footer p { color: #555; font-size: 11px; margin: 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>VALENTINE'S RAVE</h1>
            <p>NEW REGISTRATION</p>
          </div>
          <div class="content">
            <div class="field">
              <div class="label">Name</div>
              <div class="value">${name}</div>
            </div>
            <div class="field">
              <div class="label">Age</div>
              <div class="value">${age}</div>
            </div>
            <div class="field">
              <div class="label">Gender</div>
              <div class="value">${gender}</div>
            </div>
            <div class="field">
              <div class="label">Instagram</div>
              <div class="value">${instagram}</div>
            </div>
            <div class="field">
              <div class="label">Attending the Rave?</div>
              <div class="value">${attending === 'yes' ? 'Yes' : 'Not yet, but planning to'}</div>
            </div>
            <div class="field">
              <div class="label">Open to Valentine's Activities?</div>
              <div class="value">${openToActivities === 'yes' ? 'Yes' : openToActivities === 'maybe' ? 'Maybe' : 'No'}</div>
            </div>
            <div class="field">
              <div class="label">Hoping to Get</div>
              <div class="value">${hopingForLabels[hopingFor] || hopingFor}</div>
            </div>
            <div class="field">
              <div class="label">Comfortable Being Filmed?</div>
              <div class="value">${filmingLabels[comfortableFilming] || comfortableFilming}</div>
            </div>
          </div>
          <div class="footer">
            <p>BLACK ROOM MIAMI</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    try {
      await emailTransporter.sendMail({
        from: '"Black Room" <theblackroom.us@gmail.com>',
        to: 'theblackroom.us@gmail.com',
        subject: `💕 Valentine Registration: ${name} (@${instagram})`,
        html: emailHtml
      });
      console.log(`📧 Valentine email sent for: ${name}`);
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving valentine registration:', error);
    res.status(500).json({ error: 'Failed to submit registration' });
  }
});

// ============================================
// OPEN DECK SIGN-UPS
// ============================================

app.post('/api/open-deck', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { fullName, age, email, phone, instagram, soundcloud, genre, playedBefore, attendedEvent, whichEvent } = req.body || {};

    if (!fullName || !age || !email || !phone || !genre || !playedBefore || !attendedEvent) {
      return res.status(400).json({ error: 'Please fill in all required fields' });
    }
    if (parseInt(age) < 18) {
      return res.status(400).json({ error: 'You must be 18 or older' });
    }

    await pool.query(`
      INSERT INTO open_deck_submissions
        (full_name, age, email, phone, instagram, soundcloud, genre, played_before, attended_event, which_event)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      fullName, parseInt(age), email, phone,
      instagram || null, soundcloud || null,
      genre,
      playedBefore, attendedEvent,
      (attendedEvent === 'yes' ? (whichEvent || null) : null)
    ]);

    console.log(`🎧 Open Deck sign-up: ${fullName} (${email})`);

    try {
      const emailHtml = `
        <!DOCTYPE html><html><head><style>
          body { margin:0; padding:0; background:#0a0a0a; font-family:'Segoe UI',Arial,sans-serif; }
          .container { max-width:600px; margin:0 auto; background:#111; }
          .header { background:#000; border-bottom:1px solid #222; padding:30px; text-align:center; }
          .header h1 { color:#fff; margin:0; font-size:22px; letter-spacing:3px; }
          .header p { color:#888; margin:10px 0 0; font-size:11px; letter-spacing:2px; }
          .content { padding:30px; }
          .field { margin-bottom:18px; border-bottom:1px solid #222; padding-bottom:14px; }
          .field:last-child { border-bottom:none; }
          .label { color:#888; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px; }
          .value { color:#fff; font-size:15px; }
          .footer { background:#0a0a0a; padding:20px; text-align:center; }
          .footer p { color:#555; font-size:11px; margin:0; }
        </style></head><body>
          <div class="container">
            <div class="header">
              <h1>OPEN DECK SIGN-UP</h1>
              <p>BLACK ROOM</p>
            </div>
            <div class="content">
              <div class="field"><div class="label">Full Name</div><div class="value">${fullName}</div></div>
              <div class="field"><div class="label">Age</div><div class="value">${age}</div></div>
              <div class="field"><div class="label">Email</div><div class="value">${email}</div></div>
              <div class="field"><div class="label">Phone</div><div class="value">${phone}</div></div>
              ${instagram ? `<div class="field"><div class="label">Instagram</div><div class="value">${instagram}</div></div>` : ''}
              ${soundcloud ? `<div class="field"><div class="label">SoundCloud</div><div class="value">${soundcloud}</div></div>` : ''}
              <div class="field"><div class="label">Genre</div><div class="value">${genre}</div></div>
              <div class="field"><div class="label">Played Before?</div><div class="value">${playedBefore === 'yes' ? 'Yes' : 'No'}</div></div>
              <div class="field"><div class="label">Attended Black Room Event?</div><div class="value">${attendedEvent === 'yes' ? 'Yes' : 'No'}</div></div>
              ${attendedEvent === 'yes' && whichEvent ? `<div class="field"><div class="label">Which Event</div><div class="value">${whichEvent}</div></div>` : ''}
            </div>
            <div class="footer"><p>BLACK ROOM MIAMI</p></div>
          </div>
        </body></html>
      `;
      await emailTransporter.sendMail({
        from: '"Black Room" <theblackroom.us@gmail.com>',
        to: 'theblackroom.us@gmail.com',
        subject: `🎧 Open Deck sign-up: ${fullName} (${email})`,
        html: emailHtml
      });
    } catch (emailErr) {
      console.error('Open Deck email error:', emailErr);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving open deck submission:', error);
    res.status(500).json({ error: 'Failed to submit sign-up' });
  }
});

// ============================================
// TEAM APPLICATIONS (Promoters / Ambassadors)
// ============================================

app.post('/api/team-application', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const {
      role, fullName, instagram, experience, experienceWhere,
      availability, canRepresent, canAttendShoots, phone, email
    } = req.body || {};

    if (!role || !['promoter', 'ambassador'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (!fullName || !instagram) {
      return res.status(400).json({ error: 'Full name and Instagram are required' });
    }
    if (role === 'promoter' && (!phone || !email || !experience)) {
      return res.status(400).json({ error: 'Phone, email and experience are required for promoters' });
    }
    if (role === 'ambassador' && (!phone || !email || !canRepresent || !canAttendShoots)) {
      return res.status(400).json({ error: 'Please answer all ambassador questions' });
    }

    await pool.query(`
      INSERT INTO team_applications
        (role, full_name, instagram, experience, experience_where,
         availability, can_represent, can_attend_shoots, phone, email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      role, fullName, instagram,
      experience || null,
      (experience === 'yes' ? (experienceWhere || null) : null),
      availability || null,
      canRepresent || null,
      canAttendShoots || null,
      phone || null,
      email || null
    ]);

    console.log(`📨 Team application (${role}): ${fullName} (${instagram})`);

    // Email notification
    try {
      const rowsHtml = role === 'promoter' ? `
        <div class="field"><div class="label">Full Name</div><div class="value">${fullName}</div></div>
        <div class="field"><div class="label">Instagram</div><div class="value">${instagram}</div></div>
        <div class="field"><div class="label">Phone</div><div class="value">${phone || '-'}</div></div>
        <div class="field"><div class="label">Email</div><div class="value">${email || '-'}</div></div>
        <div class="field"><div class="label">Promoter Experience</div><div class="value">${experience === 'yes' ? 'Yes' : 'No'}</div></div>
        ${experience === 'yes' && experienceWhere ? `<div class="field"><div class="label">Where</div><div class="value">${experienceWhere}</div></div>` : ''}
      ` : `
        <div class="field"><div class="label">Full Name</div><div class="value">${fullName}</div></div>
        <div class="field"><div class="label">Instagram</div><div class="value">${instagram}</div></div>
        <div class="field"><div class="label">Phone</div><div class="value">${phone || '-'}</div></div>
        <div class="field"><div class="label">Email</div><div class="value">${email || '-'}</div></div>
        <div class="field"><div class="label">Availability</div><div class="value">${availability}</div></div>
        <div class="field"><div class="label">Represent on social media?</div><div class="value">${canRepresent === 'yes' ? 'Yes' : 'No'}</div></div>
        <div class="field"><div class="label">Attend shoots ≥1/month?</div><div class="value">${canAttendShoots === 'yes' ? 'Yes' : 'No'}</div></div>
      `;

      const emailHtml = `
        <!DOCTYPE html><html><head><style>
          body { margin:0; padding:0; background:#0a0a0a; font-family:'Segoe UI',Arial,sans-serif; }
          .container { max-width:600px; margin:0 auto; background:#111; }
          .header { background:#000; border-bottom:1px solid #222; padding:30px; text-align:center; }
          .header h1 { color:#fff; margin:0; font-size:22px; letter-spacing:3px; }
          .header p { color:#888; margin:10px 0 0; font-size:11px; letter-spacing:2px; }
          .content { padding:30px; }
          .field { margin-bottom:18px; border-bottom:1px solid #222; padding-bottom:14px; }
          .field:last-child { border-bottom:none; }
          .label { color:#888; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px; }
          .value { color:#fff; font-size:15px; }
          .footer { background:#0a0a0a; padding:20px; text-align:center; }
          .footer p { color:#555; font-size:11px; margin:0; }
        </style></head><body>
          <div class="container">
            <div class="header">
              <h1>${role.toUpperCase()} APPLICATION</h1>
              <p>BLACK ROOM MIAMI</p>
            </div>
            <div class="content">${rowsHtml}</div>
            <div class="footer"><p>BLACK ROOM MIAMI</p></div>
          </div>
        </body></html>
      `;

      if (typeof emailTransporter !== 'undefined' && emailTransporter) {
        await emailTransporter.sendMail({
          from: '"Black Room" <theblackroom.us@gmail.com>',
          to: 'theblackroom.us@gmail.com',
          subject: `📨 ${role === 'promoter' ? 'Promoter' : 'Ambassador'} application: ${fullName} (${instagram})`,
          html: emailHtml
        });
      }
    } catch (emailError) {
      console.error('Team application email error:', emailError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving team application:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// ============================================
// ADMIN — APPLICATIONS SHEET
// ============================================

app.get('/api/admin/academy-registrations', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const result = await pool.query('SELECT id, name, email, phone, course, contacted, created_at AS "createdAt" FROM academy_registrations ORDER BY created_at DESC');
    // keep _idx alias for frontend compatibility (uses id as the unique key)
    res.json(result.rows.map(r => ({ ...r, _idx: r.id })));
  } catch (err) {
    console.error('Error reading academy registrations:', err);
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

app.put('/api/admin/academy-registrations/:idx/contacted', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query('UPDATE academy_registrations SET contacted=$1 WHERE id=$2', [!!req.body.contacted, parseInt(req.params.idx)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error toggling academy contacted:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

app.put('/api/admin/open-deck-submissions/:id/contacted', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query('UPDATE open_deck_submissions SET contacted=$1 WHERE id=$2', [!!req.body.contacted, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/admin/team-applications/:id/contacted', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query('UPDATE team_applications SET contacted=$1 WHERE id=$2', [!!req.body.contacted, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/admin/academy-registrations/:idx', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query('DELETE FROM academy_registrations WHERE id=$1', [parseInt(req.params.idx)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting academy registration:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get('/api/admin/open-deck-submissions', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const result = await pool.query(
      'SELECT * FROM open_deck_submissions ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching open deck submissions:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

app.put('/api/admin/open-deck-submissions/:id', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { id } = req.params;
    const { full_name, age, email, phone, instagram, soundcloud, genre, played_before, attended_event, which_event } = req.body;
    await pool.query(
      `UPDATE open_deck_submissions SET full_name=$1, age=$2, email=$3, phone=$4,
       instagram=$5, soundcloud=$6, genre=$7, played_before=$8, attended_event=$9, which_event=$10
       WHERE id=$11`,
      [full_name, age, email, phone, instagram, soundcloud, genre, played_before, attended_event, which_event, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating open deck submission:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.delete('/api/admin/open-deck-submissions/:id', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query('DELETE FROM open_deck_submissions WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting open deck submission:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get('/api/admin/team-applications', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const result = await pool.query(
      'SELECT * FROM team_applications ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching team applications:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

app.put('/api/admin/team-applications/:id', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { id } = req.params;
    const { role, full_name, instagram, phone, email, experience, experience_where, can_represent, can_attend_shoots } = req.body;
    await pool.query(
      `UPDATE team_applications SET role=$1, full_name=$2, instagram=$3, phone=$4,
       email=$5, experience=$6, experience_where=$7, can_represent=$8, can_attend_shoots=$9
       WHERE id=$10`,
      [role, full_name, instagram, phone, email, experience, experience_where, can_represent, can_attend_shoots, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating team application:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.delete('/api/admin/team-applications/:id', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    await pool.query('DELETE FROM team_applications WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting team application:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ============================================
// VENDOR APPLICATION ENDPOINTS
// ============================================

app.post('/api/vendor-applications', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { businessName, phone, website, instagram, businessDescription, hasOwnTable, needsPower } = req.body;
    
    if (!businessName || !phone || !instagram || !businessDescription || !hasOwnTable || !needsPower) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    
    await pool.query(`
      INSERT INTO vendor_applications (business_name, phone, website, instagram, business_description, has_own_table, needs_power)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [businessName, phone, website, instagram, businessDescription, hasOwnTable, needsPower]);
    
    console.log(`📝 New vendor application: ${businessName}`);
    
    // Send email notification
    try {
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background: #000; color: #fff; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 30px; }
            h1 { color: #fff; font-size: 24px; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 15px; }
            .field { margin-bottom: 15px; }
            .label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
            .value { color: #fff; font-size: 16px; }
            .highlight { background: #222; padding: 10px; border-left: 3px solid #fff; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🏪 NEW VENDOR APPLICATION</h1>
            
            <div class="field">
              <div class="label">Business Name</div>
              <div class="value">${businessName}</div>
            </div>
            
            <div class="field">
              <div class="label">Phone</div>
              <div class="value">${phone}</div>
            </div>
            
            <div class="field">
              <div class="label">Website</div>
              <div class="value">${website || 'Not provided'}</div>
            </div>
            
            <div class="field">
              <div class="label">Instagram</div>
              <div class="value">${instagram}</div>
            </div>
            
            <div class="highlight">
              <div class="label">What they sell/showcase</div>
              <div class="value">${businessDescription}</div>
            </div>
            
            <div class="field">
              <div class="label">Has Own Table/Setup</div>
              <div class="value">${hasOwnTable === 'yes' ? '✅ Yes' : '❌ No - needs one provided'}</div>
            </div>
            
            <div class="field">
              <div class="label">Needs Power</div>
              <div class="value">${needsPower === 'yes' ? '⚡ Yes' : '❌ No'}</div>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #333; padding-top: 15px;">
              Application received at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST
            </p>
          </div>
        </body>
        </html>
      `;
      
      await emailTransporter.sendMail({
        from: '"BLACK ROOM Vendors" <theblackroom.us@gmail.com>',
        to: process.env.EMAIL_USER || 'theblackroom.us@gmail.com',
        subject: `🏪 New Vendor Application: ${businessName}`,
        html: emailHtml
      });
      
      console.log(`📧 Vendor application email sent for: ${businessName}`);
    } catch (emailError) {
      console.error('Error sending vendor email:', emailError);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving vendor application:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

app.get('/api/admin/vendor-applications', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const result = await pool.query(`
      SELECT * FROM vendor_applications ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vendor applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

app.put('/api/admin/vendor-applications/:id', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { id } = req.params;
    const { status, notes } = req.body;
    
    await pool.query(`
      UPDATE vendor_applications 
      SET status = $1, notes = $2, reviewed_at = NOW()
      WHERE id = $3
    `, [status, notes, id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating vendor application:', error);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// ============================================
// WEBSITE ANALYTICS TRACKING ENDPOINTS
// ============================================

// Track page view
app.post('/api/analytics/pageview', async (req, res) => {
  try {
    const pool = (await import('./database/connection.js')).default;
    const { page_url, page_title, session_id, referrer, screen_width, screen_height, language, timezone } = req.body;
    
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    
    let device_type = 'desktop';
    if (/mobile/i.test(ua)) device_type = 'mobile';
    else if (/tablet|ipad/i.test(ua)) device_type = 'tablet';
    
    let browser = 'Unknown';
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Edge')) browser = 'Edge';
    
    let os = 'Unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('Linux')) os = 'Linux';
    
    let referrer_domain = null;
    if (referrer && referrer !== 'direct') {
      try { referrer_domain = new URL(referrer).hostname; } catch(e) {}
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
  console.error('❌ Express Error:', err.stack || err);
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
    console.log('✅ Schema ensured (order_email_log, academy payment columns)');
  } catch (err) {
    console.error('⚠️ ensureSchema failed:', err.message);
  }
}
ensureSchema();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Black Room Server started on port: ${PORT}`);
  console.log(`📱 Local access: http://localhost:${PORT}`);
  console.log(`🌐 External access: Available on 0.0.0.0:${PORT}`);
  console.log(`🌍 Custom domain: blackroomus.com configured`);
  console.log(`✅ Server ready for external connections`);
  console.log(`⚡ Server listening successfully at ${new Date().toISOString()}`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
  }
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
