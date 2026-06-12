
import pool from './database/connection.js';
import fs from 'fs';
import path from 'path';

async function testImageAndEditIssues() {
  console.log('🔍 DIAGNÓSTICO DE PROBLEMAS DE IMÁGENES Y EDICIÓN');
  console.log('='.repeat(60));

  let client;
  try {
    client = await pool.connect();

    // 1. Test Database Connection
    console.log('\n1️⃣ PROBANDO CONEXIÓN A BASE DE DATOS...');
    const dbTest = await client.query('SELECT NOW(), current_database()');
    console.log(`✅ Conectado a: ${dbTest.rows[0].current_database}`);

    // 2. Check existing batches and their image URLs
    console.log('\n2️⃣ ANALIZANDO LOTES EXISTENTES...');
    const batchesResult = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.image_url,
        COUNT(bi.token_id) as token_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.batch_id
      GROUP BY b.id, b.name, b.image_url
      ORDER BY b.id DESC
      LIMIT 5
    `);

    console.log(`📦 Se encontraron ${batchesResult.rows.length} lotes:`);
    batchesResult.rows.forEach(batch => {
      console.log(`  - Lote ${batch.id}: ${batch.name}`);
      console.log(`    Imagen: ${batch.image_url || 'NO TIENE'}`);
      console.log(`    Tokens: ${batch.token_count}`);
      
      if (batch.image_url) {
        if (batch.image_url.startsWith('data:')) {
          console.log(`    ✅ Imagen Base64 (${batch.image_url.length} chars)`);
        } else if (batch.image_url.startsWith('/api/storage/')) {
          console.log(`    🔗 Path de Object Storage`);
        } else if (batch.image_url.startsWith('http')) {
          console.log(`    🌐 URL externa`);
        } else {
          console.log(`    ⚠️ Path relativo - puede causar problemas`);
        }
      }
      console.log('');
    });

    // 3. Test batch creation with image
    console.log('\n3️⃣ PROBANDO CREACIÓN DE LOTE CON IMAGEN...');
    await client.query('BEGIN');

    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const batchData = {
      product: 'Test-Image-Fix',
      drop_name: 'Image-Test',
      variant: 'Red',
      serial_from: 99995,
      serial_to: 99996,
      tokens_per_item: 1,
      size: 'M',
      color: 'Red',
      image_url: testImageBase64
    };

    // Create batch
    const batchResult = await client.query(
      `INSERT INTO batches (name, product, drop_name, variant, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, image_url`,
      [
        `${batchData.product} - ${batchData.drop_name} - ${batchData.variant}`,
        batchData.product,
        batchData.drop_name,
        batchData.variant,
        batchData.image_url
      ]
    );

    const testBatchId = batchResult.rows[0].id;
    console.log(`✅ Lote de prueba creado: ID ${testBatchId}`);
    console.log(`🖼️ Imagen guardada: ${batchResult.rows[0].image_url ? 'SÍ' : 'NO'}`);

    // 4. Test batch editing
    console.log('\n4️⃣ PROBANDO EDICIÓN DE LOTE...');
    const updateResult = await client.query(
      `UPDATE batches SET 
         product = $1,
         drop_name = $2,
         variant = $3
       WHERE id = $4
       RETURNING *`,
      ['Test-Image-Fix-EDITED', 'Image-Test-EDITED', 'Blue', testBatchId]
    );

    if (updateResult.rows.length > 0) {
      console.log(`✅ Lote editado exitosamente`);
      console.log(`📝 Nuevo nombre: ${updateResult.rows[0].name}`);
      console.log(`🖼️ Imagen preservada: ${updateResult.rows[0].image_url ? 'SÍ' : 'NO'}`);
    } else {
      console.log(`❌ Error: No se pudo editar el lote`);
    }

    // 5. Test frontend simulation
    console.log('\n5️⃣ SIMULANDO CARGA DESDE FRONTEND...');
    const frontendQuery = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.product,
        b.drop_name,
        b.variant,
        b.image_url,
        b.created_at,
        COALESCE(token_stats.token_count, 0) as token_count,
        COALESCE(token_stats.claimed_count, 0) as claimed_count,
        COALESCE(token_stats.available_count, 0) as available_count
      FROM batches b
      LEFT JOIN (
        SELECT 
          bi.batch_id,
          COUNT(t.id) as token_count,
          COUNT(CASE WHEN t.status = 'claimed' THEN 1 END) as claimed_count,
          COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_count
        FROM batch_items bi
        LEFT JOIN tokens t ON bi.token_id = t.id
        GROUP BY bi.batch_id
      ) token_stats ON b.id = token_stats.batch_id
      WHERE b.id = $1
    `, [testBatchId]);

    if (frontendQuery.rows.length > 0) {
      const batch = frontendQuery.rows[0];
      console.log(`✅ Datos para frontend obtenidos correctamente`);
      
      // Process image URL like the frontend would
      let finalImageUrl = '/images/logo.png';
      if (batch.image_url) {
        if (batch.image_url.startsWith('data:')) {
          finalImageUrl = batch.image_url;
          console.log(`🖼️ Imagen Base64 detectada para frontend`);
        } else if (batch.image_url.startsWith('/api/storage/')) {
          finalImageUrl = batch.image_url;
          console.log(`🖼️ Path de storage mantenido`);
        } else {
          console.log(`⚠️ Imagen requiere procesamiento: ${batch.image_url}`);
        }
      }
      
      console.log(`📱 URL final para mostrar: ${finalImageUrl.substring(0, 100)}...`);
    }

    // Clean up test data
    await client.query('DELETE FROM batches WHERE id = $1', [testBatchId]);
    await client.query('COMMIT');
    console.log(`🗑️ Datos de prueba limpiados`);

    // 6. Check Object Storage directory
    console.log('\n6️⃣ VERIFICANDO DIRECTORIO DE IMÁGENES...');
    const publicImagesDir = path.join(process.cwd(), 'public', 'images');
    const productsDir = path.join(publicImagesDir, 'products');
    
    if (fs.existsSync(publicImagesDir)) {
      const imageFiles = fs.readdirSync(publicImagesDir);
      console.log(`📁 Archivos en /public/images: ${imageFiles.length}`);
      imageFiles.slice(0, 5).forEach(file => console.log(`  - ${file}`));
    } else {
      console.log(`❌ Directorio /public/images no existe`);
    }

    if (fs.existsSync(productsDir)) {
      const productFiles = fs.readdirSync(productsDir);
      console.log(`📁 Archivos en /public/images/products: ${productFiles.length}`);
    } else {
      console.log(`⚠️ Directorio /public/images/products no existe`);
    }

    console.log('\n='.repeat(60));
    console.log('🎯 DIAGNÓSTICO COMPLETADO');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('❌ Error en rollback:', rollbackError);
      }
    }
  } finally {
    if (client) {
      client.release();
    }
  }
}

testImageAndEditIssues().catch(console.error);
