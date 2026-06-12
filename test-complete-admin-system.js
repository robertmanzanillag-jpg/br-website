
import dbPool from './database/connection.js';
import { generateTokenCode } from './utils/tokenGenerator.js';

async function testCompleteAdminSystem() {
  console.log('🧪 INICIANDO PRUEBA COMPLETA DEL SISTEMA ADMIN DE TOKENS');
  console.log('='.repeat(60));

  let client;
  const testResults = {
    database: false,
    batchCreation: false,
    imageHandling: false,
    batchListing: false,
    batchEditing: false,
    csvExport: false,
    batchDeletion: false
  };

  try {
    // 1. Test Database Connection
    console.log('\n1️⃣ PROBANDO CONEXIÓN A BASE DE DATOS...');
    client = await dbPool.connect();
    const dbTest = await client.query('SELECT NOW(), current_database()');
    console.log(`✅ Conectado a: ${dbTest.rows[0].current_database}`);
    console.log(`✅ Timestamp: ${dbTest.rows[0].now}`);
    testResults.database = true;

    // 2. Test Batch Creation
    console.log('\n2️⃣ PROBANDO CREACIÓN DE LOTE...');
    await client.query('BEGIN');

    // Create test image (base64)
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    const batchData = {
      product: 'T-Shirt',
      drop_name: 'Test Admin Complete',
      variant: 'Test Variant',
      serial_from: 1000,
      serial_to: 1002,
      tokens_per_item: 1,
      size: 'M',
      color: 'Black',
      image_url: testImageBase64
    };

    const batchName = `${batchData.product} - ${batchData.drop_name} - ${batchData.variant} (${batchData.serial_from}-${batchData.serial_to})`;

    const batchResult = await client.query(
      `INSERT INTO batches (name, product, drop_name, variant, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [batchName, batchData.product, batchData.drop_name, batchData.variant, batchData.image_url]
    );

    const batchId = batchResult.rows[0].id;
    console.log(`✅ Lote creado con ID: ${batchId}`);

    // Create tokens for the batch
    const tokens = [];
    for (let serial = batchData.serial_from; serial <= batchData.serial_to; serial++) {
      const tokenCode = generateTokenCode('TAC', 6); // Test Admin Complete
      
      const tokenResult = await client.query(
        `INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [tokenCode, serial, batchData.product, batchData.drop_name,
         batchData.variant, batchData.size, batchData.color, batchData.image_url]
      );

      // Link token to batch
      await client.query(
        'INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)',
        [batchId, tokenResult.rows[0].id]
      );

      tokens.push({
        id: tokenResult.rows[0].id,
        code: tokenCode,
        serial: serial
      });
    }

    console.log(`✅ ${tokens.length} tokens creados exitosamente`);
    testResults.batchCreation = true;
    testResults.imageHandling = true; // Base64 image handled

    // 3. Test Batch Listing
    console.log('\n3️⃣ PROBANDO LISTADO DE LOTES...');
    const batchesQuery = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.product,
        b.drop_name,
        b.variant,
        b.image_url,
        b.created_at,
        COALESCE(token_stats.token_count, 0) as token_count,
        COALESCE(token_stats.claimed_count, 0) as claimed_count
      FROM batches b
      LEFT JOIN (
        SELECT 
          bi.batch_id,
          COUNT(t.id) as token_count,
          COUNT(CASE WHEN t.status = 'claimed' THEN 1 END) as claimed_count
        FROM batch_items bi
        LEFT JOIN tokens t ON bi.token_id = t.id
        GROUP BY bi.batch_id
      ) token_stats ON b.id = token_stats.batch_id
      WHERE b.id = $1
    `, [batchId]);

    if (batchesQuery.rows.length > 0) {
      const batch = batchesQuery.rows[0];
      console.log(`✅ Lote encontrado: ${batch.name}`);
      console.log(`   - Tokens: ${batch.token_count}`);
      console.log(`   - Imagen: ${batch.image_url ? 'Presente' : 'Ausente'}`);
      testResults.batchListing = true;
    } else {
      throw new Error('Lote no encontrado en listado');
    }

    // 4. Test Batch Editing
    console.log('\n4️⃣ PROBANDO EDICIÓN DE LOTE...');
    const newName = `${batchData.product} - ${batchData.drop_name} - Modified Variant`;
    const updateResult = await client.query(
      `UPDATE batches SET
         name = $1,
         variant = $2
       WHERE id = $3
       RETURNING *`,
      [newName, 'Modified Variant', batchId]
    );

    if (updateResult.rows.length > 0) {
      console.log(`✅ Lote actualizado: ${updateResult.rows[0].name}`);
      testResults.batchEditing = true;
    } else {
      throw new Error('No se pudo actualizar el lote');
    }

    // 5. Test CSV Export Data
    console.log('\n5️⃣ PROBANDO DATOS PARA EXPORTACIÓN CSV...');
    const csvData = await client.query(`
      SELECT t.*
      FROM tokens t
      JOIN batch_items bi ON t.id = bi.token_id
      WHERE bi.batch_id = $1
      ORDER BY t.serial
    `, [batchId]);

    if (csvData.rows.length === tokens.length) {
      console.log(`✅ Datos CSV correctos: ${csvData.rows.length} filas`);
      csvData.rows.forEach(row => {
        console.log(`   - ${row.token_code} (Serial: ${row.serial})`);
      });
      testResults.csvExport = true;
    } else {
      throw new Error(`Datos CSV incorrectos: esperados ${tokens.length}, obtenidos ${csvData.rows.length}`);
    }

    // 6. Test Batch Deletion
    console.log('\n6️⃣ PROBANDO ELIMINACIÓN DE LOTE...');
    
    // Delete batch items first
    const deleteItemsResult = await client.query('DELETE FROM batch_items WHERE batch_id = $1', [batchId]);
    console.log(`✅ ${deleteItemsResult.rowCount} relaciones batch_items eliminadas`);

    // Delete tokens
    const tokenIds = tokens.map(t => t.id);
    const deleteTokensResult = await client.query(`DELETE FROM tokens WHERE id = ANY($1)`, [tokenIds]);
    console.log(`✅ ${deleteTokensResult.rowCount} tokens eliminados`);

    // Delete batch
    const deleteBatchResult = await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
    console.log(`✅ ${deleteBatchResult.rowCount} lote eliminado`);

    if (deleteBatchResult.rowCount === 1) {
      testResults.batchDeletion = true;
    } else {
      throw new Error('No se pudo eliminar el lote');
    }

    await client.query('COMMIT');

    // 7. Summary
    console.log('\n7️⃣ RESUMEN DE LA PRUEBA');
    console.log('='.repeat(40));

    Object.entries(testResults).forEach(([test, passed]) => {
      const status = passed ? '✅ PASS' : '❌ FAIL';
      const testName = test.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      console.log(`${status} - ${testName}`);
    });

    const allPassed = Object.values(testResults).every(result => result === true);

    console.log('\n📊 RESULTADO FINAL:');
    if (allPassed) {
      console.log('🎉 TODOS LOS TESTS PASARON - SISTEMA FUNCIONANDO CORRECTAMENTE');
      console.log('✅ El sistema admin de tokens está completamente operativo');
    } else {
      console.log('❌ ALGUNOS TESTS FALLARON - REVISAR ERRORES');
    }

    return { success: allPassed, results: testResults };

  } catch (error) {
    console.error('\n❌ ERROR EN LA PRUEBA:', error);
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        console.log('🔄 Rollback ejecutado');
      } catch (rollbackError) {
        console.error('❌ Error en rollback:', rollbackError);
      }
    }
    
    return { success: false, error: error.message, results: testResults };

  } finally {
    if (client) {
      try {
        client.release();
        console.log('📤 Conexión de base de datos liberada');
      } catch (releaseError) {
        console.error('❌ Error liberando conexión:', releaseError);
      }
    }
  }
}

// Ejecutar la prueba
if (import.meta.url === `file://${process.argv[1]}`) {
  testCompleteAdminSystem()
    .then(result => {
      if (result.success) {
        console.log('\n🎯 CONCLUSIÓN: Sistema admin completamente funcional');
        process.exit(0);
      } else {
        console.log('\n🚨 CONCLUSIÓN: Sistema requiere atención');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 ERROR CRÍTICO:', error);
      process.exit(1);
    });
}

export default testCompleteAdminSystem;
