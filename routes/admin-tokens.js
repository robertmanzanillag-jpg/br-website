import express from 'express';
import multer from 'multer';
import path from 'path'; // Import path module
import fs from 'fs'; // Import fs module
import { Client } from '@replit/object-storage';
import pool from '../database/connection.js'; // This import might be unused now if dbPool is used throughout
import { generateTokenCode, generatePrefix } from '../utils/tokenGenerator.js';

const router = express.Router();

// Alias pool to dbPool for consistency if pool is indeed replaced everywhere
const dbPool = pool;

// Diagnostic endpoint for troubleshooting loading issues
router.get('/diagnostic', async (req, res) => {
  const startTime = Date.now();
  let client;

  try {
    console.log('🔧 [DIAGNOSTIC] Starting system diagnostic...');

    const diagnostic = {
      timestamp: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      database: {},
      routes: {
        currentRoute: '/admin/tokens/diagnostic',
        method: req.method,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      }
    };

    // Test database connection
    try {
      console.log('🔧 [DIAGNOSTIC] Testing database connection...');
      client = await dbPool.connect();

      const dbTest = await client.query('SELECT NOW() as current_time, version() as db_version');
      diagnostic.database = {
        status: 'connected',
        currentTime: dbTest.rows[0].current_time,
        version: dbTest.rows[0].db_version.split(' ')[0],
        poolStats: {
          total: dbPool.totalCount,
          idle: dbPool.idleCount,
          waiting: dbPool.waitingCount
        }
      };

      // Test batches table
      const batchesTest = await client.query('SELECT COUNT(*) as count FROM batches');
      const tokensTest = await client.query('SELECT COUNT(*) as count FROM tokens');

      diagnostic.database.tables = {
        batches: parseInt(batchesTest.rows[0].count),
        tokens: parseInt(tokensTest.rows[0].count)
      };

      console.log('🔧 [DIAGNOSTIC] Database tests passed');

    } catch (dbError) {
      console.error('🔧 [DIAGNOSTIC] Database test failed:', dbError);
      diagnostic.database = {
        status: 'failed',
        error: dbError.message,
        code: dbError.code
      };
    }

    diagnostic.responseTime = Date.now() - startTime;
    console.log(`🔧 [DIAGNOSTIC] Completed in ${diagnostic.responseTime}ms`);

    res.json(diagnostic);

  } catch (error) {
    console.error('🔧 [DIAGNOSTIC] System diagnostic failed:', error);
    res.status(500).json({
      error: 'Diagnostic failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (client) {
      try {
        client.release();
      } catch (releaseError) {
        console.error('🔧 [DIAGNOSTIC] Error releasing client:', releaseError);
      }
    }
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  let client;
  try {
    // Test database connection
    client = await dbPool.connect();
    const dbResult = await client.query('SELECT NOW(), version()');
    healthCheck.checks.database = {
      status: 'connected',
      timestamp: dbResult.rows[0].now,
      version: dbResult.rows[0].version.split(' ')[0]
    };

    // Test pool status
    healthCheck.checks.connectionPool = {
      total: dbPool.totalCount,
      idle: dbPool.idleCount,
      waiting: dbPool.waitingCount
    };

    // Test token generation
    const { generateTokenCode } = await import('../utils/tokenGenerator.js');
    const testCode = generateTokenCode('HEALTH', 6);
    healthCheck.checks.tokenGeneration = {
      status: testCode ? 'working' : 'failed',
      sample: testCode
    };

    // Test batch count
    const batchCount = await client.query('SELECT COUNT(*) as count FROM batches');
    const tokenCount = await client.query('SELECT COUNT(*) as count FROM tokens');
    healthCheck.checks.dataIntegrity = {
      batches: parseInt(batchCount.rows[0].count),
      tokens: parseInt(tokenCount.rows[0].count)
    };

    res.json(healthCheck);

  } catch (error) {
    console.error('❌ Health check failed:', error);
    healthCheck.status = 'unhealthy';
    healthCheck.error = error.message;
    healthCheck.checks.database = { status: 'failed', error: error.message };

    res.status(500).json(healthCheck);
  } finally {
    if (client) {
      try {
        client.release();
      } catch (releaseError) {
        console.error('❌ Error releasing health check client:', releaseError);
      }
    }
  }
});

// Configurar multer para subida de archivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB máximo
  },
  fileFilter: (req, file, cb) => {
    console.log(`📁 Archivo recibido: ${file.originalname}`);
    console.log(`🎨 Tipo MIME detectado: ${file.mimetype}`);

    // Extensiones permitidas (incluyendo todas las variantes de JPEG)
    const allowedExtensions = [
      '.jpg', '.jpeg', '.jpe', '.jfif', '.jfi', '.png', '.gif',
      '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif',
      '.heic', '.heif', '.ico', '.pjpeg', '.pjp'
    ];

    // MIME types permitidos (lista completa incluyendo JPEG)
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png',
      'image/gif', 'image/webp', 'image/bmp', 'image/x-ms-bmp',
      'image/tiff', 'image/svg+xml', 'image/avif', 'image/heic',
      'image/heif', 'image/x-icon', 'image/vnd.microsoft.icon',
      'image/x-citrix-pjpeg', 'image/x-citrix-jpeg', 'image/pipeg'
    ];

    const fileExtension = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();

    // Verificar si es imagen válida
    const isValidMimeType = mimeType.startsWith('image/') || allowedMimeTypes.includes(mimeType);
    const isValidExtension = allowedExtensions.includes(fileExtension);

    console.log(`🔍 Extensión: ${fileExtension}, MIME válido: ${isValidMimeType}, Extensión válida: ${isValidExtension}`);

    if (isValidMimeType || isValidExtension) {
      console.log(`✅ Archivo aceptado: ${file.originalname}`);
      cb(null, true);
    } else {
      console.log(`❌ Archivo rechazado: ${file.originalname}`);
      cb(new Error(`Formato de imagen no soportado. Formatos permitidos: JPG, JPEG, PNG, GIF, WebP, BMP, TIFF, SVG, AVIF, HEIC`), false);
    }
  }
});

// Cliente de Object Storage
const objectStorage = new Client();

// Panel admin principal
router.get('/', (req, res) => {
  res.sendFile('admin-tokens.html', { root: 'public' });
});

// Obtener estadísticas
router.get('/stats', async (req, res) => {
  try {
    const stats = await dbPool.query(`
      SELECT
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN status = 'available' THEN 1 END) as available_tokens,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed_tokens,
        COUNT(DISTINCT owner_id) as unique_owners,
        COUNT(DISTINCT drop_name) as total_drops
      FROM tokens
    `);

    const recentClaims = await dbPool.query(`
      SELECT t.*, u.username
      FROM tokens t
      LEFT JOIN users u ON t.owner_id = u.id
      WHERE t.status = 'claimed'
      ORDER BY t.claimed_at DESC
      LIMIT 10
    `);

    res.json({
      stats: stats.rows[0],
      recentClaims: recentClaims.rows
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Obtener lista de lotes
router.get('/batches', async (req, res) => {
  let client;
  try {
    console.log('📋 Cargando lotes...');

    client = await dbPool.connect();

    const batchesResult = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.product,
        b.drop_name,
        b.variant,
        b.image_url,
        b.created_at,
        COUNT(bi.token_id) as token_count,
        COUNT(CASE WHEN t.status = 'claimed' THEN 1 END) as claimed_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.batch_id
      LEFT JOIN tokens t ON bi.token_id = t.id
      GROUP BY b.id, b.name, b.product, b.drop_name, b.variant, b.image_url, b.created_at
      ORDER BY b.created_at DESC
    `);

    console.log(`✅ Query executed successfully`);
    console.log(`📊 Found ${batchesResult.rows.length} batches in database`);

    if (batchesResult.rows.length > 0) {
      console.log('📋 First batch example:', {
        id: batchesResult.rows[0].id,
        name: batchesResult.rows[0].name,
        token_count: batchesResult.rows[0].token_count
      });
    }

    // Process image URLs for display with improved handling
    const processedBatches = batchesResult.rows.map(batch => {
      let displayImageUrl = '/api/storage/images/logo.png'; // Default fallback
      let imageStatus = 'default';
      let hasCustomImage = false;

      // Process image URL for display
      if (batch.image_url && batch.image_url.trim() && 
          batch.image_url !== 'undefined' && batch.image_url !== 'null' && batch.image_url !== '') {

          const originalUrl = batch.image_url.trim();
          hasCustomImage = true;

          if (originalUrl.startsWith('data:image/')) {
              // Base64 image - use directly
              displayImageUrl = originalUrl;
              imageStatus = 'base64';
              console.log(`📸 Base64 image for batch ${batch.id} (${originalUrl.substring(0, 50)}...)`);
          } else if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
              // External URL
              displayImageUrl = originalUrl;
              imageStatus = 'external';
              console.log(`🌐 External URL for batch ${batch.id}: ${originalUrl}`);
          } else if (originalUrl.startsWith('/images/product-images/')) {
              // Local product images
              displayImageUrl = originalUrl;
              imageStatus = 'local';
              console.log(`📁 Local product image for batch ${batch.id}: ${originalUrl}`);
          } else if (originalUrl.startsWith('/api/storage/')) {
              // Already formatted API storage path
              displayImageUrl = originalUrl;
              imageStatus = 'storage';
              console.log(`📦 Storage path for batch ${batch.id}: ${originalUrl}`);
          } else {
              // Process storage path - this handles uploaded images
              let cleanPath = originalUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');

              if (cleanPath && cleanPath.length > 0) {
                  // Check if it looks like a product image
                  const filename = cleanPath.split('/').pop();
                  
                  if (filename && (cleanPath.includes('product-') || filename.startsWith('product-') || cleanPath.startsWith('product-images/'))) {
                      // Product image handling
                      if (cleanPath.startsWith('product-images/')) {
                          displayImageUrl = `/api/storage/${cleanPath}`;
                      } else {
                          displayImageUrl = `/api/storage/product-images/${filename}`;
                      }
                      imageStatus = 'product-storage';
                      console.log(`🛍️ Product image for batch ${batch.id}: "${originalUrl}" → "${displayImageUrl}"`);
                      
                  } else if (cleanPath.startsWith('batch-images/') || !cleanPath.includes('/')) {
                      // Batch image handling
                      const finalPath = cleanPath.includes('/') ? cleanPath : `batch-images/${cleanPath}`;
                      displayImageUrl = `/api/storage/${finalPath}`;
                      imageStatus = 'batch-storage';
                      console.log(`📦 Batch image for batch ${batch.id}: "${originalUrl}" → "${displayImageUrl}"`);
                      
                  } else {
                      // Generic storage path
                      displayImageUrl = `/api/storage/${cleanPath}`;
                      imageStatus = 'generic-storage';
                      console.log(`💾 Generic storage for batch ${batch.id}: "${originalUrl}" → "${displayImageUrl}"`);
                  }
              } else {
                  console.log(`⚠️ Could not process image path for batch ${batch.id}: "${originalUrl}"`);
                  hasCustomImage = false; // Reset if we can't process it
              }
          }
      } else {
          console.log(`ℹ️ No custom image for batch ${batch.id}, using default`);
      }

      const result = {
          ...batch,
          image_url: displayImageUrl,
          image_status: imageStatus,
          original_image_url: batch.image_url,
          has_custom_image: hasCustomImage
      };

      // Debug log for troubleshooting
      if (hasCustomImage) {
          console.log(`📋 Batch ${batch.id} image processing:`, {
              original: batch.image_url?.substring(0, 100),
              processed: displayImageUrl?.substring(0, 100),
              status: imageStatus,
              hasCustom: hasCustomImage
          });
      }

      return result;
  });

    console.log(`📤 Sending ${processedBatches.length} processed batches to frontend`);
    res.json({ rows: processedBatches });

  } catch (error) {
    console.error('❌ Error cargando lotes:', error);
    res.status(500).json({ 
      error: 'Error cargando lotes',
      message: error.message
    });
  } finally {
    if (client) client.release();
  }
});

// Create new batch - main endpoint with proper file handling
router.post('/create', upload.single('image'), async (req, res) => {
  // Set JSON response headers early
  res.set('Content-Type', 'application/json');
  
  let client;
  try {
    console.log('🎯 CREATE endpoint called');
    console.log('📋 Request body:', req.body);
    console.log('📁 File received:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'No file');

    const { product, drop_name, variant, serial_from, serial_to, tokens_per_item, size, color } = req.body;

    // Validate required fields
    if (!product || !drop_name || !serial_from || !serial_to || !size || !color) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        ok: false,
        error: 'Faltan campos requeridos: product, drop_name, serial_from, serial_to, size, color' 
      });
    }

    const serialFrom = parseInt(serial_from);
    const serialTo = parseInt(serial_to);
    const tokensPerItemNum = parseInt(tokens_per_item) || 1;

    // Validate numbers
    if (isNaN(serialFrom) || isNaN(serialTo) || serialFrom > serialTo) {
      return res.status(400).json({ 
        ok: false,
        error: 'Los números de serie deben ser válidos y serial_from debe ser menor o igual a serial_to' 
      });
    }

    const itemsCount = serialTo - serialFrom + 1;
    const totalTokens = itemsCount * tokensPerItemNum;

    if (totalTokens > 10000) {
      return res.status(400).json({ 
        ok: false,
        error: 'No se pueden crear más de 10,000 tokens en un lote' 
      });
    }

    // Require image file
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere una imagen para crear el batch'
      });
    }

    console.log(`📊 Creating batch: ${itemsCount} items × ${tokensPerItemNum} tokens = ${totalTokens} total tokens`);

    client = await dbPool.connect();

    // Create batch record first to get batchId
    const batchName = `${product} - ${drop_name}${variant ? ` - ${variant}` : ''}`;
    
    console.log('💾 Creating batch record...');
    const batchResult = await client.query(
      'INSERT INTO batches (name, product, drop_name, variant, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
      [batchName, product, drop_name, variant || null]
    );

    const batchId = batchResult.rows[0].id;
    console.log('✅ Batch created with ID:', batchId);

    // Generate a sample token code for filename
    const prefix = generatePrefix(drop_name, variant);
    const sampleCode = generateTokenCode(prefix, 6);

    // Handle image upload to local filesystem
    let imageUrl = null;
    let imageFilename = null;

    try {
      // Create product-images directory if it doesn't exist
      const productImagesDir = path.join(process.cwd(), 'public', 'images', 'product-images');
      if (!fs.existsSync(productImagesDir)) {
        fs.mkdirSync(productImagesDir, { recursive: true });
        console.log('📁 Created product-images directory');
      }

      // Generate secure filename: {batchId}_{code}_{timestamp}.ext
      const timestamp = Date.now();
      const fileExtension = path.extname(req.file.originalname);
      const sanitizedCode = sampleCode.replace(/[^a-zA-Z0-9]/g, '');
      imageFilename = `${batchId}_${sanitizedCode}_${timestamp}${fileExtension}`;
      
      const imagePath = path.join(productImagesDir, imageFilename);
      
      console.log(`📁 Saving image to: ${imagePath}`);
      
      // Write file to disk
      fs.writeFileSync(imagePath, req.file.buffer);
      
      // Set relative URL for serving
      imageUrl = `/images/product-images/${imageFilename}`;
      
      console.log(`✅ Image saved successfully: ${imageUrl}`);

    } catch (uploadError) {
      console.error('❌ Error saving image:', uploadError);
      // Clean up batch if image save failed
      await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
      return res.status(500).json({
        ok: false,
        error: 'Error guardando la imagen'
      });
    }

    // Update batch with image URL
    await client.query(
      'UPDATE batches SET image_url = $1 WHERE id = $2',
      [imageUrl, batchId]
    );

    // Generate tokens
    console.log('🎟️ Generating tokens...');
    const usedCodes = new Set();
    const tokenInserts = [];

    for (let serial = serialFrom; serial <= serialTo; serial++) {
      for (let tokenIndex = 0; tokenIndex < tokensPerItemNum; tokenIndex++) {
        let tokenCode;
        let attempts = 0;

        do {
          const prefix = generatePrefix(drop_name, variant);
          tokenCode = generateTokenCode(prefix, 6);
          attempts++;

          if (attempts > 100) {
            throw new Error(`No se pudo generar código único para serial ${serial}`);
          }
        } while (usedCodes.has(tokenCode));

        usedCodes.add(tokenCode);
        tokenInserts.push([tokenCode, serial, product, drop_name, variant, size, color, imageUrl]);
      }
    }

    // Insert tokens
    console.log(`💾 Inserting ${tokenInserts.length} tokens...`);
    const batchItemInserts = [];

    for (const [code, serial, prod, dropName, var_name, sz, col, img] of tokenInserts) {
      const tokenResult = await client.query(
        'INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id',
        [code, serial, prod, dropName, var_name, sz, col, img, 'available']
      );

      const tokenId = tokenResult.rows[0].id;
      batchItemInserts.push([batchId, tokenId]);
    }

    // Create batch items
    console.log('🔗 Creating batch items...');
    for (const [bId, tId] of batchItemInserts) {
      await client.query('INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)', [bId, tId]);
    }

    console.log('✅ Batch creation completed successfully');

    // Return proper JSON response
    return res.status(201).json({
      ok: true,
      batchId,
      code: sampleCode,
      imageUrl,
      imageFilename,
      tokensCreated: tokenInserts.length,
      itemsCount,
      tokensPerItem: tokensPerItemNum,
      message: `Lote creado exitosamente con ${tokenInserts.length} tokens para ${itemsCount} artículos`
    });

  } catch (error) {
    console.error('❌ Error creating batch:', error);
    console.error('❌ Stack trace:', error.stack);
    return res.status(500).json({ 
      ok: false,
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Legacy batch creation endpoint (keep for compatibility)
router.post('/batch', upload.single('image'), async (req, res) => {
  let client;
  try {
    const { name, product, drop, variant, quantity, prefix } = req.body;

    console.log('📦 Creating new batch:', { name, product, drop, variant, quantity, prefix });
    console.log('📁 File received:', req.file ? 'Yes' : 'No');

    if (!name || !product || !drop || !quantity) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, product, drop, quantity' 
      });
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0 || qty > 10000) {
      return res.status(400).json({ 
        error: 'Quantity must be a number between 1 and 10000' 
      });
    }

    client = await pool.connect();

    // Handle image upload
    let imageUrl = null;
    let productImageUrl = null; // For product images
    if (req.file) {
      try {
        const objectStorage = new Client();
        const timestamp = Date.now();
        const imageFormat = req.file.mimetype.split('/')[1];
        const baseFilename = `${timestamp}-product.${imageFormat}`;

        const batchPath = `batch-images/${baseFilename}`;
        const productPath = `product-images/${baseFilename}`;

        console.log(`☁️ Uploading to Object Storage: ${batchPath} and ${productPath}`);
        await objectStorage.uploadFromBytes(batchPath, req.file.buffer);
        await objectStorage.uploadFromBytes(productPath, req.file.buffer);

        imageUrl = `/api/storage/${batchPath}`;
        productImageUrl = `/api/storage/${productPath}`;
        console.log('✅ Image uploaded successfully to both locations');
      } catch (uploadError) {
        console.warn('⚠️ Image upload failed, continuing without image:', uploadError.message);
      }
    } else if (req.body.image_url_hidden) {
      const image_url = req.body.image_url_hidden;

      if (image_url && image_url.trim() && image_url !== 'undefined' && image_url !== 'null') {
        try {
          if (image_url.startsWith('data:image/')) {
            // Base64 image - upload to Object Storage
            console.log('📤 Uploading base64 image to Object Storage...');

            // Extract image data and format
            const matches = image_url.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
            if (!matches) {
                throw new Error('Invalid base64 image format');
            }

            const imageFormat = matches[1].toLowerCase();
            const base64Data = matches[2];
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename
            const timestamp = Date.now();
            const baseFilename = `${timestamp}-product.${imageFormat}`;

            // Upload to both locations
            const batchPath = `batch-images/${baseFilename}`;
            const productPath = `product-images/${baseFilename}`;

            console.log(`📁 Uploading to batch storage: ${batchPath}`);
            console.log(`📁 Uploading to product storage: ${productPath}`);

            // Upload to both Object Storage locations
            await objectStorage.uploadFromBytes(batchPath, imageBuffer);
            await objectStorage.uploadFromBytes(productPath, imageBuffer);

            imageUrl = `/api/storage/${batchPath}`;
            productImageUrl = `/api/storage/${productPath}`;
            console.log(`✅ Base64 image uploaded successfully to both locations`);

          } else if (image_url.startsWith('http://') || image_url.startsWith('https://')) {
            // External URL - keep as-is
            imageUrl = image_url;
            productImageUrl = image_url;
            console.log('🌐 Using external image URL');
          } else {
            // Local path - convert to storage path
            let cleanPath = image_url.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');
            if (!cleanPath.startsWith('batch-images/')) {
              cleanPath = `batch-images/${cleanPath}`;
            }
            imageUrl = `/api/storage/${cleanPath}`;
            productImageUrl = imageUrl;
            console.log(`🔄 Converted to storage path: ${imageUrl}`);
          }
        } catch (uploadError) {
          console.warn('⚠️ Image processing failed, continuing without image:', uploadError.message);
        }
      }
    }

    // Create batch
    console.log('💾 Creating batch in database...');
    const batchResult = await client.query(
      'INSERT INTO batches (name, product, drop_name, variant, image_url, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id',
      [name, product, drop, variant || null, imageUrl]
    );

    const batchId = batchResult.rows[0].id;
    console.log('✅ Batch created with ID:', batchId);

    // Generate tokens
    console.log('🎟️ Generating tokens...');
    const usedCodes = new Set();
    const tokens = [];

    for (let i = 0; i < qty; i++) {
      let tokenCode;
      let attempts = 0;

      do {
        tokenCode = generateTokenCode(prefix || product.substring(0, 3).toUpperCase(), 6);
        attempts++;

        if (attempts > 100) {
          throw new Error('Unable to generate unique token code');
        }
      } while (usedCodes.has(tokenCode));

      usedCodes.add(tokenCode);
      tokens.push([tokenCode, batchId, product, drop, variant]);
    }

    // Insert tokens
    console.log('💾 Inserting tokens into database...');
    const tokenInsertQuery = 'INSERT INTO tokens (token_code, product, drop_name, variant, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING id';
    const batchItemInserts = [];

    for (const [code, , prod, dropName, var_name] of tokens) {
      const tokenResult = await client.query(tokenInsertQuery, [code, prod, dropName, var_name, productImageUrl]); // Use productImageUrl for tokens
      const tokenId = tokenResult.rows[0].id;
      batchItemInserts.push([batchId, tokenId]);
    }

    // Create batch items
    console.log('🔗 Creating batch items...');
    const batchItemQuery = 'INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)';
    for (const [batchId, tokenId] of batchItemInserts) {
      await client.query(batchItemQuery, [batchId, tokenId]);
    }

    console.log('✅ Batch creation completed successfully');

    res.json({
      success: true,
      batchId,
      tokensCreated: qty,
      imageUrl: productImageUrl || imageUrl, // Return productImageUrl if available, else batch imageUrl
      message: `Successfully created batch with ${qty} tokens`
    });

  } catch (error) {
    console.error('❌ Error creating batch:', error);
    res.status(500).json({ 
      error: 'Failed to create batch',
      details: error.message 
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Exportar CSV de un lote
router.get('/batch/:id/export', async (req, res) => {
  const batchId = parseInt(req.params.id);

  console.log(`📄 Exporting batch ${batchId} to CSV...`);

  try {
    // Verificar que el batch existe
    const batchCheck = await dbPool.query('SELECT * FROM batches WHERE id = $1', [batchId]);
    if (batchCheck.rows.length === 0) {
      console.log(`❌ Batch ${batchId} not found`);
      return res.status(404).json({ error: 'Batch not found' });
    }

    const batch = batchCheck.rows[0];
    console.log(`✅ Batch found: ${batch.name}`);

    const tokens = await dbPool.query(`
      SELECT t.*
      FROM tokens t
      JOIN batch_items bi ON t.id = bi.token_id
      WHERE bi.batch_id = $1
      ORDER BY t.serial
    `, [batchId]);

    console.log(`📊 Found ${tokens.rows.length} tokens in batch`);

    // Generar CSV limpio y organizado (sin comentarios para compatibilidad con Excel)
    let csv = '';
    
    // Headers reorganizados - orden más lógico y fácil de leer
    const headers = [
      '#',           // Contador visual
      'SERIAL',      // Número de serie del producto
      'TOKEN CODE',  // Código único del token
      'STATUS',      // Estado (available/claimed)
      'PRODUCT',     // Nombre del producto
      'VARIANT',     // Variante
      'SIZE',        // Talla
      'COLOR',       // Color
      'DROP NAME',   // Nombre del drop
      'IMAGE URL'    // URL de la imagen
    ];

    csv += headers.join(',') + '\n';

    if (tokens.rows.length === 0) {
      console.log('⚠️ Batch is empty, creating CSV with headers only');
    } else {
      let counter = 1;
      for (const token of tokens.rows) {
        const row = [
          counter++,                            // Contador
          token.serial,                         // Serial
          `"${token.token_code}"`,              // Token code
          token.status.toUpperCase(),           // Status
          `"${token.product}"`,                 // Product
          `"${token.variant || '-'}"`,          // Variant
          `"${token.size || '-'}"`,             // Size
          `"${token.color || '-'}"`,            // Color
          `"${token.drop_name}"`,               // Drop name
          `"${token.image_url || '-'}"`         // Image URL
        ];
        csv += row.join(',') + '\n';
      }
    }

    // Crear nombre de archivo descriptivo con información del batch
    const batchName = batch.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${batchName}_${tokens.rows.length}tokens_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

    console.log(`✅ CSV exported successfully: ${filename}`);

  } catch (error) {
    console.error('❌ Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV', details: error.message });
  }
});

// Endpoint para subir imagen de producto
router.post('/upload-product-image', upload.single('image'), async (req, res) => {
  console.log('📸 Iniciando subida de imagen de producto...');

  try {
    if (!req.file) {
      console.log('❌ No se proporcionó archivo de imagen');
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log(`📁 Archivo recibido: ${req.file.originalname}`);
    console.log(`📏 Tamaño: ${req.file.buffer.length} bytes`);
    console.log(`🎨 Tipo MIME: ${req.file.mimetype}`);

    // Validar tipo de archivo
    if (!req.file.mimetype.startsWith('image/')) {
      console.log('❌ Tipo de archivo no válido');
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    // Validar tamaño (máximo 50MB)
    if (req.file.size > 50 * 1024 * 1024) {
      console.log('❌ Archivo muy grande');
      return res.status(400).json({ error: 'Image must be smaller than 50MB' });
    }

    // Generar nombre único para el archivo
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const fileExtension = path.extname(req.file.originalname);
    const fileName = `products/product-${timestamp}-${randomString}${fileExtension}`;

    console.log(`💾 Guardando archivo como: ${fileName}`);

    // ALWAYS try Object Storage first
    try {
      await objectStorage.uploadFromBytes(fileName, req.file.buffer);
      console.log(`✅ Imagen subida exitosamente a Object Storage: ${fileName}`);

      const imageUrl = `/api/storage/${fileName}`;

      return res.json({
        success: true,
        imageUrl: imageUrl,
        fileName: fileName,
        message: 'Image uploaded successfully to Object Storage'
      });

    } catch (uploadError) {
      console.error('❌ Object Storage failed, trying local fallback:', uploadError);

      // Local fallback
      try {
        const localDir = path.join(process.cwd(), 'public', 'images', 'products');
        if (!fs.existsSync(localDir)) {
          fs.mkdirSync(localDir, { recursive: true });
        }

        const localFileName = path.basename(fileName);
        const localPath = path.join(localDir, localFileName);
        fs.writeFileSync(localPath, req.file.buffer);

        console.log(`💾 Saved locally as fallback: ${localPath}`);

        return res.json({
          success: true,
          imageUrl: `/images/products/${localFileName}`,
          fileName: localFileName,
          message: 'Image uploaded locally (fallback)',
          fallback: true
        });

      } catch (localError) {
        console.error('❌ Local fallback also failed:', localError);

        // As a last resort, save as base64
        const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        return res.json({
          success: true,
          imageUrl: base64,
          fileName: 'base64-image',
          message: 'Image saved as base64 (emergency fallback)',
          fallback: true
        });
      }
    }

  } catch (error) {
    console.error('❌ Error general subiendo imagen:', error);
    console.error('❌ Stack trace:', error.stack);

    return res.status(500).json({
      error: 'Failed to upload image',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Eliminar lote
router.delete('/batch/:id', async (req, res) => {
  const batchId = parseInt(req.params.id);

  console.log(`🗑️ DELETE request received for batch ${batchId}`);

  if (isNaN(batchId)) {
    console.error('❌ Invalid batch ID provided');
    return res.status(400).json({ error: 'Invalid batch ID' });
  }

  try {
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');
      console.log(`🔄 Transaction started for deleting batch ${batchId}`);

      // Verificar que el lote existe
      const batchCheck = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
      if (batchCheck.rows.length === 0) {
        console.log(`❌ Batch ${batchId} not found`);
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Lote no encontrado' });
      }

      const batch = batchCheck.rows[0];
      console.log(`📋 Found batch: ${batch.name}`);

      // Obtener tokens del lote
      const tokensResult = await client.query(`
        SELECT t.id, t.status
        FROM tokens t
        JOIN batch_items bi ON t.id = bi.token_id
        WHERE bi.batch_id = $1
      `, [batchId]);

      console.log(`📊 Found ${tokensResult.rows.length} tokens in batch`);

      // Verificar si algún token ya fue reclamado
      const claimedTokens = tokensResult.rows.filter(token => token.status === 'claimed');
      if (claimedTokens.length > 0) {
        console.log(`⚠️ Warning: Batch has ${claimedTokens.length} claimed tokens, but proceeding with deletion as requested`);
        // Permitir eliminación pero con advertencia en logs
      }

      // Eliminar relaciones batch_items
      const deleteItemsResult = await client.query('DELETE FROM batch_items WHERE batch_id = $1', [batchId]);
      console.log(`🗑️ Deleted ${deleteItemsResult.rowCount} batch_items`);

      // Eliminar tokens
      const tokenIds = tokensResult.rows.map(token => token.id);
      if (tokenIds.length > 0) {
        const deleteTokensResult = await client.query(`DELETE FROM tokens WHERE id = ANY($1)`, [tokenIds]);
        console.log(`🗑️ Deleted ${deleteTokensResult.rowCount} tokens`);
      }

      // Eliminar el lote
      const deleteBatchResult = await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
      console.log(`🗑️ Deleted ${deleteBatchResult.rowCount} batch`);

      await client.query('COMMIT');
      client.release();

      console.log(`✅ Successfully deleted batch ${batchId} and ${tokenIds.length} tokens`);
      res.json({
        ok: true,
        success: true,
        message: `Lote eliminado exitosamente. Se eliminaron ${tokenIds.length} tokens.`
      });

    } catch (transactionError) {
      console.error(`❌ Transaction error deleting batch ${batchId}:`, transactionError);
      await client.query('ROLLBACK');
      client.release();
      throw transactionError;
    }

  } catch (error) {
    console.error(`❌ Error deleting batch ${batchId}:`, error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      error: 'Error interno del servidor al eliminar el lote',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Edit batch
router.put('/batch/:id', upload.single('image'), async (req, res) => {
  let client;
  try {
    const batchId = parseInt(req.params.id);
    const { name, product, drop, variant } = req.body;

    console.log('✏️ Editing batch:', batchId, { name, product, drop, variant });
    console.log('📁 File received for update:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'No new file');

    if (!product || !drop) {
      return res.status(400).json({ 
        ok: false,
        success: false,
        error: 'Missing required fields: product, drop_name' 
      });
    }

    client = await dbPool.connect();

    // Check if batch exists
    const batchCheck = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
    if (batchCheck.rows.length === 0) {
      return res.status(404).json({ 
        ok: false,
        success: false,
        error: 'Batch not found' 
      });
    }

    const currentBatch = batchCheck.rows[0];
    let imageUrl = currentBatch.image_url; // Preserve existing image
    let productImageUrl = currentBatch.image_url; // Assume product image is same as batch image initially

    console.log('📸 Current batch image URL:', imageUrl);

    // Handle new image upload
    if (req.file) {
      try {
        const objectStorage = new Client();
        const timestamp = Date.now();
        const imageFormat = req.file.mimetype.split('/')[1];
        const baseFilename = `${timestamp}-product.${imageFormat}`;

        const batchPath = `batch-images/${baseFilename}`;
        const productPath = `product-images/${baseFilename}`;

        console.log(`☁️ Uploading new image to Object Storage: ${batchPath} and ${productPath}`);
        await objectStorage.uploadFromBytes(batchPath, req.file.buffer);
        await objectStorage.uploadFromBytes(productPath, req.file.buffer);

        imageUrl = `/api/storage/${batchPath}`;
        productImageUrl = `/api/storage/${productPath}`;
        console.log('✅ New image uploaded successfully to both locations');
      } catch (uploadError) {
        console.warn('⚠️ Image upload failed, using base64 fallback:', uploadError.message);
        imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        productImageUrl = imageUrl; // Fallback for product image too
      }
    } else if (req.body.image_url_hidden) { // Handle case where image_url is sent as base64 string in body
        const image_url = req.body.image_url_hidden;

        if (image_url && image_url.trim() && image_url !== 'undefined' && image_url !== 'null') {
            const originalImageUrl = image_url.trim();

            try {
                if (originalImageUrl.startsWith('data:image/')) {
                    // Base64 image - upload to Object Storage
                    console.log('📤 Uploading base64 image to Object Storage...');

                    // Extract image data and format
                    const matches = originalImageUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
                    if (!matches) {
                        throw new Error('Invalid base64 image format');
                    }

                    const imageFormat = matches[1].toLowerCase();
                    const base64Data = matches[2];
                    const imageBuffer = Buffer.from(base64Data, 'base64');

                    // Generate unique filename
                    const timestamp = Date.now();
                    const baseFilename = `${timestamp}-product.${imageFormat}`;

                    // Upload to both locations
                    const batchPath = `batch-images/${baseFilename}`;
                    const productPath = `product-images/${baseFilename}`;

                    console.log(`📁 Uploading to batch storage: ${batchPath}`);
                    console.log(`📁 Uploading to product storage: ${productPath}`);

                    // Upload to both Object Storage locations
                    await objectStorage.uploadFromBytes(batchPath, imageBuffer);
                    await objectStorage.uploadFromBytes(productPath, imageBuffer);

                    imageUrl = `/api/storage/${batchPath}`;
                    productImageUrl = `/api/storage/${productPath}`;
                    console.log(`✅ Base64 image uploaded successfully to both locations`);

                } else if (originalImageUrl.startsWith('http://') || originalImageUrl.startsWith('https://')) {
                    // External URL - keep as-is
                    imageUrl = originalImageUrl;
                    productImageUrl = originalImageUrl;
                    console.log('🌐 Using external image URL');

                } else if (originalImageUrl.startsWith('/api/storage/')) {
                    // Already a storage path - keep as-is
                    imageUrl = originalImageUrl;
                    productImageUrl = originalImageUrl;
                    console.log('📦 Using existing storage path');

                } else {
                    // Local path - convert to storage path
                    let cleanPath = originalImageUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');
                    if (!cleanPath.startsWith('batch-images/')) {
                        cleanPath = `batch-images/${cleanPath}`;
                    }
                    imageUrl = `/api/storage/${cleanPath}`;
                    productImageUrl = imageUrl;
                    console.log(`🔄 Converted to storage path: ${imageUrl}`);
                }

            } catch (uploadError) {
                console.error('❌ Error processing image:', uploadError);
                imageUrl = null;
                productImageUrl = null;
                // Don't show message here, will be handled by client
            }
        }
    }


    // Create updated name
    const updatedName = name || `${product} - ${drop}${variant ? ` - ${variant}` : ''}`;

    // Update batch
    await client.query(
      'UPDATE batches SET name = $1, product = $2, drop_name = $3, variant = $4, image_url = $5 WHERE id = $6',
      [updatedName, product, drop, variant || null, imageUrl, batchId]
    );

    // Update related tokens
    await client.query(
      'UPDATE tokens SET product = $1, drop_name = $2, variant = $3, image_url = $4 WHERE id IN (SELECT token_id FROM batch_items WHERE batch_id = $5)',
      [product, drop, variant || null, productImageUrl, batchId] // Use productImageUrl for tokens
    );

    console.log('✅ Batch updated successfully');

    res.json({
      ok: true,
      success: true,
      message: 'Lote actualizado exitosamente',
      imageUrl: productImageUrl || imageUrl // Return productImageUrl if available, else batch imageUrl
    });

  } catch (error) {
    console.error('❌ Error editing batch:', error);
    res.status(500).json({ 
      ok: false,
      success: false,
      error: 'Error interno del servidor al actualizar el lote',
      details: error.message 
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// GET - Query product by code endpoint
router.get('/products/:code', async (req, res) => {
  res.set('Content-Type', 'application/json');
  
  let client;
  try {
    const { code } = req.params;
    console.log(`🔍 Searching for product with code: ${code}`);

    client = await dbPool.connect();

    const result = await client.query(`
      SELECT 
        t.*,
        b.name as batch_name
      FROM tokens t
      LEFT JOIN batch_items bi ON t.id = bi.token_id
      LEFT JOIN batches b ON bi.batch_id = b.id
      WHERE t.token_code = $1
    `, [code]);

    if (result.rows.length === 0) {
      console.log(`❌ Product with code ${code} not found`);
      return res.status(404).json({ 
        ok: false,
        error: 'NOT_FOUND' 
      });
    }

    const token = result.rows[0];
    console.log(`✅ Found product: ${token.product} - ${token.drop_name}`);

    return res.json({
      ok: true,
      code: token.token_code,
      product: token.product,
      drop_name: token.drop_name,
      variant: token.variant,
      size: token.size,
      color: token.color,
      serial: token.serial,
      imageUrl: token.image_url,
      status: token.status,
      batch_name: token.batch_name,
      created_at: token.created_at
    });

  } catch (error) {
    console.error('❌ Error searching product by code:', error);
    return res.status(500).json({ 
      ok: false,
      error: 'Error interno del servidor'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// GET - Obtener lote específico para editar
router.get('/batch/:id', async (req, res) => {
  let client;

  try {
    const { id } = req.params;
    console.log(`🔍 Getting batch for edit: ID ${id}`);

    client = await dbPool.connect();

    const result = await client.query(`
      SELECT 
        b.*,
        COUNT(bi.token_id) as token_count,
        COUNT(CASE WHEN t.status = 'claimed' THEN 1 END) as claimed_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.token_id
      LEFT JOIN tokens t ON bi.token_id = t.id
      WHERE b.id = $1
      GROUP BY b.id, b.name, b.product, b.drop_name, b.variant, b.image_url, b.created_at
    `, [id]);

    if (result.rows.length === 0) {
      console.log(`❌ Batch ${id} not found in database`);
      return res.status(404).json({ error: 'Lote no encontrado' });
    }

    const batch = result.rows[0];
    console.log(`✅ Found batch: ${batch.name || batch.product + ' - ' + batch.drop_name}`);
    console.log(`🖼️ Raw image URL from DB: ${batch.image_url}`);

    // Process image URL for frontend - keep original logic but improve it
    let processedImageUrl = null;
    let imageStatus = 'default';
    let hasCustomImage = false;

    if (batch.image_url && typeof batch.image_url === 'string' && batch.image_url.trim() !== '' && batch.image_url !== 'undefined' && batch.image_url !== 'null') {
      const originalUrl = batch.image_url.trim();

      if (originalUrl.startsWith('data:image/')) {
        // Base64 image - keep as is
        processedImageUrl = originalUrl;
        imageStatus = 'base64';
        hasCustomImage = true;
        console.log(`✅ Using Base64 image (${originalUrl.substring(0, 50)}...)`);
      } else if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
        // External URL - keep as is
        processedImageUrl = originalUrl;
        imageStatus = 'external';
        hasCustomImage = true;
        console.log(`✅ Using external URL: ${originalUrl}`);
      } else if (originalUrl.startsWith('/images/product-images/')) {
        // Local product-images path
        processedImageUrl = originalUrl;
        imageStatus = 'local';
        hasCustomImage = true;
        console.log(`📁 Local product image for batch ${batch.id}: ${originalUrl}`);
      } else if (originalUrl.startsWith('/api/storage/')) {
        // Already formatted for API
        processedImageUrl = originalUrl;
        imageStatus = 'storage';
        hasCustomImage = true;
        console.log(`✅ Using existing API path: ${originalUrl}`);
      } else {
        // Handle other cases - assume it's a storage path or a product image
        const filename = originalUrl.split('/').pop();
        if (filename && (originalUrl.includes('product-') || originalUrl.startsWith('product-'))) {
          // It's a product image, use local path
          processedImageUrl = `/images/product-images/${filename}`;
          imageStatus = 'local';
          console.log(`🔄 Converted to local product image for batch ${batch.id}: "${processedImageUrl}"`);
        } else {
          // Try as storage path
          let cleanPath = originalUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');
          if (cleanPath && cleanPath.length > 0) {
            if (!cleanPath.includes('/')) {
              cleanPath = `batch-images/${cleanPath}`;
            }
            processedImageUrl = `/api/storage/${cleanPath}`;
            imageStatus = 'storage';
            console.log(`🔄 Converted to storage path for batch ${batch.id}: "${processedImageUrl}"`);
          }
        }
      }
    }

    // If no valid image, use default
    if (!processedImageUrl) {
      processedImageUrl = '/api/storage/images/logo.png';
      imageStatus = 'default';
      console.log(`🔄 Using default logo`);
    }

    const responseData = {
      id: batch.id,
      name: batch.name,
      product: batch.product,
      drop_name: batch.drop_name,
      variant: batch.variant,
      image_url: processedImageUrl,
      image_status: imageStatus,
      created_at: batch.created_at,
      token_count: parseInt(batch.token_count) || 0,
      claimed_count: parseInt(batch.claimed_count) || 0,
      original_image_url: batch.image_url // Include original for reference if needed
    };

    console.log('\nSending batch data for editing:', {
      id: responseData.id,
      name: responseData.name,
      product: responseData.product,
      drop_name: responseData.drop_name,
      variant: responseData.variant,
      image_url: responseData.image_url,
      image_status: responseData.image_status,
      token_count: responseData.token_count
    });

    res.json(responseData);

  } catch (error) {
    console.error('❌ Error getting batch for edit:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

export default router;