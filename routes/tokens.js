import express from 'express';
import pool from '../database/connection.js';
import { requireAuth, getUserById } from '../middleware/auth.js';

const router = express.Router();

// Página de colección personal del usuario
router.get('/me/tokens', requireAuth, (req, res) => {
  res.sendFile('my-tokens.html', { root: 'public' });
});

// API: Obtener tokens del usuario autenticado
router.get('/api/me/tokens', requireAuth, async (req, res) => {
  const userId = req.session.user?.id || req.session.userId;

  console.log(`🔍 Fetching tokens for user ID: ${userId}`);

  try {
    const tokens = await pool.query(`
      SELECT * FROM tokens 
      WHERE owner_id = $1 
      ORDER BY claimed_at DESC
    `, [userId]);

    console.log(`✅ Found ${tokens.rows.length} tokens for user ${userId}`);

    // Fix image URLs
    const tokensWithFixedImages = tokens.rows.map(token => {
      let imageUrl = token.image_url;

      console.log(`🔍 Processing token ${token.token_code} with image: ${imageUrl}`);

      if (imageUrl) {
        // If it's already a complete URL, use it
        if (imageUrl.startsWith('http') || imageUrl.startsWith('data:')) {
          // Keep as is
        } 
        // If it starts with /api/storage/, keep as is
        else if (imageUrl.startsWith('/api/storage/')) {
          // Keep as is
        }
        // If it's just a filename or path, add the storage prefix
        else {
          // Clean the path first
          let cleanPath = imageUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');
          imageUrl = `/api/storage/${cleanPath}`;
        }
      } else {
        // Default fallback image
        imageUrl = '/api/storage/images/logo.png';
      }

      console.log(`✅ Final image URL for token ${token.token_code}: ${imageUrl}`);

      return {
        ...token,
        image_url: imageUrl
      };
    });

    res.json(tokensWithFixedImages);
  } catch (error) {
    console.error('Error fetching user tokens:', error);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

// Ficha pública de un token específico
router.get('/p/:code', async (req, res) => {
  res.sendFile('token-public.html', { root: 'public' });
});

// API: Obtener información pública de un token
router.get('/api/tokens/:code', async (req, res) => {
  const tokenCode = req.params.code.toUpperCase();

  try {
    const tokenResult = await pool.query(
      'SELECT * FROM tokens WHERE token_code = $1',
      [tokenCode]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const token = tokenResult.rows[0];

    // Información pública (sin datos sensibles)
    const publicToken = {
      code: token.token_code,
      serial: token.serial,
      product: token.product,
      drop_name: token.drop_name,
      variant: token.variant,
      size: token.size,
      color: token.color,
      image_url: token.image_url,
      status: token.status,
      claimed_at: token.claimed_at
    };

    // Si está reclamado, incluir info básica del owner
    if (token.status === 'claimed' && token.owner_id) {
      try {
        const owner = await getUserById(token.owner_id);
        if (owner) {
          publicToken.owner = {
            username: owner.username || 'Anonymous'
          };
        }
      } catch (ownerError) {
        console.error('Error fetching owner info:', ownerError);
      }
    }

    // Process image URL for display (handle various formats)
      let displayImageUrl = '/api/storage/images/logo.png'; // Default fallback

      if (token.image_url && token.image_url.trim() !== '' && token.image_url !== 'undefined' && token.image_url !== 'null') {
        const imageUrl = token.image_url.trim();

        if (imageUrl.startsWith('data:image/')) {
          // Base64 image
          displayImageUrl = imageUrl;
          console.log(`📱 Using base64 image for token ${tokenCode}`);
        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          // External URL
          displayImageUrl = imageUrl;
          console.log(`🌐 Using external URL for token ${tokenCode}`);
        } else if (imageUrl.startsWith('/api/storage/')) {
          // Already formatted for API
          displayImageUrl = imageUrl;
          console.log(`📦 Using API storage URL for token ${tokenCode}`);
        } else if (imageUrl.startsWith('/images/')) {
          // Local images path
          displayImageUrl = imageUrl;
          console.log(`📁 Using local image path for token ${tokenCode}`);
        } else {
          // Assume it's a storage path that needs processing
          let cleanPath = imageUrl.replace(/^\/+/, '');
          cleanPath = cleanPath.replace(/^(api\/storage\/|storage\/)/, '');

          if (cleanPath && cleanPath.length > 0) {
            // If it doesn't have a folder structure, assume it's in batch-images
            if (!cleanPath.includes('/')) {
              cleanPath = `batch-images/${cleanPath}`;
            }
            displayImageUrl = `/api/storage/${cleanPath}`;
            console.log(`🔄 Processed storage path for token ${tokenCode}: "${imageUrl}" → "${displayImageUrl}"`);
          }
        }
      } else {
        console.log(`ℹ️ No custom image for token ${tokenCode}, using default logo`);
      }

      publicToken.image_url = displayImageUrl;


    res.json(publicToken);

  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

// Obtener token público
router.get('/token/:tokenCode', async (req, res) => {
  const { tokenCode } = req.params;

  try {
    const tokenResult = await pool.query(
      'SELECT * FROM tokens WHERE token_code = $1',
      [tokenCode]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const token = tokenResult.rows[0];

    // Asegurar que la imagen_url esté completa
    let imageUrl = token.image_url;
    if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('/api/storage/') && !imageUrl.startsWith('data:')) {
      imageUrl = `/api/storage/${imageUrl}`;
    }

    res.json({
      token_code: token.token_code,
      serial: token.serial,
      product: token.product,
      drop_name: token.drop_name,
      variant: token.variant,
      size: token.size,
      color: token.color,
      image_url: imageUrl,
      status: token.status,
      owner_id: token.owner_id,
      claimed_at: token.claimed_at
    });

  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

// No duplicate route needed here - handled above

export default router;