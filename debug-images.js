
import pool from './database/connection.js';

async function debugTokenImages() {
  console.log('🔍 Debugging token images...\n');

  try {
    // Obtener todos los tokens con imágenes
    const result = await pool.query(`
      SELECT id, token_code, product, drop_name, image_url, status
      FROM tokens 
      WHERE image_url IS NOT NULL
      ORDER BY id DESC
      LIMIT 20
    `);

    console.log(`Found ${result.rows.length} tokens with images:\n`);

    for (const token of result.rows) {
      console.log(`Token: ${token.token_code}`);
      console.log(`  Product: ${token.product} - ${token.drop_name}`);
      console.log(`  Image URL: ${token.image_url}`);
      console.log(`  Status: ${token.status}`);
      
      // Verificar tipo de URL
      if (token.image_url.startsWith('data:')) {
        console.log(`  ✅ Base64 embedded image`);
      } else if (token.image_url.startsWith('/api/storage/')) {
        console.log(`  ✅ Object Storage path`);
      } else if (token.image_url.startsWith('http')) {
        console.log(`  ✅ External URL`);
      } else {
        console.log(`  ⚠️  Relative path - needs fixing`);
      }
      console.log('');
    }

    // Estadísticas
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(image_url) as tokens_with_images,
        COUNT(CASE WHEN image_url LIKE 'data:%' THEN 1 END) as base64_images,
        COUNT(CASE WHEN image_url LIKE '/api/storage/%' THEN 1 END) as storage_images,
        COUNT(CASE WHEN image_url LIKE 'http%' THEN 1 END) as external_images
      FROM tokens
    `);

    console.log('📊 Image Statistics:');
    console.log(`  Total tokens: ${stats.rows[0].total_tokens}`);
    console.log(`  Tokens with images: ${stats.rows[0].tokens_with_images}`);
    console.log(`  Base64 images: ${stats.rows[0].base64_images}`);
    console.log(`  Storage images: ${stats.rows[0].storage_images}`);
    console.log(`  External images: ${stats.rows[0].external_images}`);

  } catch (error) {
    console.error('❌ Error debugging images:', error);
  }

  process.exit(0);
}

debugTokenImages();
