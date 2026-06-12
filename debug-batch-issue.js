
import pool from './database/connection.js';
import fetch from 'node-fetch';

async function debugBatchIssue() {
  console.log('🔍 DIAGNÓSTICO DEL PROBLEMA DE LOTES');
  console.log('='.repeat(60));

  let client;
  try {
    client = await pool.connect();

    // 1. Verificar estado de la base de datos
    console.log('\n1️⃣ VERIFICANDO ESTADO DE LA BASE DE DATOS...');
    
    const batchCount = await client.query('SELECT COUNT(*) as count FROM batches');
    const tokenCount = await client.query('SELECT COUNT(*) as count FROM tokens');
    const itemCount = await client.query('SELECT COUNT(*) as count FROM batch_items');
    
    console.log(`📊 Batches en BD: ${batchCount.rows[0].count}`);
    console.log(`📊 Tokens en BD: ${tokenCount.rows[0].count}`);
    console.log(`📊 Batch items en BD: ${itemCount.rows[0].count}`);

    // 2. Mostrar últimos lotes
    const recentBatches = await client.query(`
      SELECT id, name, product, drop_name, variant, image_url, created_at
      FROM batches 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    console.log(`\n📦 Últimos ${recentBatches.rows.length} lotes en BD:`);
    recentBatches.rows.forEach(batch => {
      console.log(`  - ID: ${batch.id}, Nombre: ${batch.name}`);
      console.log(`    Imagen: ${batch.image_url ? batch.image_url.substring(0, 50) + '...' : 'NO TIENE'}`);
      console.log(`    Creado: ${batch.created_at}`);
    });

    // 3. Probar endpoint de batches
    console.log('\n2️⃣ PROBANDO ENDPOINT DE BATCHES...');
    
    try {
      const response = await fetch('http://localhost:5000/admin/tokens/batches');
      console.log(`📡 Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const batches = await response.json();
        console.log(`📦 API devolvió ${batches?.length || 0} lotes`);
        
        if (batches && batches.length > 0) {
          console.log('📋 Primeros lotes de la API:');
          batches.slice(0, 3).forEach(batch => {
            console.log(`  - ID: ${batch.id}, Nombre: ${batch.name}`);
            console.log(`    Token count: ${batch.token_count}`);
            console.log(`    Image URL: ${batch.image_url ? 'Presente' : 'Ausente'}`);
          });
        } else {
          console.log('❌ La API no devolvió lotes o devolvió array vacío');
        }
      } else {
        const errorText = await response.text();
        console.log(`❌ Error en API: ${errorText}`);
      }
    } catch (fetchError) {
      console.log(`❌ Error al hacer fetch: ${fetchError.message}`);
    }

    // 4. Crear lote de prueba directo en BD
    console.log('\n3️⃣ CREANDO LOTE DE PRUEBA DIRECTO...');
    
    await client.query('BEGIN');
    
    const testBatch = await client.query(`
      INSERT INTO batches (name, product, drop_name, variant, image_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name
    `, [
      'DEBUG-TEST - Diagnóstico - Test',
      'DEBUG-TEST', 
      'Diagnóstico',
      'Test',
      '/images/logo.png'
    ]);

    const batchId = testBatch.rows[0].id;
    console.log(`✅ Lote creado: ID ${batchId}, Nombre: ${testBatch.rows[0].name}`);

    // Crear algunos tokens para este lote
    const token1 = await client.query(`
      INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, ['DBG-TEST-001', 99998, 'DEBUG-TEST', 'Diagnóstico', 'Test', 'M', 'Red', '/images/logo.png']);

    const token2 = await client.query(`
      INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, ['DBG-TEST-002', 99999, 'DEBUG-TEST', 'Diagnóstico', 'Test', 'M', 'Red', '/images/logo.png']);

    // Crear relaciones batch_items
    await client.query('INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)', [batchId, token1.rows[0].id]);
    await client.query('INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)', [batchId, token2.rows[0].id]);

    await client.query('COMMIT');
    console.log(`✅ Tokens creados y asociados al lote`);

    // 5. Verificar que aparece en la API
    console.log('\n4️⃣ VERIFICANDO QUE EL LOTE APARECE EN LA API...');
    
    // Esperar un momento para que la base de datos se actualice
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const verifyResponse = await fetch('http://localhost:5000/admin/tokens/batches');
    if (verifyResponse.ok) {
      const verifyBatches = await verifyResponse.json();
      const testBatchInAPI = verifyBatches.find(b => b.id === batchId);
      
      if (testBatchInAPI) {
        console.log(`✅ Lote encontrado en API: ${testBatchInAPI.name}`);
        console.log(`📊 Token count: ${testBatchInAPI.token_count}`);
        console.log(`🖼️ Image URL: ${testBatchInAPI.image_url}`);
      } else {
        console.log(`❌ Lote NO encontrado en API`);
        console.log(`🔍 API devolvió ${verifyBatches.length} lotes:`);
        verifyBatches.forEach(b => console.log(`  - ID: ${b.id}, Name: ${b.name}`));
      }
    }

    // 6. Cleanup
    console.log('\n5️⃣ LIMPIANDO DATOS DE PRUEBA...');
    await client.query('DELETE FROM batch_items WHERE batch_id = $1', [batchId]);
    await client.query('DELETE FROM tokens WHERE id IN ($1, $2)', [token1.rows[0].id, token2.rows[0].id]);
    await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
    console.log(`🗑️ Datos de prueba eliminados`);

    console.log('\n='.repeat(60));
    console.log('🎯 DIAGNÓSTICO COMPLETADO');

  } catch (error) {
    console.error('\n❌ ERROR EN DIAGNÓSTICO:', error);
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

debugBatchIssue().catch(console.error);
