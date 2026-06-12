
import express from 'express';
const router = express.Router();

// Test endpoint for debugging event extraction with enhanced safety
router.post('/test', async (req, res) => {
  try {
    console.log('🧪 Test extraction endpoint called');
    console.log('📤 Request body:', JSON.stringify(req.body, null, 2));

    const { url } = req.body;

    // Enhanced input validation
    if (!req.body) {
      return res.json({
        success: false,
        error: 'No se recibió información en la solicitud',
        timestamp: new Date().toISOString()
      });
    }

    if (!url || typeof url !== 'string' || url.trim() === '') {
      return res.json({
        success: false,
        error: 'URL es requerida - por favor proporciona un enlace válido',
        receivedData: req.body,
        timestamp: new Date().toISOString()
      });
    }

    const cleanUrl = url.trim();

    // Enhanced URL validation - be more flexible
    let finalUrl = cleanUrl;
    let urlObj;

    // Add protocol if missing
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      finalUrl = 'https://' + cleanUrl;
      console.log('🔧 Added HTTPS protocol to URL:', finalUrl);
    }

    try {
      urlObj = new URL(finalUrl);
      console.log('✅ URL validation passed for test:', urlObj.hostname);
    } catch (urlError) {
      return res.json({
        success: false,
        error: 'Formato de URL inválido - verifica que sea una URL válida de evento',
        providedUrl: cleanUrl,
        processedUrl: finalUrl,
        timestamp: new Date().toISOString()
      });
    }

    // Import fetch safely
    let fetch;
    try {
      const fetchModule = await import('node-fetch');
      fetch = fetchModule.default;
    } catch (importError) {
      return res.json({
        success: false,
        error: 'Error interno: No se pudo cargar el módulo de red',
        timestamp: new Date().toISOString()
      });
    }

    // Step 1: Test URL accessibility
    console.log('📡 Step 1: Testing URL accessibility...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let testResponse;
    try {
      testResponse = await fetch(finalUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (testError) {
      clearTimeout(timeoutId);
      return res.json({
        success: false,
        error: `Error de conectividad: ${testError.message}`,
        step: 'accessibility_check',
        timestamp: new Date().toISOString()
      });
    }

    console.log('Response status:', testResponse.status);

    if (!testResponse.ok) {
      return res.json({
        success: false,
        error: `URL no accesible: ${testResponse.status} ${testResponse.statusText}`,
        step: 'accessibility_check',
        responseStatus: testResponse.status,
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Get full content
    console.log('📄 Step 2: Fetching full content...');
    
    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => controller2.abort(), 15000);

    let contentResponse, html;
    try {
      contentResponse = await fetch(finalUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1'
        },
        signal: controller2.signal
      });

      html = await contentResponse.text();
      clearTimeout(timeoutId2);
      console.log('HTML length:', html.length);
    } catch (contentError) {
      clearTimeout(timeoutId2);
      return res.json({
        success: false,
        error: `Error obteniendo contenido: ${contentError.message}`,
        step: 'content_fetch',
        timestamp: new Date().toISOString()
      });
    }

    // Step 3: Enhanced meta tag extraction using same logic as main endpoint
    console.log('🔍 Step 3: Extracting meta tags with enhanced patterns...');

    // Function to safely extract with multiple patterns
    const safeExtractMultiple = (html, patterns, name) => {
      for (const pattern of patterns) {
        try {
          const match = html.match(pattern);
          if (match && match[1] && match[1].trim()) {
            console.log(`✅ Found ${name} with pattern in test`);
            return match[1].trim();
          }
        } catch (error) {
          console.warn(`⚠️ Pattern error for ${name} in test:`, error.message);
        }
      }
      return null;
    };

    // Enhanced extraction patterns
    const ogImagePatterns = [
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i
    ];

    const twitterImagePatterns = [
      /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
      /<meta[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/i
    ];

    const titlePatterns = [
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i
    ];

    const descPatterns = [
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
    ];

    // Extract with enhanced patterns
    const metaExtractions = {
      ogImage: [safeExtractMultiple(html, ogImagePatterns, 'OG Image')].filter(Boolean),
      twitterImage: [safeExtractMultiple(html, twitterImagePatterns, 'Twitter Image')].filter(Boolean),
      title: [safeExtractMultiple(html, titlePatterns, 'Title')].filter(Boolean),
      description: [safeExtractMultiple(html, descPatterns, 'Description')].filter(Boolean)
    };

    // Get the best image URL
    let imageUrl = metaExtractions.ogImage[0] || metaExtractions.twitterImage[0];

    // If no meta tags found, try IMG tags like main endpoint
    if (!imageUrl) {
      console.log('🔍 No meta tags found, trying IMG tags...');
      const imgMatches = [...html.matchAll(/<img[^>]+>/gi)];
      
      for (const imgMatch of imgMatches) {
        const imgTag = imgMatch[0];
        const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
        
        if (srcMatch && srcMatch[1]) {
          const imgSrc = srcMatch[1].trim();
          
          if (imgSrc.match(/\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i)) {
            const imgUrl = imgSrc.toLowerCase();
            const eventKeywords = ['event', 'banner', 'hero', 'main', 'cover', 'featured'];
            const hasEventKeyword = eventKeywords.some(keyword => imgUrl.includes(keyword));
            
            if (hasEventKeyword) {
              imageUrl = imgSrc;
              console.log('✅ Found image via IMG tag with event keyword');
              break;
            }
          }
        }
      }
    }

    console.log('Extracted meta tags:', metaExtractions);
    console.log('Best image URL:', imageUrl);

    const result = {
      success: !!imageUrl,
      url: finalUrl,
      imageUrl: imageUrl || null,
      metaTags: {
        ogImage: metaExtractions.ogImage[0] || null,
        twitterImage: metaExtractions.twitterImage[0] || null,
        title: metaExtractions.title[0] || null,
        description: metaExtractions.description[0] || null
      },
      debug: {
        contentLength: html.length,
        responseStatus: contentResponse.status,
        contentType: contentResponse.headers.get('content-type'),
        hasOgTags: html.includes('og:image'),
        hasTwitterTags: html.includes('twitter:image')
      },
      htmlPreview: html.substring(0, 300),
      timestamp: new Date().toISOString()
    };

    if (!imageUrl) {
      result.error = 'No se encontró imagen en los meta tags del evento';
    }

    res.json(result);

  } catch (error) {
    console.error('❌ Test extraction error:', error);
    
    // Safe error response to prevent segfaults
    const errorResponse = {
      success: false,
      error: 'Error interno en la prueba de extracción',
      errorType: error.name || 'UnknownError',
      timestamp: new Date().toISOString()
    };

    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.message;
    }

    res.status(500).json(errorResponse);
  }
});

export default router;
