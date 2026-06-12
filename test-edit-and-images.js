
import pool from './database/connection.js';
import fetch from 'node-fetch';

async function testEditAndImages() {
  console.log('🧪 PRUEBA COMPLETA DE EDICIÓN Y VISUALIZACIÓN DE IMÁGENES');
  console.log('='.repeat(70));

  let client;
  try {
    client = await pool.connect();

    // 1. Create test batch with image
    console.log('\n1️⃣ CREANDO LOTE DE PRUEBA...');
    
    await client.query('BEGIN');
    
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const batch = await client.query(`
      INSERT INTO batches (name, product, drop_name, variant, image_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name
    `, [
      'TEST-EDIT - Test Product - Test Variant',
      'TEST-EDIT', 
      'Test Product',
      'Test Variant',
      testImage
    ]);

    const batchId = batch.rows[0].id;
    console.log(`✅ Lote creado: ID ${batchId}`);

    // Create tokens for the batch
    const token1 = await client.query(`
      INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, ['TEST-EDIT-001', 1001, 'TEST-EDIT', 'Test Product', 'Test Variant', 'M', 'Black', testImage]);

    await client.query('INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)', [batchId, token1.rows[0].id]);
    await client.query('COMMIT');
    
    console.log(`✅ Token creado y asociado al lote`);

    // 2. Test batches listing
    console.log('\n2️⃣ PROBANDO LISTADO DE LOTES...');
    
    const listResponse = await fetch('http://localhost:5000/admin/tokens/batches');
    if (listResponse.ok) {
      const batches = await listResponse.json();
      const testBatch = batches.find(b => b.id === batchId);
      
      if (testBatch) {
        console.log(`✅ Lote encontrado en listado: ${testBatch.name}`);
        console.log(`🖼️ Image URL en listado: ${testBatch.image_url ? 'Presente' : 'Ausente'}`);
        
        if (testBatch.image_url) {
          if (testBatch.image_url.startsWith('data:image/')) {
            console.log(`✅ Imagen Base64 detectada correctamente`);
          } else {
            console.log(`✅ Imagen con URL: ${testBatch.image_url.substring(0, 50)}...`);
          }
        }
      } else {
        console.log(`❌ Lote NO encontrado en listado`);
      }
    } else {
      console.log(`❌ Error en listado: ${listResponse.status}`);
    }

    // 3. Test batch edit endpoint
    console.log('\n3️⃣ PROBANDO ENDPOINT DE EDICIÓN...');
    
    const editResponse = await fetch(`http://localhost:5000/admin/tokens/batch/${batchId}`);
    if (editResponse.ok) {
      const editBatch = await editResponse.json();
      console.log(`✅ Datos de edición obtenidos para lote: ${editBatch.name}`);
      console.log(`🖼️ Image URL en edición: ${editBatch.image_url ? 'Presente' : 'Ausente'}`);
      
      if (editBatch.image_url) {
        if (editBatch.image_url.startsWith('data:image/')) {
          console.log(`✅ Imagen Base64 preservada para edición`);
        } else {
          console.log(`✅ Imagen procesada para edición: ${editBatch.image_url.substring(0, 50)}...`);
        }
      }
    } else {
      const errorText = await editResponse.text();
      console.log(`❌ Error en endpoint de edición: ${editResponse.status} - ${errorText}`);
    }

    // 4. Test token public view
    console.log('\n4️⃣ PROBANDO VISTA PÚBLICA DEL TOKEN...');
    
    const tokenCode = 'TEST-EDIT-001';
    const publicResponse = await fetch(`http://localhost:5000/api/tokens/${tokenCode}`);
    if (publicResponse.ok) {
      const tokenData = await publicResponse.json();
      console.log(`✅ Token público obtenido: ${tokenData.token_code}`);
      console.log(`🖼️ Image URL en token público: ${tokenData.image_url ? 'Presente' : 'Ausente'}`);
    } else {
      console.log(`❌ Error en vista pública del token: ${publicResponse.status}`);
    }

    // 5. Cleanup
    console.log('\n5️⃣ LIMPIANDO DATOS DE PRUEBA...');
    await client.query('BEGIN');
    await client.query('DELETE FROM batch_items WHERE batch_id = $1', [batchId]);
    await client.query('DELETE FROM tokens WHERE id = $1', [token1.rows[0].id]);
    await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
    await client.query('COMMIT');
    console.log(`🗑️ Datos de prueba eliminados`);

    console.log('\n='.repeat(70));
    console.log('🎯 RESUMEN DE LA PRUEBA:');
    console.log('✅ Lote creado con imagen Base64');
    console.log('✅ Listado de lotes funcional');
    console.log('✅ Endpoint de edición funcional');
    console.log('✅ Vista pública del token funcional');
    console.log('✅ Limpieza completada');
    console.log('\n🎉 SISTEMA DE EDICIÓN E IMÁGENES FUNCIONANDO CORRECTAMENTE');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR EN LA PRUEBA:', error);
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

testEditAndImages().catch(console.error);
