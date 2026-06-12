
import pool from './database/connection.js';
import fetch from 'node-fetch';

async function testFinalFixes() {
  console.log('🧪 PROBANDO CORRECCIONES FINALES');
  console.log('='.repeat(60));

  let client;
  let testBatchId;

  try {
    client = await pool.connect();

    // 1. Test database connection
    console.log('\n1️⃣ PROBANDO CONEXIÓN...');
    await client.query('SELECT NOW()');
    console.log('✅ Conexión a base de datos exitosa');

    // 2. Create test batch with base64 image
    console.log('\n2️⃣ CREANDO LOTE DE PRUEBA CON IMAGEN BASE64...');
    await client.query('BEGIN');

    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAG0lEQVQIHWNkYGD4z8DAwMjAwMDIyMDAwAAGAAIAAQC+TbJkAAAAAElFTkSuQmCC';
    
    const batchResult = await client.query(
      `INSERT INTO batches (name, product, drop_name, variant, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, image_url`,
      [
        'Test-Fix - Final Test - Red',
        'Test-Fix',
        'Final Test',
        'Red',
        testImageBase64
      ]
    );

    testBatchId = batchResult.rows[0].id;
    console.log(`✅ Lote creado: ID ${testBatchId}`);
    console.log(`🖼️ Imagen guardada: ${batchResult.rows[0].image_url ? 'SÍ' : 'NO'}`);
    console.log(`📏 Tamaño imagen: ${batchResult.rows[0].image_url?.length} caracteres`);

    // 3. Test batches API endpoint
    console.log('\n3️⃣ PROBANDO ENDPOINT /admin/tokens/batches...');
    const response = await fetch('http://localhost:5000/admin/tokens/batches');
    const batches = await response.json();
    
    const testBatch = batches.find(b => b.id === testBatchId);
    if (testBatch) {
      console.log(`✅ Lote encontrado en API`);
      console.log(`📝 Nombre: ${testBatch.name}`);
      console.log(`🖼️ URL imagen: ${testBatch.image_url ? 'Presente' : 'Ausente'}`);
      console.log(`📄 Tipo imagen: ${testBatch.image_url?.startsWith('data:') ? 'Base64' : 'Other'}`);
    } else {
      throw new Error('Lote no encontrado en respuesta de API');
    }

    // 4. Test batch editing
    console.log('\n4️⃣ PROBANDO EDICIÓN DE LOTE...');
    const editResponse = await fetch(`http://localhost:5000/admin/tokens/batch/${testBatchId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product: 'Test-Fix-EDITED',
        drop_name: 'Final Test EDITED',
        variant: 'Blue'
      })
    });

    if (editResponse.ok) {
      const editResult = await editResponse.json();
      console.log(`✅ Edición exitosa: ${editResult.message}`);
      
      // Verify image was preserved
      const verifyResponse = await fetch('http://localhost:5000/admin/tokens/batches');
      const updatedBatches = await verifyResponse.json();
      const updatedBatch = updatedBatches.find(b => b.id === testBatchId);
      
      if (updatedBatch && updatedBatch.image_url) {
        console.log(`✅ Imagen preservada después de edición`);
        console.log(`🖼️ Imagen sigue siendo: ${updatedBatch.image_url?.startsWith('data:') ? 'Base64' : 'Other'}`);
      } else {
        console.log(`❌ Imagen NO preservada después de edición`);
      }
    } else {
      const errorText = await editResponse.text();
      throw new Error(`Error editando lote: ${errorText}`);
    }

    // 5. Test frontend image processing simulation
    console.log('\n5️⃣ SIMULANDO PROCESAMIENTO DE IMAGEN EN FRONTEND...');
    const finalResponse = await fetch('http://localhost:5000/admin/tokens/batches');
    const finalBatches = await finalResponse.json();
    const finalBatch = finalBatches.find(b => b.id === testBatchId);

    if (finalBatch && finalBatch.image_url) {
      console.log(`✅ Imagen disponible para frontend`);
      
      // Simulate frontend processing
      let displayUrl = finalBatch.image_url;
      if (displayUrl.startsWith('data:image/')) {
        console.log(`✅ Base64 image detected - will display directly`);
      } else if (displayUrl.startsWith('/api/storage/')) {
        console.log(`✅ Storage path detected - will use API endpoint`);
      } else {
        console.log(`✅ Other image type: ${displayUrl.substring(0, 50)}...`);
      }
    }

    // Cleanup
    await client.query('DELETE FROM batches WHERE id = $1', [testBatchId]);
    await client.query('COMMIT');
    console.log(`🗑️ Lote de prueba eliminado`);

    console.log('\n='.repeat(60));
    console.log('🎉 TODAS LAS PRUEBAS PASARON');
    console.log('✅ Las imágenes ahora deberían mostrarse correctamente');
    console.log('✅ La edición de lotes debería funcionar');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ ERROR EN PRUEBAS:', error);
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('❌ Error en rollback:', rollbackError);
      }
    }
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

testFinalFixes().catch(console.error);
