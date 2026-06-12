
import pool from './database/connection.js';
import fs from 'fs';
import path from 'path';

async function checkBatchImages() {
  console.log('🔍 VERIFICANDO IMÁGENES DE BATCHES RÁPIDAMENTE');
  console.log('='.repeat(50));

  let client;
  try {
    client = await pool.connect();

    const batches = await client.query(`
      SELECT id, name, image_url, created_at
      FROM batches 
      WHERE image_url IS NOT NULL AND image_url != ''
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log(`📊 Encontrados ${batches.rows.length} batches con imágenes:`);

    for (const batch of batches.rows) {
      const imageUrl = batch.image_url;
      console.log(`\n📦 Batch ${batch.id}: ${batch.name}`);
      console.log(`   🖼️ URL original: ${imageUrl}`);

      // Check what the processed URL would be
      let processedUrl = '/api/storage/images/logo.png'; // default
      
      if (imageUrl.startsWith('data:image/')) {
        processedUrl = 'Base64 image';
      } else if (imageUrl.startsWith('http')) {
        processedUrl = imageUrl;
      } else if (imageUrl.startsWith('/api/storage/')) {
        processedUrl = imageUrl;
      } else {
        let cleanPath = imageUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/)/, '');
        if (cleanPath.startsWith('batch-images/')) {
          processedUrl = `/api/storage/${cleanPath}`;
        } else {
          processedUrl = `/api/storage/batch-images/${cleanPath}`;
        }
      }

      console.log(`   🔄 URL procesada: ${processedUrl}`);

      // Check if it exists in Object Storage (simulated)
      if (processedUrl.startsWith('/api/storage/batch-images/')) {
        const filename = processedUrl.split('/').pop();
        console.log(`   📁 Archivo esperado en Object Storage: batch-images/${filename}`);
      }
    }

    console.log('\n✅ Verificación completada');
    console.log('\n💡 Para resolver los errores 404:');
    console.log('1. Asegurar que las imágenes se suban a Object Storage');
    console.log('2. Verificar que las URLs apunten a /api/storage/batch-images/');
    console.log('3. Confirmar que el endpoint /api/storage/* funcione');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) client.release();
    process.exit(0);
  }
}

checkBatchImages();
