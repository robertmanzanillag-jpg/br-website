import dbPool from './database/connection.js';
import { generateTokenCode } from './utils/tokenGenerator.js';

async function runCompleteDiagnostics() {
  console.log('🔍 SISTEMA DE DIAGNÓSTICOS BLACK ROOM TOKENS');
  console.log('='.repeat(50));

  const diagnostics = {
    timestamp: new Date().toISOString(),
    results: {}
  };

  let client;
  try {
    // 1. Database Connection
    console.log('\n1️⃣ Probando conexión a base de datos...');
    client = await dbPool.connect();
    const dbTest = await client.query('SELECT NOW(), version(), current_database()');

    diagnostics.results.database = {
      status: 'connected',
      timestamp: dbTest.rows[0].now,
      database: dbTest.rows[0].current_database,
      version: dbTest.rows[0].version.split(' ')[0]
    };

    console.log(`✅ Conectado a: ${diagnostics.results.database.database}`);
    console.log(`✅ Versión PostgreSQL: ${diagnostics.results.database.version}`);

    // 2. Pool Status
    console.log('\n2️⃣ Verificando pool de conexiones...');
    diagnostics.results.poolStatus = {
      total: dbPool.totalCount,
      idle: dbPool.idleCount,
      waiting: dbPool.waitingCount
    };

    console.log(`📊 Total: ${dbPool.totalCount}, Idle: ${dbPool.idleCount}, Waiting: ${dbPool.waitingCount}`);

    // 3. Table Structure
    console.log('\n3️⃣ Verificando estructura de tablas...');
    const tablesQuery = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('batches', 'tokens', 'batch_items')
      ORDER BY table_name
    `);

    const foundTables = tablesQuery.rows.map(r => r.table_name);
    diagnostics.results.tables = foundTables;

    console.log(`✅ Tablas encontradas: ${foundTables.join(', ')}`);

    if (foundTables.length < 3) {
      console.log('❌ FALTAN TABLAS CRÍTICAS');
      diagnostics.results.tables_status = 'missing_tables';
    } else {
      diagnostics.results.tables_status = 'complete';
    }

    // 4. Data Integrity
    console.log('\n4️⃣ Verificando integridad de datos...');

    const batchCount = await client.query('SELECT COUNT(*) as count FROM batches');
    const tokenCount = await client.query('SELECT COUNT(*) as count FROM tokens');
    const batchItemsCount = await client.query('SELECT COUNT(*) as count FROM batch_items');

    diagnostics.results.dataIntegrity = {
      batches: parseInt(batchCount.rows[0].count),
      tokens: parseInt(tokenCount.rows[0].count),
      batch_items: parseInt(batchItemsCount.rows[0].count)
    };

    console.log(`📊 Lotes: ${diagnostics.results.dataIntegrity.batches}`);
    console.log(`📊 Tokens: ${diagnostics.results.dataIntegrity.tokens}`);
    console.log(`📊 Relaciones: ${diagnostics.results.dataIntegrity.batch_items}`);

    // 5. Orphaned Records
    console.log('\n5️⃣ Buscando registros huérfanos...');

    const orphanedTokens = await client.query(`
      SELECT COUNT(*) as count
      FROM tokens t
      LEFT JOIN batch_items bi ON t.id = bi.token_id
      WHERE bi.token_id IS NULL
    `);

    const orphanedBatchItems = await client.query(`
      SELECT COUNT(*) as count
      FROM batch_items bi
      LEFT JOIN batches b ON bi.batch_id = b.id
      LEFT JOIN tokens t ON bi.token_id = t.id
      WHERE b.id IS NULL OR t.id IS NULL
    `);

    diagnostics.results.orphanedRecords = {
      tokens: parseInt(orphanedTokens.rows[0].count),
      batch_items: parseInt(orphanedBatchItems.rows[0].count)
    };

    if (diagnostics.results.orphanedRecords.tokens > 0) {
      console.log(`⚠️ Tokens huérfanos: ${diagnostics.results.orphanedRecords.tokens}`);
    } else {
      console.log('✅ No hay tokens huérfanos');
    }

    if (diagnostics.results.orphanedRecords.batch_items > 0) {
      console.log(`⚠️ Batch items huérfanos: ${diagnostics.results.orphanedRecords.batch_items}`);
    } else {
      console.log('✅ No hay batch items huérfanos');
    }

    // 6. Duplicate Tokens
    console.log('\n6️⃣ Verificando códigos duplicados...');

    const duplicates = await client.query(`
      SELECT token_code, COUNT(*) as count
      FROM tokens
      GROUP BY token_code
      HAVING COUNT(*) > 1
    `);

    diagnostics.results.duplicateTokens = duplicates.rows;

    if (duplicates.rows.length > 0) {
      console.log(`❌ Códigos duplicados encontrados: ${duplicates.rows.length}`);
      duplicates.rows.forEach(dup => {
        console.log(`   - ${dup.token_code}: ${dup.count} veces`);
      });
    } else {
      console.log('✅ No se encontraron códigos duplicados');
    }

    // 7. Token Generation Test
    console.log('\n7️⃣ Probando generación de tokens...');

    try {
      const testCodes = [];
      for (let i = 0; i < 5; i++) {
        const code = generateTokenCode('TEST', 6);
        testCodes.push(code);
      }

      const uniqueCodes = new Set(testCodes);
      diagnostics.results.tokenGeneration = {
        status: uniqueCodes.size === testCodes.length ? 'working' : 'duplicates',
        samples: testCodes,
        uniqueCount: uniqueCodes.size
      };

      if (uniqueCodes.size === testCodes.length) {
        console.log('✅ Generación de tokens funcionando correctamente');
        console.log(`   Muestras: ${testCodes.join(', ')}`);
      } else {
        console.log('❌ Generación de tokens produce duplicados');
      }

    } catch (genError) {
      console.log('❌ Error en generación de tokens:', genError.message);
      diagnostics.results.tokenGeneration = { status: 'failed', error: genError.message };
    }

    // 8. Recent Activity
    console.log('\n8️⃣ Actividad reciente...');

    const recentBatches = await client.query(`
      SELECT name, created_at 
      FROM batches 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    const recentClaims = await client.query(`
      SELECT token_code, claimed_at, status
      FROM tokens 
      WHERE status = 'claimed'
      ORDER BY claimed_at DESC 
      LIMIT 5
    `);

    diagnostics.results.recentActivity = {
      batches: recentBatches.rows,
      claims: recentClaims.rows
    };

    console.log(`📊 Últimos ${recentBatches.rows.length} lotes:`);
    recentBatches.rows.forEach(batch => {
      console.log(`   - ${batch.name} (${new Date(batch.created_at).toLocaleDateString()})`);
    });

    console.log(`📊 Últimos ${recentClaims.rows.length} tokens reclamados:`);
    recentClaims.rows.forEach(claim => {
      console.log(`   - ${claim.token_code} (${claim.claimed_at ? new Date(claim.claimed_at).toLocaleDateString() : 'unknown'})`);
    });

    // 9. Summary
    console.log('\n9️⃣ RESUMEN DEL DIAGNÓSTICO');
    console.log('='.repeat(30));

    const issues = [];

    if (diagnostics.results.tables_status !== 'complete') {
      issues.push('Faltan tablas críticas');
    }

    if (diagnostics.results.orphanedRecords.tokens > 0 || diagnostics.results.orphanedRecords.batch_items > 0) {
      issues.push('Registros huérfanos encontrados');
    }

    if (diagnostics.results.duplicateTokens.length > 0) {
      issues.push('Códigos de tokens duplicados');
    }

    if (diagnostics.results.tokenGeneration && diagnostics.results.tokenGeneration.status !== 'working') {
      issues.push('Problemas con generación de tokens');
    }

    if (issues.length === 0) {
      console.log('🎉 SISTEMA FUNCIONANDO PERFECTAMENTE');
      console.log('✅ Todos los checks pasaron exitosamente');
      diagnostics.results.overallStatus = 'healthy';
    } else {
      console.log('⚠️ PROBLEMAS ENCONTRADOS:');
      issues.forEach(issue => console.log(`   - ${issue}`));
      diagnostics.results.overallStatus = 'issues_found';
      diagnostics.results.issues = issues;
    }

    console.log(`\n📊 Estadísticas finales:`);
    console.log(`   - Lotes totales: ${diagnostics.results.dataIntegrity.batches}`);
    console.log(`   - Tokens totales: ${diagnostics.results.dataIntegrity.tokens}`);
    console.log(`   - Pool conexiones: ${diagnostics.results.poolStatus.total} total, ${diagnostics.results.poolStatus.idle} idle`);

    // Save results to file
    const fs = await import('fs');
    const reportFile = `diagnostics-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(diagnostics, null, 2));
    console.log(`\n💾 Reporte guardado en: ${reportFile}`);

  } catch (error) {
    console.error('\n❌ ERROR CRÍTICO EN DIAGNÓSTICOS:', error);
    console.error('❌ Stack trace:', error.stack);
    diagnostics.results.criticalError = {
      message: error.message,
      stack: error.stack
    };
    diagnostics.results.overallStatus = 'critical_failure';
  } finally {
    if (client) {
      client.release();
      console.log('📤 Database client released');
    }
  }

  return diagnostics;
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  runCompleteDiagnostics()
    .then(() => {
      console.log('\n✅ Diagnósticos completados');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error ejecutando diagnósticos:', error);
      process.exit(1);
    });
}

export { runCompleteDiagnostics };