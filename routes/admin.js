import express from "express";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import multer from "multer";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { fileURLToPath } from 'url';
import EventImageManager from '../utils/eventImageManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const usersFile = path.join(__dirname, "../db/users.json");

// Configure multer for image uploads with comprehensive file support
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/images/events');
    if (!fsSync.existsSync(uploadDir)) {
      fsSync.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log(`📁 Archivo recibido: ${file.originalname}`);
    console.log(`🎨 Tipo MIME: ${file.mimetype}`);

    // Ser extremadamente permisivo - aceptar cualquier archivo que pueda ser imagen
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype ? file.mimetype.toLowerCase() : '';

    // Lista amplia de extensiones de imagen
    const imageExtensions = [
      '.jpg', '.jpeg', '.jpe', '.jfif', '.jfi', '.png', '.gif',
      '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif',
      '.heic', '.heif', '.ico', '.pjpeg', '.pjp'
    ];

    const hasImageExtension = imageExtensions.includes(fileExtension);
    const hasImageMime = mimeType.startsWith('image/');
    const hasImageInName = file.originalname.toLowerCase().includes('image') ||
                          file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|svg|avif|heic|heif|ico)$/i);

    // Aceptar si cualquiera de estas condiciones es verdadera
    if (hasImageExtension || hasImageMime || hasImageInName || !mimeType) {
      console.log(`✅ Archivo aceptado: ${file.originalname}`);
      cb(null, true);
    } else {
      console.log(`❌ Archivo rechazado: ${file.originalname}`);
      cb(new Error(`Solo se permiten archivos de imagen`), false);
    }
  }
});

// Admin authentication middleware
function requireAdmin(req, res, next) {
  console.log('🔐 Checking admin authentication...');
  console.log('👤 Session user:', req.session?.user);
  console.log('🔑 Is admin:', req.session?.user?.isAdmin);

  if (!req.session || !req.session.user) {
    console.log('❌ No session or user found');
    return res.status(401).json({ 
      error: 'Authentication required',
      isAuthenticated: false,
      isAdmin: false 
    });
  }

  // Special check for robert.manzanillag@gmail.com - always grant admin access
  if (req.session.user.email === 'robert.manzanillag@gmail.com') {
    console.log('✅ Special admin access granted for robert.manzanillag@gmail.com');
    req.session.user.isAdmin = true;
    req.session.user.role = 'admin';
    next();
    return;
  }

  if (!req.session.user.isAdmin) {
    console.log('❌ User is not admin');
    return res.status(403).json({ 
      error: 'Admin access required',
      isAuthenticated: true,
      isAdmin: false 
    });
  }

  console.log('✅ Admin authentication successful');
  next();
}

// GET - Check if the current user is admin
router.get("/check", (req, res) => {
  console.log('🔍 Admin check requested');
  console.log('👤 Session:', req.session?.user);

  if (!req.session || !req.session.user) {
    return res.json({ 
      isAdmin: false, 
      isAuthenticated: false,
      user: null 
    });
  }

  // Special handling for robert.manzanillag@gmail.com
  let isAdmin = req.session.user.isAdmin === true;
  if (req.session.user.email === 'robert.manzanillag@gmail.com') {
    isAdmin = true;
    req.session.user.isAdmin = true;
    req.session.user.role = 'admin';
    console.log('✅ Special admin privileges granted for robert.manzanillag@gmail.com');
  }

  console.log('✅ Admin check result:', { isAdmin, user: req.session.user.email });

  res.json({ 
    isAdmin: isAdmin, 
    isAuthenticated: true,
    user: req.session.user 
  });
});

// GET - Get all users (admins only)
router.get("/users", requireAdmin, (req, res) => {
  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];

    // Remove passwords before sending
    const usersWithoutPasswords = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json(usersWithoutPasswords);
  } catch (error) {
    console.error("Error reading users:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// PUT - Change user role (admins only)
router.put("/users/:email/role", requireAdmin, (req, res) => {
  const { email } = req.params;
  const { role } = req.body;

  if (!role || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ message: 'Rol inválido. Debe ser "admin" o "user"' });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const userIndex = users.findIndex(u => u.email === email);

    if (userIndex === -1) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    users[userIndex].role = role;
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    res.json({ message: `Rol actualizado a ${role} para ${email}` });
  } catch (error) {
    console.error("Error updating user role:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

async function handleScrapeKong(req, res) {
  try {
    console.log('🔍 Admin triggered Kong Nightlife sync...');
    const { scrapeKongEvents } = await import('../scripts/kong-scraper.js');
    const events = await scrapeKongEvents();
    console.log(`✅ Admin sync done — ${events.length} Kong events saved`);
    res.json({ success: true, eventCount: events.length });
  } catch (error) {
    console.error('❌ Kong sync error:', error);
    res.status(500).json({ error: error.message });
  }
}

router.post('/scrape-kong', handleScrapeKong);
router.post('/scrape-posh', handleScrapeKong);

// Upload image endpoint
router.post('/upload-image', requireAdmin, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }

    const imageUrl = `/images/events/${req.file.filename}`;
    console.log('✅ Image uploaded successfully:', imageUrl);

    res.json( {
      success: true,
      imageUrl: imageUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('❌ Error uploading image:', error);
    res.status(500).json({ error: 'Error subiendo la imagen: ' + error.message });
  }
});

// Upload custom image for event (with automatic cleanup)
router.post('/upload-event-image', requireAdmin, upload.single('eventImage'), async (req, res) => {
  console.log('🔄 Recibiendo archivo de evento...');
  console.log('📁 Archivo recibido:', req.file ? 'Sí' : 'No');
  console.log('📋 Body:', req.body);

  try {
    if (!req.file) {
      console.log('❌ No se recibió archivo');
      return res.status(400).json({
        success: false,
        error: 'No se recibió ningún archivo'
      });
    }

    const { eventTitle = 'evento', eventDate } = req.body;

    console.log(`📝 Procesando archivo: ${req.file.originalname}`);
    console.log(`📏 Tamaño: ${req.file.size} bytes`);

    // Create safe filename
    const timestamp = Date.now();
    const safeTitle = eventTitle.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30) || 'evento';

    let extension = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const newFilename = `${safeTitle}-${timestamp}${extension}`;

    // Ensure events directory exists
    const eventsDir = path.join(__dirname, '../public/images/events');
    if (!fsSync.existsSync(eventsDir)) {
      fsSync.mkdirSync(eventsDir, { recursive: true });
    }

    const finalPath = path.join(eventsDir, newFilename);

    // Save the file
    if (req.file.path && fsSync.existsSync(req.file.path)) {
      // File was saved to disk by multer
      fsSync.renameSync(req.file.path, finalPath);
    } else if (req.file.buffer) {
      // File is in memory
      fsSync.writeFileSync(finalPath, req.file.buffer);
    } else {
      throw new Error('No se pudo acceder al archivo');
    }

    // Save metadata for cleanup
    try {
      const imageManager = new EventImageManager();
      await imageManager.saveImageMetadata(newFilename, eventTitle, eventDate);
    } catch (metadataError) {
      console.log('⚠️ Error guardando metadatos:', metadataError.message);
    }

    const imageUrl = `/images/events/${newFilename}`;
    console.log(`✅ Imagen guardada: ${imageUrl}`);

    res.json({
      success: true,
      imageUrl: imageUrl,
      filename: newFilename,
      message: 'Imagen subida exitosamente'
    });

  } catch (error) {
    console.error('❌ Error subiendo archivo:', error);

    // Clean up temporary file
    if (req.file?.path && fsSync.existsSync(req.file.path)) {
      try {
        fsSync.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.log('⚠️ Error limpiando temporal:', cleanupError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Error subiendo imagen: ' + error.message
    });
  }
});

// Route to extract complete event information
router.post("/extract-complete-event", async (req, res) => {
  try {
    console.log('📥 Request received:', req.body);

    const { url } = req.body;

    if (!url || url.trim() === '') {
      return res.status(400).json({
        success: false,
        error: "URL requerida - por favor ingresa un enlace válido"
      });
    }

    let cleanUrl = url.trim();
    console.log(`🔍 Extrayendo información de: ${cleanUrl}`);

    // Validate Posh.vip URL
    if (!cleanUrl.includes('posh.vip')) {
      return res.status(400).json({
        success: false,
        error: "Debe ser un enlace de Posh.vip válido"
      });
    }

    // Add protocol if missing
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
      console.log(`🔧 Added protocol: ${cleanUrl}`);
    }

    // Validate URL format
    try {
      new URL(cleanUrl);
    } catch (urlError) {
      return res.status(400).json({
        success: false,
        error: "URL inválida - formato incorrecto"
      });
    }

    console.log(`📡 Fetching page: ${cleanUrl}`);

    // Enhanced request with better headers and multiple retry strategies
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/53.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/53.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/53.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0'
    ];

    let response;
    let lastError;

    // Special handling for 401 errors - try different approaches
    const isPublicUrl = cleanUrl.includes('/e/') || cleanUrl.includes('/event/');

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
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        };

        // For bot user agents, add specific headers
        if (userAgents[attempt].includes('facebook') || userAgents[attempt].includes('Twitter')) {
          headers['Accept'] = 'text/html,application/xhtml+xml';
          delete headers['Sec-Fetch-Dest'];
          delete headers['Sec-Fetch-Mode'];
          delete headers['Sec-Fetch-Site'];
        } else {
          headers['Sec-Fetch-Dest'] = 'document';
          headers['Sec-Fetch-Mode'] = 'navigate';
          headers['Sec-Fetch-Site'] = 'none';
        }

        // Add Chrome-specific headers for Chrome user agents
        if (userAgents[attempt].includes('Chrome') && !userAgents[attempt].includes('facebook') && !userAgents[attempt].includes('Twitter')) {
          headers['Sec-Ch-Ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
          headers['Sec-Ch-Ua-Mobile'] = '?0';
          headers['Sec-Ch-Ua-Platform'] = '"Windows"';
        }

        // Add referrer for some attempts
        if (attempt > 2) {
          headers['Referer'] = 'https://www.google.com/';
        }

        response = await fetch(cleanUrl, {
          method: 'GET',
          headers: headers,
          timeout: 30000,
          follow: 10,
          compress: true,
          size: 50 * 1024 * 1024 // 50MB limit
        });

        console.log(`📊 Response: ${response.status} ${response.statusText}`);

        if (response.ok) {
          console.log(`✅ Success on attempt ${attempt + 1}`);
          break;
        } else if (response.status === 401) {
          console.log(`🔐 401 Unauthorized on attempt ${attempt + 1} - trying different approach...`);
          lastError = new Error(`Acceso denegado (401). La página puede requerir autenticación o estar protegida.`);
        } else if (response.status === 403) {
          console.log(`🚫 403 Forbidden on attempt ${attempt + 1} - trying different user agent...`);
          lastError = new Error(`Acceso prohibido (403). El sitio está bloqueando el acceso automático.`);
        } else if (response.status === 404) {
          console.log(`❌ 404 Not Found - el evento puede no existir`);
          lastError = new Error(`Evento no encontrado (404). Verifica que la URL sea correcta y que el evento aún exista.`);
          break; // No point in retrying for 404
        } else {
          console.log(`⚠️ Attempt ${attempt + 1} returned ${response.status}`);
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

      } catch (fetchError) {
        console.log(`❌ Attempt ${attempt + 1} failed:`, fetchError.message);
        lastError = fetchError;

        // Wait a bit before next attempt
        if (attempt < userAgents.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    // If all attempts failed, try to extract basic info from URL as fallback
    if (!response || !response.ok) {
      console.error('❌ All fetch attempts failed');

      // For 401/403 errors, try to extract basic info from URL
      if (lastError && (lastError.message.includes('401') || lastError.message.includes('403'))) {
        console.log('🔄 Attempting to extract basic info from URL due to access restrictions...');

        try {
          const urlBasedEventData = extractBasicEventDataFromUrl(cleanUrl);

          if (urlBasedEventData && urlBasedEventData.title !== 'Evento sin título') {
            console.log('✅ Extracted basic event data from URL:', urlBasedEventData);

            return res.json({
              success: true,
              data: urlBasedEventData,
              warning: 'Información básica extraída de la URL debido a restricciones de acceso. Por favor, completa los detalles manualmente.',
              extractionMethod: 'url-fallback'
            });
          }
        } catch (urlError) {
          console.log('⚠️ URL fallback extraction failed:', urlError.message);
        }
      }

      // Provide more specific error messages
      let errorMessage = 'No se pudo conectar con el sitio web.';
      let suggestions = [
        'Verifica que la URL sea correcta y accesible',
        'Intenta copiar la URL directamente desde el navegador',
        'El evento puede estar protegido o requerir autenticación'
      ];

      if (lastError) {
        if (lastError.message.includes('401')) {
          errorMessage = 'El evento está protegido y requiere autenticación para acceder.';
          suggestions = [
            'Verifica que el evento sea público',
            'Intenta acceder al evento desde tu navegador primero',
            'Completa la información manualmente usando los campos de edición'
          ];
        } else if (lastError.message.includes('403')) {
          errorMessage = 'El sitio web está bloqueando el acceso automático.';
          suggestions = [
            'El sitio puede tener protección contra bots',
            'Intenta nuevamente en unos minutos',
            'Completa la información manualmente'
          ];
        } else if (lastError.message.includes('404')) {
          errorMessage = 'El evento no existe o la URL es incorrecta.';
          suggestions = [
            'Verifica que la URL sea correcta',
            'El evento puede haber sido eliminado o movido',
            'Intenta buscar el evento en posh.vip'
          ];
        }
      }

      return res.status(response?.status || 500).json({
        success: false,
        error: errorMessage,
        details: lastError ? lastError.message : 'All connection attempts failed',
        suggestions: suggestions,
        url: cleanUrl,
        timestamp: new Date().toISOString()
      });
    }


    let html;
    try {
      html = await response.text();
      console.log(`📄 HTML received: ${html.length} characters`);
    } catch (textError) {
      console.error('❌ Error reading response text:', textError);
      return res.status(500).json({
        success: false,
        error: "Error leyendo la respuesta del servidor."
      });
    }

    if (html.length < 100) {
      return res.status(400).json({
        success: false,
        error: "La página parece estar vacía o no se pudo cargar correctamente."
      });
    }

    // Extract event information using improved Posh extraction function
    let eventData;
    try {
      eventData = extractPoshEventData(html, cleanUrl);
    } catch (extractError) {
      console.error('❌ Error extracting data:', extractError);
      return res.status(500).json({
        success: false,
        error: "Error procesando la información de la página: " + extractError.message
      });
    }

    if (!eventData) {
      return res.status(400).json({
        success: false,
        error: "No se pudo extraer información del evento de esta página."
      });
    }

    // Validate that we got something useful
    if ((!eventData.title || eventData.title === 'Evento sin título') &&
        !eventData.image &&
        (!eventData.price || eventData.price === 'Consultar precio')) {
      return res.status(400).json({
        success: false,
        error: "No se pudo extraer información válida de este enlace. Verifica que sea un evento de Posh.vip válido.",
        debug: {
          title: eventData.title || 'N/A',
          hasImage: !!eventData.image,
          price: eventData.price || 'N/A',
          date: eventData.date || 'N/A',
          location: eventData.location || 'N/A'
        }
      });
    }

    // Download and save the image if available
    if (eventData.image && eventData.image.startsWith('http')) {
      try {
        console.log(`🖼️ Descargando imagen: ${eventData.image}`);
        const savedImagePath = await downloadAndSaveEventImage(eventData.image, eventData.title || 'evento');
        eventData.image = savedImagePath;
        eventData.imageUrl = savedImagePath;
        console.log(`✅ Imagen descargada y guardada: ${savedImagePath}`);
      } catch (downloadError) {
        console.error('❌ Error descargando imagen:', downloadError);
        // Keep the original URL as fallback
        eventData.imageUrl = eventData.image;
      }
    }

    console.log('📊 Datos extraídos finales:', {
      title: eventData.title,
      date: eventData.date,
      location: eventData.location,
      price: eventData.price,
      hasImage: !!eventData.image,
      description: eventData.description ? eventData.description.substring(0, 100) + '...' : 'N/A'
    });

    res.json({
      success: true,
      data: eventData
    });

  } catch (error) {
    console.error("❌ Error completo extrayendo evento:", error);
    console.error("❌ Stack trace:", error.stack);

    // Provide more helpful error messages
    let errorMessage = "Error interno extrayendo la información del evento";
    let suggestions = [];

    if (error.name === 'AbortError') {
      errorMessage = "La página tardó demasiado en cargar";
      suggestions = ["Intenta nuevamente en unos segundos", "Verifica tu conexión a internet"];
    } else if (error.message.includes('fetch') || error.message.includes('ENOTFOUND')) {
      errorMessage = "No se pudo conectar con la página de Posh.vip";
      suggestions = [
        "Verifica que la URL sea correcta y completa",
        "Asegúrate de que el evento aún exista en Posh.vip",
        "Intenta copiar la URL directamente desde tu navegador"
      ];
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
      errorMessage = "Error de conexión con el servidor";
      suggestions = ["Verifica tu conexión a internet", "Intenta nuevamente en unos minutos"];
    } else if (error.message.includes('401') || error.message.includes('403')) {
      errorMessage = "El evento está protegido o requiere autenticación";
      suggestions = [
        "Verifica que el evento sea público",
        "Intenta acceder al evento desde tu navegador primero",
        "Completa la información manualmente"
      ];
    } else if (error.message.includes('404')) {
      errorMessage = "El evento no fue encontrado";
      suggestions = [
        "Verifica que la URL sea correcta",
        "El evento puede haber sido eliminado o movido",
        "Busca el evento directamente en posh.vip"
      ];
    } else {
      suggestions = [
        "Intenta nuevamente en unos segundos",
        "Verifica que la URL sea de un evento válido de Posh.vip",
        "Si el problema persiste, completa la información manualmente"
      ];
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      suggestions: suggestions,
      details: error.message,
      timestamp: new Date().toISOString(),
      canRetry: !error.message.includes('404')
    });
  }
});

// Create event from extracted data
router.post('/create-complete-event', requireAdmin, async (req, res) => {
  try {
    console.log('📝 Creando evento completo extraído...');
    console.log('📋 Datos recibidos:', JSON.stringify(req.body, null, 2));

    const eventData = req.body;

    // Validation with better error messages
    if (!eventData.title || eventData.title.trim() === '') {
      console.log('❌ Título faltante en eventData');
      return res.status(400).json({ 
        success: false,
        error: 'El título del evento es requerido para crear el evento',
        received: Object.keys(eventData),
        missingField: 'title'
      });
    }

    if (!eventData.ticketLink || eventData.ticketLink.trim() === '') {
      console.log('❌ TicketLink faltante en eventData');
      return res.status(400).json({ 
        success: false,
        error: 'El link del ticket es requerido para crear el evento',
        received: Object.keys(eventData),
        missingField: 'ticketLink'
      });
    }

    const eventsFile = path.join(__dirname, '../db/events.json');
    console.log('📁 Archivo de eventos:', eventsFile);

    // Ensure directory exists
    const dbDir = path.dirname(eventsFile);
    if (!fsSync.existsSync(dbDir)) {
      await fs.mkdir(dbDir, { recursive: true });
      console.log('📁 Directorio db creado');
    }

    // Read existing events with robust error handling
    let events = [];
    try {
      if (fsSync.existsSync(eventsFile)) {
        const existingData = await fs.readFile(eventsFile, 'utf8');
        events = existingData && existingData.trim() ? JSON.parse(existingData) : [];
        console.log(`📊 Eventos existentes cargados: ${events.length}`);
      } else {
        console.log('📄 Archivo de eventos no existe, creando nuevo');
        events = [];
      }
    } catch (readError) {
      console.log('⚠️ Error leyendo eventos, iniciando lista vacía:', readError.message);
      events = [];
    }

    // Ensure events is always an array
    if (!Array.isArray(events)) {
      console.log('⚠️ Eventos no era array, reiniciando...');
      events = [];
    }

    // Check for duplicates with better logic
    const existingEvent = events.find(e =>
      (e.name && e.name.toLowerCase().trim() === eventData.title.toLowerCase().trim()) || 
      (e.title && e.title.toLowerCase().trim() === eventData.title.toLowerCase().trim()) ||
      (e.ticketLink && e.ticketLink.trim() === eventData.ticketLink.trim())
    );

    if (existingEvent) {
      console.log('❌ Evento duplicado encontrado:', existingEvent.name || existingEvent.title);
      return res.status(409).json({ 
        success: false,
        error: 'Ya existe un evento con ese nombre o link',
        existing: {
          name: existingEvent.name || existingEvent.title,
          id: existingEvent.id,
          ticketLink: existingEvent.ticketLink
        }
      });
    }

    // Handle image download with better error recovery
    let finalImageUrl = eventData.imageUrl || eventData.image || '/images/logo.png';

    if (finalImageUrl && finalImageUrl.startsWith('http')) {
      try {
        console.log(`🖼️ Descargando imagen para evento: ${finalImageUrl}`);
        const imageManager = new EventImageManager();
        const downloadedUrl = await imageManager.saveEventImage(
          finalImageUrl,
          eventData.title,
          eventData.date
        );
        finalImageUrl = downloadedUrl;
        console.log(`✅ Imagen descargada exitosamente: ${finalImageUrl}`);
      } catch (downloadError) {
        console.error('⚠️ Error descargando imagen:', downloadError.message);
        console.log('🔄 Usando URL original como fallback');
        // Keep original URL as fallback - don't fail the entire operation
        // finalImageUrl already contains the original URL, so no change needed
        console.log(`🌐 Manteniendo URL externa: ${finalImageUrl.substring(0, 60)}...`);
      }
    }

    // Generate unique ID safely
    const newId = events.length > 0 ? Math.max(...events.map(e => parseInt(e.id) || 0)) + 1 : 1;
    console.log('🆔 Nuevo ID asignado:', newId);

    // Create comprehensive event object
    const newEvent = {
      id: newId,
      name: eventData.title.trim(),
      title: eventData.title.trim(),
      description: eventData.description || 'Get ready for an unforgettable night at Black Room',
      date: eventData.date || 'Por definir',
      location: eventData.location || 'Miami',
      price: eventData.price || 'Consultar precio',
      image: finalImageUrl,
      images: [finalImageUrl],
      videos: [],
      organizer: 'Black Room',
      ticketLink: eventData.ticketLink.trim(),
      isPoshEvent: true,
      source: 'posh.vip',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      additionalInfo: {
        extractedFrom: eventData.ticketLink,
        extractedAt: new Date().toISOString(),
        originalImageUrl: eventData.imageUrl || eventData.image,
        localImagePath: (finalImageUrl !== eventData.imageUrl && finalImageUrl !== eventData.image) ? finalImageUrl : null,
        extractionMethod: eventData.extractionMethod || 'standard',
        createdBy: req.user?.email || 'admin'
      }
    };

    console.log('📋 Evento completo a guardar:', JSON.stringify(newEvent, null, 2));

    // Add to events array
    events.push(newEvent);

    // Save to file with comprehensive error handling
    try {
      const jsonData = JSON.stringify(events, null, 2);
      await fs.writeFile(eventsFile, jsonData, 'utf8');
      console.log(`✅ Evento completo guardado exitosamente: "${newEvent.name}" (ID: ${newEvent.id})`);
      console.log(`📊 Total eventos ahora: ${events.length}`);
    } catch (writeError) {
      console.error('❌ Error crítico escribiendo archivo:', writeError);
      throw new Error('No se pudo guardar el evento en el archivo: ' + writeError.message);
    }

    // Verify the file was written correctly
    try {
      const verification = await fs.readFile(eventsFile, 'utf8');
      const verifiedEvents = JSON.parse(verification);
      const savedEvent = verifiedEvents.find(e => e.id === newEvent.id);

      if (!savedEvent) {
        throw new Error('El evento no se encontró después de guardarlo');
      }

      console.log(`✅ Verificación exitosa: evento completo "${savedEvent.name}" confirmado en archivo`);
    } catch (verifyError) {
      console.error('❌ Error verificando guardado:', verifyError);
      throw new Error('Error verificando que el evento se guardó correctamente: ' + verifyError.message);
    }

    // Success response
    const response = {
      success: true,
      message: 'Evento extraído creado y guardado exitosamente',
      event: newEvent,
      imageInfo: {
        hasImage: !!finalImageUrl,
        downloaded: finalImageUrl !== eventData.imageUrl && finalImageUrl !== eventData.image,
        localPath: finalImageUrl,
        willDeleteAfter: eventData.date
      },
      stats: {
        totalEvents: events.length,
        eventId: newEvent.id,
        fileWritten: true,
        verified: true,
        extractionMethod: eventData.extractionMethod || 'standard'
      }
    };

    console.log('✅ Enviando respuesta exitosa para evento completo extraído');
    res.json(response);

  } catch (error) {
    console.error('❌ Error completo creando evento extraído:', error);
    console.error('❌ Error stack completo:', error.stack);

    const errorResponse = {
      success: false,
      error: 'Error interno creando el evento extraído',
      details: error.message,
      timestamp: new Date().toISOString(),
      step: 'create-complete-event',
      requestData: {
        hasTitle: !!req.body.title,
        hasTicketLink: !!req.body.ticketLink,
        bodyKeys: Object.keys(req.body)
      }
    };

    console.log('❌ Enviando respuesta de error para evento completo:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Upload custom image for event (with automatic cleanup)
router.post('/upload-event-image', requireAdmin, upload.single('eventImage'), async (req, res) => {
  console.log('🔄 Recibiendo imagen de evento...');
  console.log('📁 Archivo recibido:', req.file ? 'Sí' : 'No');
  console.log('📋 Body:', req.body);

  try {
    if (!req.file) {
      console.log('❌ No se recibió archivo');
      return res.status(400).json({
        success: false,
        error: 'No se recibió ninguna imagen'
      });
    }

    const { eventTitle, eventDate } = req.body;

    if (!eventTitle || eventTitle.trim() === '') {
      console.log('❌ Falta título del evento');
      return res.status(400).json({
        success: false,
        error: 'El título del evento es requerido'
      });
    }

    console.log(`📝 Procesando imagen para evento: ${eventTitle}`);
    console.log(`📅 Fecha del evento: ${eventDate}`);
    console.log(`📄 Archivo original: ${req.file.originalname}`);
    console.log(`📏 Tamaño: ${req.file.size} bytes`);

    // Create safe filename
    const timestamp = Date.now();
    const sanitizedTitle = eventTitle.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30);

    const extension = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const newFilename = `${sanitizedTitle}-${timestamp}${extension}`;

    // Ensure events directory exists
    const eventsDir = path.join(__dirname, '../public/images/events');
    if (!fs.existsSync(eventsDir)) {
      console.log('📁 Creando directorio de eventos...');
      fs.mkdirSync(eventsDir, { recursive: true });
    }

    // Move uploaded file to final location
    const finalPath = path.join(eventsDir, newFilename);

    console.log(`🚚 Moviendo de ${req.file.path} a ${finalPath}`);

    try {
      fs.renameSync(req.file.path, finalPath);
    } catch (moveError) {
      console.log('⚠️ Rename falló, copiando archivo...');
      fs.copyFileSync(req.file.path, finalPath);
      fs.unlinkSync(req.file.path);
    }

    // Save metadata for auto-cleanup using EventImageManager
    try {
      const imageManager = new EventImageManager();
      await imageManager.saveImageMetadata(newFilename, eventTitle, eventDate);
      console.log('📋 Metadatos guardados para limpieza automática');
    } catch (metadataError) {
      console.log('⚠️ Error guardando metadatos:', metadataError.message);
      // Continue without metadata - not critical
    }

    const imageUrl = `/images/events/${newFilename}`;
    console.log(`✅ Imagen guardada exitosamente: ${imageUrl}`);

    res.json({
      success: true,
      imageUrl: imageUrl,
      filename: newFilename,
      message: eventDate ?
        `Imagen subida exitosamente. Se eliminará automáticamente después del ${eventDate}` :
        'Imagen subida exitosamente',
      debug: {
        originalName: req.file.originalname,
        size: req.file.size,
        savedAs: newFilename,
        eventTitle: eventTitle,
        eventDate: eventDate
      }
    });

  } catch (error) {
    console.error('❌ Error completo subiendo imagen:', error);
    console.error('📍 Stack trace:', error.stack);

    // Clean up uploaded file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('🗑️ Archivo temporal limpiado');
      } catch (cleanupError) {
        console.log('⚠️ Error limpiando archivo temporal:', cleanupError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Error subiendo la imagen: ' + error.message,
      details: {
        message: error.message,
        stack: error.stack
      }
    });
  }
});

// Simple endpoint to create event with just image and ticket link
router.post('/simple-event', async (req, res) => {
  try {
    const { image, ticketLink } = req.body;

    if (!image || !ticketLink) {
      return res.status(400).json({ error: 'Image and ticket link are required' });
    }

    // Extract event data from Posh.vip link
    const eventData = await extractEventFromPoshLink(ticketLink);

    // Create new event
    const newEvent = {
      id: Date.now(),
      name: eventData.title,
      date: eventData.date,
      location: eventData.location,
      price: eventData.price || 25,
      image: image,
      ticketLink: ticketLink,
      description: eventData.description || 'Get ready for an unforgettable night at Black Room',
      additionalInfo: eventData.additionalInfo,
      createdAt: new Date().toISOString()
    };

    // Read existing events
    const eventsFile = path.join(__dirname, '../db/events.json');
    let events = [];
    try {
      const data = fs.readFileSync(eventsFile, 'utf8');
      events = JSON.parse(data);
    } catch (error) {
      console.log('No existing events file, creating new one');
    }

    // Add new event
    events.push(newEvent);

    // Save events
    fs.writeFileSync(eventsFile, JSON.stringify(events, null, 2));

    console.log('✅ Event created successfully:', newEvent.name);
    res.json( {
      success: true,
      message: 'Event created successfully',
      event: newEvent
    });

  } catch (error) {
    console.error('❌ Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event: ' + error.message });
  }
});

// Helper function to extract event data from Posh.vip link
async function extractEventFromPoshLink(ticketLink) {
  try {
    if (!ticketLink.includes('posh.vip')) {
      throw new Error('Not a valid Posh.vip link');
    }

    console.log('🔍 Extracting event data from:', ticketLink);

    const response = await fetch(ticketLink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/53.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    const extractedData = extractPoshEventData(html, ticketLink);

    if (!extractedData || !extractedData.name || extractedData.name === 'Evento sin título') {
      throw new Error('No se pudo extraer información válida del evento');
    }

    return extractedData;

  } catch (error) {
    console.error('❌ Error extracting from Posh.vip:', error);
    throw error;
  }
}


function extractPoshEventData(html, url) {
  try {
    console.log(`🔍 Extracting data from: ${url}`);
    console.log(`📄 HTML length: ${html.length} characters`);

    // Clean HTML entities first
    const cleanHtml = html
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Extract title with enhanced Posh.vip specific patterns
    let title = 'Evento sin título';

    // First try to find the main event title in the page content
    const mainTitlePatterns = [
      // Posh.vip specific patterns - look for h1, h2 elements that contain the event name
      /<h1[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>[^<]*)*)<\/h1>/gi,
      /<h2[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>[^<]*)*)<\/h2>/gi,
      // Look for title class patterns
      /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/gi,
      /<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/gi,
      // Event name patterns
      /<div[^>]*class="[^"]*event[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/gi,
      /<span[^>]*class="[^"]*event[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/gi
    ];

    for (const pattern of mainTitlePatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(cleanHtml);
      if (match && match[1]) {
        let candidateTitle = match[1]
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/\s+/g, ' ')
          .trim();

        // Skip if too short or contains unwanted patterns
        if (candidateTitle.length > 5 &&
            !candidateTitle.toLowerCase().includes('posh.vip') &&
            !candidateTitle.toLowerCase().includes('login') &&
            !candidateTitle.toLowerCase().includes('signup') &&
            !candidateTitle.includes('{') &&
            !candidateTitle.includes('}')) {
          title = candidateTitle;
          console.log(`✅ Found title from main content: ${title}`);
          break;
        }
      }
    }

    // If no content title found, try JSON-LD structured data
    if (title === 'Evento sin título') {
      const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
      let jsonLdMatch;
      while ((jsonLdMatch = jsonLdPattern.exec(cleanHtml)) !== null) {
        try {
          const jsonData = JSON.parse(jsonLdMatch[1]);
          if (jsonData.name && jsonData.name.length > 3) {
            title = jsonData.name.trim();
            console.log(`✅ Found title from JSON-LD: ${title}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    // If still no title, try meta tags with better filtering
    if (title === 'Evento sin título') {
      const metaTitlePatterns = [
        /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/gi,
        /<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/gi,
        /<title[^>]*>([^<]+)<\/title>/gi
      ];

      for (const pattern of metaTitlePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1] && match[1].trim().length > 3) {
          let candidateTitle = match[1].trim()
            .replace(/\| Posh\.vip.*$/i, '') // Remove Posh.vip suffix
            .replace(/-\s*Posh\.vip.*$/i, '')
            .replace(/\|\s*Get.*tickets.*$/i, '') // Remove "Get tickets" suffix
            .replace(/-\s*Get.*tickets.*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (candidateTitle.length > 3 && !candidateTitle.toLowerCase().includes('posh.vip')) {
            title = candidateTitle;
            console.log(`✅ Found title from meta tags: ${title}`);
            break;
          }
        }
      }
    }

    // Enhanced URL extraction as last resort
    if (title === 'Evento sin título') {
      const urlMatch = url.match(/posh\.vip\/e\/([^\/\?&#]+)/i);
      if (urlMatch && urlMatch[1]) {
        title = urlMatch[1]
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase())
          .trim();
        console.log(`✅ Found title from URL: ${title}`);
      }
    }

    // Extract image with enhanced Posh.vip specific patterns
    let imageUrl = null;

    // First try JSON-LD structured data for image
    const jsonLdImagePattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let jsonLdImageMatch;
    while ((jsonLdImageMatch = jsonLdImagePattern.exec(cleanHtml)) !== null) {
      try {
        const jsonData = JSON.parse(jsonLdImageMatch[1]);
        if (jsonData.image && typeof jsonData.image === 'string' && jsonData.image.includes('http')) {
          imageUrl = jsonData.image.trim();
          console.log(`✅ Found image from JSON-LD: ${imageUrl}`);
          break;
        } else if (jsonData.image && Array.isArray(jsonData.image) && jsonData.image[0]) {
          imageUrl = jsonData.image[0].trim();
          console.log(`✅ Found image from JSON-LD array: ${imageUrl}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // If no JSON-LD image, try meta tags (most reliable for Posh.vip)
    if (!imageUrl) {
      const metaImagePatterns = [
        // OpenGraph image - highest priority
        /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/gi,
        // Twitter image
        /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi,
        /<meta[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/gi,
        /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/gi
      ];

      for (const pattern of metaImagePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1] && match[1].trim().includes('http')) {
          imageUrl = match[1].trim();
          console.log(`✅ Found image from meta tags: ${imageUrl}`);
          break;
        }
      }
    }

    // If still no image, try Posh.vip specific CDN patterns (ENHANCED FOR MARKDOWN)
    if (!imageUrl) {
      const poshCdnPatterns = [
        // CRITICAL: Markdown-style image links - ![alt](url) format
        /!\[[^\]]*\]\((https:\/\/posh\.vip\/cdn-cgi\/image\/[^)]+)\)/gi,
        /!\[[^\]]*\]\((https:\/\/posh-images[^)]*\.s3\.amazonaws\.com\/[^)]+)\)/gi,
        // Direct CDN URLs anywhere in the content
        /(https:\/\/posh\.vip\/cdn-cgi\/image\/[^\s"'<>)]+)/gi,
        /(https:\/\/posh-images[^.\s]*\.s3\.amazonaws\.com\/[^\s"'<>)]+)/gi,
        // HTML attributes (existing patterns)
        /src="(https:\/\/posh\.vip\/cdn-cgi\/image\/[^"]+)"/gi,
        /src="(https:\/\/posh-images[^"]*\.s3\.amazonaws\.com\/[^"]+)"/gi,
        // Background image styles
        /background-image:\s*url\(["']?(https:\/\/posh[^"']+)["']?\)/gi,
        // Data attributes with Posh CDN
        /data-src="(https:\/\/posh[^"]+\.(?:jpg|jpeg|png|webp|gif))"/gi
      ];

      for (const pattern of poshCdnPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1]) {
          imageUrl = match[1].trim();
          // Clean up any trailing characters that might interfere
          imageUrl = imageUrl.replace(/[)\]}"'>]*$/, '');
          console.log(`✅ Found Posh CDN image (enhanced): ${imageUrl.substring(0, 80)}...`);
          break;
        }
      }
    }

    // Enhanced image extraction with more aggressive patterns
    if (!imageUrl) {
      console.log(`🔍 Trying enhanced image patterns...`);
      
      // Look for lazy-loaded images with data-src
      const lazyImagePatterns = [
        /data-src="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*>/gi,
        /data-lazy="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*>/gi,
        /data-original="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*>/gi,
        // Modern lazy loading attributes
        /loading="lazy"[^>]*src="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*>/gi,
        /src="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*loading="lazy"/gi
      ];

      for (const pattern of lazyImagePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1] && match[1].includes('http')) {
          let candidateImage = match[1].trim();
          if (!candidateImage.includes('logo') && 
              !candidateImage.includes('icon') && 
              !candidateImage.includes('avatar') && 
              candidateImage.length > 30) {
            imageUrl = candidateImage;
            console.log(`🖼️ Found lazy-loaded image: ${imageUrl.substring(0, 60)}...`);
            break;
          }
        }
      }
    }

    // Try to find images in CSS background-image properties
    if (!imageUrl) {
      const bgImagePatterns = [
        /background-image:\s*url\(["']?([^"'\)]+\.(?:jpg|jpeg|png|webp|gif)[^"'\)]*)["']?\)/gi,
        /background:\s*url\(["']?([^"'\)]+\.(?:jpg|jpeg|png|webp|gif)[^"'\)]*)["']?\)/gi
      ];

      for (const pattern of bgImagePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1] && (match[1].includes('http') || match[1].includes('posh'))) {
          let candidateImage = match[1].trim();
          if (!candidateImage.startsWith('http')) {
            candidateImage = 'https://posh.vip' + (candidateImage.startsWith('/') ? candidateImage : '/' + candidateImage);
          }
          imageUrl = candidateImage;
          console.log(`🎨 Found CSS background image: ${imageUrl.substring(0, 60)}...`);
          break;
        }
      }
    }

    // More aggressive image search - look for ANY reasonable image
    if (!imageUrl) {
      const allImagePatterns = [
        /<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*>/gi,
        /<picture[^>]*>.*?<source[^>]+srcset="([^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"[^>]*>.*?<\/picture>/gis,
        /srcset="[^"]*([^,\s]+\.(?:jpg|jpeg|png|webp|gif)[^,\s]*)/gi
      ];

      for (const pattern of allImagePatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(cleanHtml)) !== null) {
          if (match[1] && (match[1].includes('http') || match[1].includes('posh'))) {
            let candidateImage = match[1].trim();
            
            // Convert relative URLs to absolute
            if (!candidateImage.startsWith('http')) {
              candidateImage = 'https://posh.vip' + (candidateImage.startsWith('/') ? candidateImage : '/' + candidateImage);
            }

            // Skip small/icon images and common non-event images
            if (candidateImage.length > 40 &&
                !candidateImage.includes('logo') &&
                !candidateImage.includes('icon') &&
                !candidateImage.includes('avatar') &&
                !candidateImage.includes('favicon') &&
                !candidateImage.includes('sprite') &&
                !candidateImage.includes('thumb') &&
                !candidateImage.includes('small')) {
              imageUrl = candidateImage;
              console.log(`📸 Found candidate image: ${imageUrl.substring(0, 60)}...`);
              break;
            }
          }
        }
        if (imageUrl) break;
      }
    }

    // Extract price with enhanced Posh.vip specific patterns
    let price = 'Consultar precio';

    // First try JSON-LD structured data for price
    const jsonLdPricePattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let jsonLdPriceMatch;
    while ((jsonLdPriceMatch = jsonLdPricePattern.exec(cleanHtml)) !== null) {
      try {
        const jsonData = JSON.parse(jsonLdPriceMatch[1]);

        // Look for offers with price
        if (jsonData.offers && jsonData.offers.price) {
          const priceValue = parseFloat(jsonData.offers.price);
          if (!isNaN(priceValue) && priceValue > 0) {
            price = '$' + priceValue;
            console.log(`✅ Found price from JSON-LD offers: ${price}`);
            break;
          }
        }

        // Look for direct price field
        if (jsonData.price) {
          const priceValue = parseFloat(jsonData.price);
          if (!isNaN(priceValue) && priceValue > 0) {
            price = '$' + priceValue;
            console.log(`✅ Found price from JSON-LD: ${price}`);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // If no JSON-LD price, try specific Posh.vip patterns
    if (price === 'Consultar precio') {
      const poshPricePatterns = [
        // Posh.vip specific selectors and patterns
        /<div[^>]*class="[^"]*ticket[^"]*price[^"]*"[^>]*>.*?\$([0-9]+(?:\.[0-9]{2})?).*?<\/div>/gi,
        /<span[^>]*class="[^"]*price[^"]*"[^>]*>\$([0-9]+(?:\.[0-9]{2})?)<\/span>/gi,
        /<div[^>]*data-price[^>]*>.*?\$([0-9]+(?:\.[0-9]{2})?).*?<\/div>/gi,
        // Button with price
        /<button[^>]*>.*?Get tickets.*?\$([0-9]+(?:\.[0-9]{2})?).*?<\/button>/gi,
        /<button[^>]*>.*?Buy.*?\$([0-9]+(?:\.[0-9]{2})?).*?<\/button>/gi,
        // Meta property for price
        /<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([0-9]+(?:\.[0-9]{2})?)["']/gi,
        // Common price display patterns
        /Price:\s*\$([0-9]+(?:\.[0-9]{2})?)/gi,
        /\$([0-9]+(?:\.[0-9]{2})?)\s*USD/gi,
        // Data attributes
        /data-price=["']([0-9]+(?:\.[0-9]{2})?)["']/gi,
        // Free patterns
        /(FREE|GRATIS|LIBRE|Free|Gratis)\s*(?:ENTRY|ADMISSION|TICKET)?/gi
      ];

      for (const pattern of poshPricePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);

        if (match && match[1]) {
          // Numeric price found
          const foundPrice = match[1].trim();
          const numericPrice = parseFloat(foundPrice);

          if (!isNaN(numericPrice) && numericPrice > 0 && numericPrice < 10000) {
            price = '$' + foundPrice;
            console.log(`✅ Found price from Posh patterns: ${price}`);
            break;
          }
        } else if (match && match[0]) {
          // Free event pattern
          const freeMatch = match[0].toLowerCase();
          if (freeMatch.includes('free') || freeMatch.includes('gratis') || freeMatch.includes('libre')) {
            price = 'Gratis';
            console.log(`✅ Found free event: ${price}`);
            break;
          }
        }
      }
    }

    // Last resort: scan for any price-like pattern
    if (price === 'Consultar precio') {
      const generalPricePattern = /\$([0-9]+(?:\.[0-9]{2})?)/g;
      const prices = [];
      let generalMatch;

      while ((generalMatch = generalPricePattern.exec(cleanHtml)) !== null) {
        const priceValue = parseFloat(generalMatch[1]);
        if (!isNaN(priceValue) && priceValue >= 5 && priceValue <= 500) {
          prices.push(priceValue);
        }
      }

      if (prices.length > 0) {
        // Take the most common reasonable price
        const mostCommon = prices.sort((a,b) =>
          prices.filter(v => v === b).length - prices.filter(v => v === a).length
        )[0];
        price = '$' + mostCommon;
        console.log(`✅ Found price from general scan: ${price}`);
      }
    }

    // Extract date with enhanced Posh.vip specific patterns
    let eventDate = 'Por definir';

    // First try JSON-LD structured data for date
    const jsonLdDatePattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let jsonLdDateMatch;
    while ((jsonLdDateMatch = jsonLdDatePattern.exec(cleanHtml)) !== null) {
      try {
        const jsonData = JSON.parse(jsonLdDateMatch[1]);
        if (jsonData.startDate && jsonData.startDate.length > 5) {
          eventDate = jsonData.startDate.split('T')[0]; // Get just the date part
          console.log(`✅ Found date from JSON-LD: ${eventDate}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // If no JSON-LD date, try meta tags and structured patterns
    if (eventDate === 'Por definir') {
      const datePatterns = [
        // Time element with datetime attribute (most reliable)
        /<time[^>]*datetime=["']([^"']+)["'][^>]*>/gi,
        // Meta tags for events
        /<meta[^>]*property=["']event:start_time["'][^>]*content=["']([^"']+)["']/gi,
        // Common date display patterns
        /Date:\s*([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
        /(\d{4}-\d{2}-\d{2})/g,
        // Day, Month DD, YYYY format
        /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/gi,
        // MM/DD/YYYY format
        /(\d{1,2}\/\d{1,2}\/\d{4})/g
      ];

      for (const pattern of datePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1] && match[1].trim().length > 5) {
          let foundDate = match[1].trim();

          // Clean the date
          if (foundDate.includes('T')) {
            foundDate = foundDate.split('T')[0];
          }

          // Try to parse and validate
          try {
            const parsedDate = new Date(foundDate);
            if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() >= 2024) {
              eventDate = parsedDate.toISOString().split('T')[0];
              console.log(`✅ Found date from patterns: ${eventDate}`);
              break;
            }
          } catch (e) {
            // Keep original if it looks like a valid date format
            if (foundDate.match(/\d{4}-\d{2}-\d{2}/) || foundDate.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
              eventDate = foundDate;
              console.log(`✅ Found date (raw format): ${eventDate}`);
              break;
            }
          }
        }
      }
    }

    // Extract location with enhanced Posh.vip specific patterns
    let location = 'Miami';

    // First try JSON-LD structured data for location
    const jsonLdLocationPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let jsonLdLocationMatch;
    while ((jsonLdLocationMatch = jsonLdLocationPattern.exec(cleanHtml)) !== null) {
      try {
        const jsonData = JSON.parse(jsonLdLocationMatch[1]);

        // Check for location object
        if (jsonData.location && jsonData.location.name) {
          location = jsonData.location.name.trim();
          console.log(`✅ Found location from JSON-LD: ${location}`);
          break;
        }

        // Check for direct address
        if (jsonData.location && jsonData.location.address && jsonData.location.address.addressLocality) {
          location = jsonData.location.address.addressLocality.trim();
          console.log(`✅ Found location from JSON-LD address: ${location}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // If no JSON-LD location, try specific patterns
    if (location === 'Miami') {
      const locationPatterns = [
        // Meta tags for location
        /<meta[^>]*property=["']event:location["'][^>]*content=["']([^"']+)["']/gi,
        // Address patterns
        /Location:\s*([^<\n]+)/gi,
        /Venue:\s*([^<\n]+)/gi,
        /Address:\s*([^<\n]+)/gi,
        // Geographic icon patterns
        /📍\s*([^<\n]{3,50})/gi,
        /🏢\s*([^<\n]{3,50})/gi,
        // Data attributes
        /data-location=["']([^"']+)["']/gi,
        /data-venue=["']([^"']+)["']/gi,
        // Common location elements
        /<div[^>]*class="[^"]*(?:location|venue|address)[^"]*"[^>]*>([^<]+)<\/div>/gi,
        /<span[^>]*class="[^"]*(?:location|venue|address)[^"]*"[^>]*>([^<]+)<\/span>/gi
      ];

      for (const pattern of locationPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(cleanHtml);
        if (match && match[1] && match[1].trim().length > 2) {
          let foundLocation = match[1].trim()
            .replace(/[^\w\s,\-\.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          // Skip if it looks like code or unwanted content
          if (!foundLocation.includes('script') &&
              !foundLocation.includes('function') &&
              !foundLocation.includes('{') &&
              foundLocation.length >= 3 &&
              foundLocation.length <= 100) {
            location = foundLocation;
            console.log(`✅ Found location from patterns: ${location}`);
            break;
          }
        }
      }
    }

    // Extract description with enhanced patterns
    let description = 'Get ready for an unforgettable night at Black Room';
    const descPatterns = [
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/gi,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/gi,
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/gi,
      /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/gi,
      /<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/gi,
      /"description"\s*:\s*"([^"]+)"/gi,
      /description[^>]*[:>]\s*([^<\n]+)/gi
    ];

    for (const pattern of descPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(cleanHtml);
      if (match && match[1] && match[1].trim().length > 15 &&
          !match[1].includes('{') &&
          !match[1].includes('function') &&
          !match[1].toLowerCase().includes('posh.vip') &&
          !match[1].toLowerCase().includes('get tickets')) {
        description = match[1].trim()
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&#x27;/g, "'")
          .replace(/&nbsp;/g, ' ');
        console.log(`✅ Found description: ${description.substring(0, 100)}...`);
        break;
      }
    }

    const eventData = {
      title: title,
      name: title,
      description: description,
      date: eventDate,
      location: location,
      price: price,
      image: imageUrl,
      imageUrl: imageUrl,
      additionalInfo: {
        extractedFrom: url,
        extractedAt: new Date().toISOString()
      },
      ticketLink: url
    };

    console.log(`✅ Complete extracted event data:`, {
      title: eventData.title,
      date: eventData.date,
      location: eventData.location,
      price: eventData.price,
      hasImage: !!imageUrl,
      imageUrl: imageUrl ? imageUrl.substring(0, 50) + '...' : null
    });

    return eventData;
  } catch (error) {
    console.error('❌ Error extracting Posh event data:', error);
    throw error;
  }
}

// Helper function to extract basic event data from URL as a fallback
function extractBasicEventDataFromUrl(url) {
  try {
    console.log(`🔄 Attempting basic extraction from URL: ${url}`);
    const urlParts = url.split('/');
    const potentialTitle = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];

    let title = 'Evento sin título';
    if (potentialTitle && potentialTitle.length > 3) {
      title = potentialTitle
        .replace(/-%20/g, '-') // Decode URL encoding
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim();
      console.log(`✅ Basic title extracted from URL: ${title}`);
    }

    return {
      title: title,
      name: title,
      description: 'Información básica extraída de la URL.',
      date: 'Por definir',
      location: 'Por definir',
      price: 'Consultar precio',
      image: null,
      imageUrl: null,
      additionalInfo: {
        extractedFrom: url,
        extractionMethod: 'url-fallback'
      },
      ticketLink: url
    };
  } catch (error) {
    console.error('❌ Error in basic URL extraction:', error);
    throw error;
  }
}


// Function to download and save event images
async function downloadAndSaveEventImage(imageUrl, eventTitle, eventDate = null) {
  const imageManager = new EventImageManager();
  return await imageManager.saveEventImage(imageUrl, eventTitle, eventDate);
}

// Route for admin panel
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

// Route to create event from admin panel
router.post("/create-event", requireAdmin, async (req, res) => {
  try {
    console.log('📝 Creando evento desde admin panel...');
    console.log('📋 Datos recibidos:', JSON.stringify(req.body, null, 2));

    const {
      name,
      title,
      date,
      location,
      price,
      description,
      image,
      ticketLink,
      isPoshEvent,
      customImage
    } = req.body;

    // Use name or title, whichever is provided
    const eventName = name || title;

    // Validation
    if (!eventName || eventName.trim() === '') {
      console.log('❌ Nombre del evento faltante');
      return res.status(400).json({
        success: false,
        error: 'El nombre del evento es requerido'
      });
    }

    if (!ticketLink || ticketLink.trim() === '') {
      console.log('❌ Link del evento faltante');
      return res.status(400).json({
        success: false,
        error: 'El link del evento es requerido'
      });
    }

    const eventsFile = path.join(__dirname, '../db/events.json');
    console.log('📁 Archivo de eventos:', eventsFile);

    // Ensure directory exists
    const dbDir = path.dirname(eventsFile);
    if (!fsSync.existsSync(dbDir)) {
      await fs.mkdir(dbDir, { recursive: true });
      console.log('📁 Directorio db creado');
    }

    // Load existing events with proper error handling
    let events = [];
    try {
      if (fsSync.existsSync(eventsFile)) {
        const data = await fs.readFile(eventsFile, 'utf8');
        events = data && data.trim() ? JSON.parse(data) : [];
        console.log(`📊 Eventos existentes cargados: ${events.length}`);
      } else {
        console.log('📄 Creando nuevo archivo de eventos');
        events = [];
      }
    } catch (readError) {
      console.log('⚠️ Error leyendo eventos, iniciando lista vacía:', readError.message);
      events = [];
    }

    // Ensure events is always an array
    if (!Array.isArray(events)) {
      console.log('⚠️ Eventos no era array, reiniciando...');
      events = [];
    }

    // Check for duplicates
    const existingEvent = events.find(e =>
      (e.name && e.name.toLowerCase() === eventName.toLowerCase()) || 
      (e.title && e.title.toLowerCase() === eventName.toLowerCase()) ||
      (e.ticketLink && e.ticketLink.trim() === ticketLink.trim())
    );

    if (existingEvent) {
      console.log('❌ Evento duplicado encontrado:', existingEvent.name || existingEvent.title);
      return res.status(409).json({
        success: false,
        error: 'Ya existe un evento con ese nombre o link',
        existing: existingEvent.name || existingEvent.title
      });
    }

    // Determine final image with fallback
    const finalImage = customImage || image || '/images/logo.png';
    console.log('🖼️ Imagen final del evento:', finalImage);

    // Generate unique ID safely
    const newId = events.length > 0 ? Math.max(...events.map(e => parseInt(e.id) || 0)) + 1 : 1;
    console.log('🆔 Nuevo ID asignado:', newId);

    // Create comprehensive event object
    const newEvent = {
      id: newId,
      name: eventName.trim(),
      title: eventName.trim(),
      date: date || 'Por definir',
      location: location || 'Miami',
      price: price || 'Consultar precio',
      description: description || 'Get ready for an unforgettable night at Black Room',
      image: finalImage,
      images: [finalImage],
      videos: [],
      ticketLink: ticketLink.trim(),
      organizer: 'Black Room',
      isPoshEvent: isPoshEvent === true || isPoshEvent === 'true',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      source: 'admin_panel',
      additionalInfo: {
        createdBy: req.user?.email || 'admin',
        createdFromPanel: true,
        hasCustomImage: !!customImage,
        originalData: {
          customImage: customImage,
          extractedImage: image
        }
      }
    };

    console.log('📋 Evento a guardar:', JSON.stringify(newEvent, null, 2));

    // Add to events array
    events.push(newEvent);

    // Save events with comprehensive error handling
    try {
      const jsonData = JSON.stringify(events, null, 2);
      await fs.writeFile(eventsFile, jsonData, 'utf8');
      console.log(`✅ Evento guardado exitosamente: "${newEvent.name}" (ID: ${newEvent.id})`);
      console.log(`📊 Total eventos ahora: ${events.length}`);
    } catch (writeError) {
      console.error('❌ Error crítico escribiendo archivo:', writeError);
      throw new Error('No se pudo guardar el evento en el archivo: ' + writeError.message);
    }

    // Verify the file was written correctly
    try {
      const verification = await fs.readFile(eventsFile, 'utf8');
      const verifiedEvents = JSON.parse(verification);
      const savedEvent = verifiedEvents.find(e => e.id === newEvent.id);

      if (!savedEvent) {
        throw new Error('El evento no se guardó correctamente');
      }

      console.log(`✅ Verificación exitosa: evento ${savedEvent.name} confirmado en archivo`);
    } catch (verifyError) {
      console.error('❌ Error verificando guardado:', verifyError);
      throw new Error('Error verificando que el evento se guardó: ' + verifyError.message);
    }

    // Success response
    const response = {
      success: true,
      message: 'Evento creado y guardado exitosamente',
      event: newEvent,
      stats: {
        totalEvents: events.length,
        eventId: newEvent.id,
        hasCustomImage: !!customImage,
        finalImage: finalImage,
        fileWritten: true,
        verified: true
      }
    };

    console.log('✅ Enviando respuesta exitosa');
    res.json(response);

  } catch (error) {
    console.error('❌ Error completo creando evento:', error);
    console.error('❌ Error stack completo:', error.stack);

    const errorResponse = {
      success: false,
      error: 'Error interno al crear el evento',
      details: error.message,
      timestamp: new Date().toISOString(),
      step: 'create-event',
      requestData: {
        hasName: !!(req.body.name || req.body.title),
        hasTicketLink: !!req.body.ticketLink,
        bodyKeys: Object.keys(req.body)
      }
    };

    console.log('❌ Enviando respuesta de error:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Route to update existing event
router.put('/update-event/:id', requireAdmin, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const eventData = req.body;

    console.log(`📝 Actualizando evento ID: ${eventId}`);
    console.log('📋 Datos recibidos:', JSON.stringify(eventData, null, 2));

    if (!eventData.name || eventData.name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'El nombre del evento es requerido'
      });
    }

    const eventsFile = path.join(__dirname, '../db/events.json');

    // Read existing events
    let events = [];
    try {
      if (fsSync.existsSync(eventsFile)) {
        const data = await fs.readFile(eventsFile, 'utf8');
        events = data && data.trim() ? JSON.parse(data) : [];
      }
    } catch (readError) {
      console.error('❌ Error leyendo eventos:', readError);
      return res.status(500).json({
        success: false,
        error: 'Error leyendo el archivo de eventos'
      });
    }

    // Find event to update
    const eventIndex = events.findIndex(e => e.id === eventId);
    if (eventIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Evento no encontrado'
      });
    }

    // Update event data
    const existingEvent = events[eventIndex];
    events[eventIndex] = {
      ...existingEvent,
      name: eventData.name.trim(),
      title: eventData.name.trim(),
      date: eventData.date || existingEvent.date,
      location: eventData.location || existingEvent.location,
      price: eventData.price || existingEvent.price,
      description: eventData.description || existingEvent.description,
      image: eventData.image || existingEvent.image,
      lastUpdated: new Date().toISOString(),
      updatedBy: req.user?.email || 'admin'
    };

    // Save updated events
    await fs.writeFile(eventsFile, JSON.stringify(events, null, 2));

    console.log(`✅ Evento ${eventId} actualizado exitosamente`);

    res.json({
      success: true,
      message: 'Evento actualizado exitosamente',
      event: events[eventIndex]
    });

  } catch (error) {
    console.error('❌ Error actualizando evento:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno actualizando el evento: ' + error.message
    });
  }
});

// Route to delete event
router.delete('/delete-event/:id', requireAdmin, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);

    console.log(`🗑️ Eliminando evento ID: ${eventId}`);

    const eventsFile = path.join(__dirname, '../db/events.json');

    // Read existing events
    let events = [];
    try {
      if (fsSync.existsSync(eventsFile)) {
        const data = await fs.readFile(eventsFile, 'utf8');
        events = data && data.trim() ? JSON.parse(data) : [];
      }
    } catch (readError) {
      console.error('❌ Error leyendo eventos:', readError);
      return res.status(500).json({
        success: false,
        error: 'Error leyendo el archivo de eventos'
      });
    }

    // Find event to delete
    const eventIndex = events.findIndex(e => e.id === eventId);
    if (eventIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Evento no encontrado'
      });
    }

    const eventToDelete = events[eventIndex];

    // Remove event from array
    events.splice(eventIndex, 1);

    // Save updated events
    await fs.writeFile(eventsFile, JSON.stringify(events, null, 2));

    console.log(`✅ Evento ${eventId} eliminado exitosamente: ${eventToDelete.name}`);

    res.json({
      success: true,
      message: 'Evento eliminado exitosamente',
      deletedEvent: {
        id: eventId,
        name: eventToDelete.name
      },
      remainingEvents: events.length
    });

  } catch (error) {
    console.error('❌ Error eliminando evento:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno eliminando el evento: ' + error.message
    });
  }
});

// Route to manage stored event images
router.get("/event-images", async (req, res) => {
  try {
    const imageManager = new EventImageManager();
    const storedImages = await imageManager.listStoredImages();

    res.json({
      success: true,
      images: storedImages,
      count: Object.keys(storedImages).length
    });
  } catch (error) {
    console.error("❌ Error listando imágenes:", error);
    res.status(500).json({ error: "Error obteniendo imágenes almacenadas" });
  }
});

// Route to manually cleanup expired images
router.post("/cleanup-images", async (req, res) => {
  try {
    const imageManager = new EventImageManager();
    await imageManager.cleanupExpiredImages();

    res.json({
      success: true,
      message: "Limpieza de imágenes completada"
    });
  } catch (error) {
    console.error("❌ Error en limpieza manual:", error);
    res.status(500).json({ error: "Error en limpieza de imágenes" });
  }
});

export default router;
