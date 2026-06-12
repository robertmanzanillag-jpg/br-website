
import pool from './database/connection.js';

async function repairTokenSystem() {
  console.log('🔧 INICIANDO REPARACIÓN COMPLETA DEL SISTEMA DE TOKENS');
  console.log('='.repeat(60));

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Eliminar tokens duplicados manteniendo el más reciente
    console.log('\n1️⃣ Eliminando tokens duplicados...');
    
    const duplicatesQuery = `
      WITH duplicates AS (
        SELECT 
          token_code,
          COUNT(*) as count,
          array_agg(id ORDER BY created_at DESC) as ids
        FROM tokens
        GROUP BY token_code
        HAVING COUNT(*) > 1
      ),
      tokens_to_delete AS (
        SELECT unnest(ids[2:]) as id_to_delete
        FROM duplicates
      )
      DELETE FROM tokens 
      WHERE id IN (SELECT id_to_delete FROM tokens_to_delete)
      RETURNING token_code;
    `;
    
    const deletedDuplicates = await client.query(duplicatesQuery);
    console.log(`✅ Eliminados ${deletedDuplicates.rowCount} tokens duplicados`);
    
    // 2. Limpiar batch_items huérfanos
    console.log('\n2️⃣ Limpiando batch_items huérfanos...');
    
    const orphanBatchItems = await client.query(`
      DELETE FROM batch_items 
      WHERE token_id NOT IN (SELECT id FROM tokens)
      OR batch_id NOT IN (SELECT id FROM batches)
      RETURNING *
    `);
    
    console.log(`✅ Eliminados ${orphanBatchItems.rowCount} batch_items huérfanos`);
    
    // 3. Limpiar tokens huérfanos
    console.log('\n3️⃣ Limpiando tokens huérfanos...');
    
    const orphanTokens = await client.query(`
      DELETE FROM tokens 
      WHERE id NOT IN (
        SELECT DISTINCT token_id 
        FROM batch_items 
        WHERE token_id IS NOT NULL
      )
      AND status = 'available'
      RETURNING *
    `);
    
    console.log(`✅ Eliminados ${orphanTokens.rowCount} tokens huérfanos`);
    
    // 4. Recalcular estadísticas por batch
    console.log('\n4️⃣ Recalculando estadísticas...');
    
    const batchStats = await client.query(`
      SELECT 
        b.id,
        b.name,
        COUNT(t.id) as token_count,
        COUNT(CASE WHEN t.status = 'claimed' THEN 1 END) as claimed_count,
        COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.batch_id
      LEFT JOIN tokens t ON bi.token_id = t.id
      GROUP BY b.id, b.name
      ORDER BY b.id
    `);
    
    console.log('\n📊 ESTADÍSTICAS ACTUALIZADAS:');
    batchStats.rows.forEach(batch => {
      console.log(`   Batch ${batch.id}: ${batch.token_count} tokens (${batch.claimed_count} reclamados, ${batch.available_count} disponibles)`);
    });
    
    // 5. Verificar integridad final
    console.log('\n5️⃣ Verificando integridad final...');
    
    const finalCheck = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens) as total_tokens,
        (SELECT COUNT(*) FROM batches) as total_batches,
        (SELECT COUNT(*) FROM batch_items) as total_batch_items,
        (SELECT COUNT(*) FROM tokens WHERE status = 'claimed') as claimed_tokens,
        (SELECT COUNT(DISTINCT token_code) FROM tokens) as unique_codes
    `);
    
    const stats = finalCheck.rows[0];
    console.log(`✅ Tokens totales: ${stats.total_tokens}`);
    console.log(`✅ Batches totales: ${stats.total_batches}`);
    console.log(`✅ Relaciones batch-items: ${stats.total_batch_items}`);
    console.log(`✅ Tokens reclamados: ${stats.claimed_tokens}`);
    console.log(`✅ Códigos únicos: ${stats.unique_codes}`);
    
    if (parseInt(stats.total_tokens) === parseInt(stats.unique_codes)) {
      console.log('✅ INTEGRIDAD VERIFICADA: No hay duplicados');
    } else {
      console.log('❌ WARNING: Aún hay duplicados o inconsistencias');
    }
    
    await client.query('COMMIT');
    console.log('\n🎉 REPARACIÓN COMPLETADA EXITOSAMENTE');
    
    return {
      duplicatesRemoved: deletedDuplicates.rowCount,
      orphanBatchItemsRemoved: orphanBatchItems.rowCount,
      orphanTokensRemoved: orphanTokens.rowCount,
      finalStats: stats
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error durante reparación:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Función para resetear un batch específico
async function resetBatch(batchId) {
  console.log(`🔄 RESETEANDO BATCH ${batchId}`);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Obtener info del batch
    const batchInfo = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
    if (batchInfo.rows.length === 0) {
      throw new Error(`Batch ${batchId} no encontrado`);
    }
    
    const batch = batchInfo.rows[0];
    console.log(`📋 Batch encontrado: ${batch.name}`);
    
    // Eliminar tokens del batch
    const deleteResult = await client.query(`
      DELETE FROM tokens 
      WHERE id IN (
        SELECT token_id FROM batch_items WHERE batch_id = $1
      )
      RETURNING *
    `, [batchId]);
    
    // Eliminar batch_items
    await client.query('DELETE FROM batch_items WHERE batch_id = $1', [batchId]);
    
    console.log(`✅ Eliminados ${deleteResult.rowCount} tokens del batch`);
    
    await client.query('COMMIT');
    console.log(`✅ Batch ${batchId} reseteado correctamente`);
    
    return { tokensDeleted: deleteResult.rowCount, batch: batch };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Error reseteando batch ${batchId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

// Función para crear batch de prueba
async function createTestBatch() {
  console.log('🧪 CREANDO BATCH DE PRUEBA');
  
  const testData = {
    product: 'T-Shirt',
    drop_name: 'System Test',
    variant: 'Test Batch',
    serial_from: 99990,
    serial_to: 99994,
    tokens_per_item: 1,
    size: 'M',
    color: 'Black',
    image_url: '/api/storage/images/logo.png'
  };
  
  try {
    const response = await fetch('http://localhost:5000/admin/tokens/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Batch de prueba creado: ID ${result.batch_id}`);
      console.log(`📊 Tokens creados: ${result.tokens_created}`);
      return result;
    } else {
      const error = await response.text();
      console.log('❌ Error creando batch de prueba:', error);
      return null;
    }
  } catch (error) {
    console.error('❌ Error en petición:', error);
    return null;
  }
}

// Ejecutar según argumentos
const args = process.argv.slice(2);

if (args.includes('--repair')) {
  await repairTokenSystem();
} else if (args.includes('--reset-batch')) {
  const batchId = args[args.indexOf('--reset-batch') + 1];
  if (batchId) {
    await resetBatch(parseInt(batchId));
  } else {
    console.log('❌ Proporciona un ID de batch: --reset-batch 123');
  }
} else if (args.includes('--test-batch')) {
  await createTestBatch();
} else {
  console.log('🔧 OPCIONES DISPONIBLES:');
  console.log('  --repair          : Reparar problemas comunes');
  console.log('  --reset-batch ID  : Resetear batch específico');
  console.log('  --test-batch      : Crear batch de prueba');
}

export { repairTokenSystem, resetBatch, createTestBatch };
