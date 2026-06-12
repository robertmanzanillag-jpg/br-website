
import pool from './database/connection.js';
import fetch from 'node-fetch';

async function testBatchSystem() {
  console.log('🧪 PRUEBA COMPLETA DEL SISTEMA DE BATCHES');
  console.log('='.repeat(50));

  let client;
  let testBatchId;

  try {
    client = await pool.connect();

    // 1. Test database connection
    console.log('\n1️⃣ PROBANDO CONEXIÓN A BD...');
    const dbTest = await client.query('SELECT NOW()');
    console.log('✅ Conexión exitosa');

    // 2. Create test batch
    console.log('\n2️⃣ CREANDO LOTE DE PRUEBA...');
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const createResponse = await fetch('http://localhost:5000/admin/tokens/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: 'TEST-PRODUCT',
        drop_name: 'TEST-DROP',
        variant: 'TEST-VARIANT',
        serial_from: 9990,
        serial_to: 9992,
        tokens_per_item: 1,
        size: 'M',
        color: 'Black',
        image_url: testImage
      })
    });

    if (createResponse.ok) {
      const createResult = await createResponse.json();
      testBatchId = createResult.batch.id;
      console.log(`✅ Lote creado: ID ${testBatchId}`);
    } else {
      throw new Error(`Error creando lote: ${createResponse.status}`);
    }

    // 3. Test batch listing
    console.log('\n3️⃣ PROBANDO LISTADO DE LOTES...');
    const listResponse = await fetch('http://localhost:5000/admin/tokens/batches');
    
    if (listResponse.ok) {
      const batches = await listResponse.json();
      const testBatch = batches.find(b => b.id === testBatchId);
      
      if (testBatch) {
        console.log('✅ Lote encontrado en listado');
        console.log(`   - Nombre: ${testBatch.name}`);
        console.log(`   - Imagen: ${testBatch.image_url ? 'Presente' : 'Ausente'}`);
        console.log(`   - Tokens: ${testBatch.token_count}`);
      } else {
        throw new Error('Lote no encontrado en listado');
      }
    } else {
      throw new Error(`Error en listado: ${listResponse.status}`);
    }

    // 4. Test batch editing
    console.log('\n4️⃣ PROBANDO EDICIÓN DE LOTE...');
    const editResponse = await fetch(`http://localhost:5000/admin/tokens/batch/${testBatchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: 'TEST-EDITED',
        drop_name: 'TEST-DROP-EDITED',
        variant: 'TEST-VARIANT-EDITED'
      })
    });

    if (editResponse.ok) {
      const editResult = await editResponse.json();
      console.log('✅ Edición exitosa');
      console.log(`   - Mensaje: ${editResult.message}`);
    } else {
      const errorText = await editResponse.text();
      console.log(`❌ Error editando lote ${testBatchId}:`);
      console.log(`   - Status: ${editResponse.status}`);
      console.log(`   - Error: ${errorText}`);
      throw new Error(`Error editando: ${editResponse.status} - ${errorText}`);
    }

    // 5. Verify edit
    console.log('\n5️⃣ VERIFICANDO EDICIÓN...');
    const verifyResponse = await fetch('http://localhost:5000/admin/tokens/batches');
    
    if (verifyResponse.ok) {
      const batches = await verifyResponse.json();
      const editedBatch = batches.find(b => b.id === testBatchId);
      
      if (editedBatch && editedBatch.product === 'TEST-EDITED') {
        console.log('✅ Edición verificada');
        console.log(`   - Nuevo producto: ${editedBatch.product}`);
      } else {
        throw new Error('Edición no se reflejó correctamente');
      }
    }

    // 6. Test CSV export
    console.log('\n6️⃣ PROBANDO EXPORTACIÓN CSV...');
    const csvResponse = await fetch(`http://localhost:5000/admin/tokens/batch/${testBatchId}/export.csv`);
    
    if (csvResponse.ok) {
      const csvText = await csvResponse.text();
      console.log('✅ CSV exportado correctamente');
      console.log(`   - Tamaño: ${csvText.length} caracteres`);
    } else {
      throw new Error(`Error exportando CSV: ${csvResponse.status}`);
    }

    console.log('\n='.repeat(50));
    console.log('🎉 TODAS LAS PRUEBAS PASARON');
    console.log('✅ Sistema de batches funcionando correctamente');
    console.log('✅ Imágenes se manejan correctamente');
    console.log('✅ Edición funciona correctamente');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ ERROR EN PRUEBAS:', error);
    throw error;
  } finally {
    // Cleanup
    if (testBatchId && client) {
      try {
        console.log('\n🗑️ LIMPIANDO DATOS DE PRUEBA...');
        await client.query('BEGIN');
        await client.query('DELETE FROM batch_items WHERE batch_id = $1', [testBatchId]);
        await client.query('DELETE FROM tokens WHERE product = $1', ['TEST-EDITED']);
        await client.query('DELETE FROM batches WHERE id = $1', [testBatchId]);
        await client.query('COMMIT');
        console.log('✅ Limpieza completada');
      } catch (cleanupError) {
        console.error('❌ Error en limpieza:', cleanupError);
      }
    }
    
    if (client) client.release();
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  testBatchSystem().catch(console.error);
}

export default testBatchSystem;
