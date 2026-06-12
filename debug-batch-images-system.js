
import pool from './database/connection.js';
import fetch from 'node-fetch';

async function debugBatchImageSystem() {
  console.log('🔍 DIAGNÓSTICO DEL SISTEMA DE IMÁGENES DE BATCHES');
  console.log('='.repeat(60));

  let client;
  try {
    client = await pool.connect();

    // 1. Check all batches with images
    console.log('\n1️⃣ VERIFICANDO BATCHES CON IMÁGENES...');
    const batchesWithImages = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.product,
        b.drop_name,
        b.variant,
        b.image_url,
        b.created_at,
        COUNT(bi.token_id) as token_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.batch_id
      WHERE b.image_url IS NOT NULL AND b.image_url != ''
      GROUP BY b.id, b.name, b.product, b.drop_name, b.variant, b.image_url, b.created_at
      ORDER BY b.created_at DESC
    `);

    console.log(`📊 Found ${batchesWithImages.rows.length} batches with images:`);
    
    for (const batch of batchesWithImages.rows) {
      console.log(`\n📦 Batch ${batch.id}: ${batch.name}`);
      console.log(`   🖼️ Image URL: ${batch.image_url}`);
      console.log(`   📅 Created: ${batch.created_at}`);
      console.log(`   🎫 Tokens: ${batch.token_count}`);

      // Test the image URL
      if (batch.image_url) {
        if (batch.image_url.startsWith('data:image/')) {
          console.log(`   ✅ Base64 image (${batch.image_url.length} characters)`);
        } else if (batch.image_url.startsWith('http')) {
          console.log(`   🌐 External URL`);
          try {
            const response = await fetch(batch.image_url, { method: 'HEAD' });
            console.log(`   📡 URL test: ${response.status} ${response.statusText}`);
          } catch (error) {
            console.log(`   ❌ URL test failed: ${error.message}`);
          }
        } else {
          // Test storage path
          let testUrl = batch.image_url;
          if (!testUrl.startsWith('/api/storage/')) {
            const cleanPath = testUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');
            if (cleanPath.includes('batch-images/') || !cleanPath.includes('/')) {
              testUrl = `/api/storage/${cleanPath.includes('batch-images/') ? cleanPath : `batch-images/${cleanPath}`}`;
            } else {
              testUrl = `/api/storage/${cleanPath}`;
            }
          }
          
          console.log(`   🔄 Testing storage URL: ${testUrl}`);
          try {
            const response = await fetch(`http://localhost:5000${testUrl}`, { method: 'HEAD' });
            console.log(`   📡 Storage test: ${response.status} ${response.statusText}`);
            if (response.ok) {
              console.log(`   ✅ Image accessible via storage API`);
            } else {
              console.log(`   ⚠️ Image not accessible via storage API`);
            }
          } catch (error) {
            console.log(`   ❌ Storage test failed: ${error.message}`);
          }
        }
      }
    }

    // 2. Test products API processing
    console.log('\n2️⃣ PROBANDO PROCESAMIENTO DE PRODUCTS API...');
    try {
      const response = await fetch('http://localhost:5000/api/products');
      if (response.ok) {
        const products = await response.json();
        const batchProducts = products.filter(p => p.source === 'batch');
        
        console.log(`📦 Found ${batchProducts.length} batch products in API`);
        
        batchProducts.forEach(product => {
          console.log(`\n🛍️ Product: ${product.name}`);
          console.log(`   🆔 Batch ID: ${product.batchId}`);
          console.log(`   🖼️ Processed Image: ${product.image}`);
          console.log(`   📊 Debug Info:`, product.debugInfo);
          
          if (product.originalImageUrl) {
            console.log(`   📝 Original Image: ${product.originalImageUrl}`);
          }
        });
      } else {
        console.log(`❌ Products API failed: ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ Products API test failed: ${error.message}`);
    }

    // 3. Test specific image endpoints
    console.log('\n3️⃣ PROBANDO ENDPOINTS DE IMÁGENES...');
    
    const testPaths = [
      '/api/storage/images/logo.png',
      '/api/storage/batch-images/test.jpg',
      '/images/logo.png'
    ];

    for (const testPath of testPaths) {
      try {
        const response = await fetch(`http://localhost:5000${testPath}`, { method: 'HEAD' });
        console.log(`📡 ${testPath}: ${response.status} ${response.statusText}`);
      } catch (error) {
        console.log(`❌ ${testPath}: ${error.message}`);
      }
    }

    console.log('\n✅ Diagnóstico completado');
    console.log('\n💡 RECOMENDACIONES:');
    console.log('1. Verificar que las imágenes se suban correctamente al Object Storage');
    console.log('2. Asegurar que las URLs se procesen con el prefijo /api/storage/batch-images/');
    console.log('3. Confirmar que el endpoint /api/storage/* esté funcionando');

  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  debugBatchImageSystem().then(() => {
    console.log('\n🔚 Diagnóstico finalizado');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });
}

export default debugBatchImageSystem;
