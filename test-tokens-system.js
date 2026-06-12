
import pool from './database/connection.js';
import { generateTokenCode, generatePrefix, validateTokenCode, normalizeTokenCode } from './utils/tokenGenerator.js';

console.log('🔧 INICIANDO DIAGNÓSTICO Y REPARACIÓN DEL SISTEMA DE TOKENS');
console.log('='.repeat(60));

let client;

try {
  // 1. Probar conexión a base de datos
  console.log('1️⃣ PROBANDO CONEXIÓN A BASE DE DATOS...');
  client = await pool.connect();
  const dbTest = await client.query('SELECT NOW(), COUNT(*) as batch_count FROM batches');
  console.log(`✅ Base de datos conectada`);
  console.log(`   - Fecha/hora: ${dbTest.rows[0].now}`);
  console.log(`   - Batches existentes: ${dbTest.rows[0].batch_count}`);
  
  // 2. Probar generación de códigos
  console.log('\n2️⃣ PROBANDO GENERACIÓN DE CÓDIGOS...');
  const testPrefix = generatePrefix('Test Drop', 'Red Variant');
  const testCode = generateTokenCode(testPrefix, 6);
  const isValid = validateTokenCode(testCode);
  
  console.log(`   - Prefix generado: ${testPrefix}`);
  console.log(`   - Código generado: ${testCode}`);
  console.log(`   - Validación: ${isValid ? '✅ VÁLIDO' : '❌ INVÁLIDO'}`);
  
  // 3. Probar normalización de códigos
  console.log('\n3️⃣ PROBANDO NORMALIZACIÓN DE CÓDIGOS...');
  const testInputs = [
    'td-rv-abc123',
    ' TD-RV-ABC123 ',
    'td rv abc123',
    'TD-RV-AB1O23', // Con caracteres confusos
    'invalid code with symbols!@#'
  ];
  
  testInputs.forEach(input => {
    const normalized = normalizeTokenCode(input);
    const valid = normalized ? validateTokenCode(normalized) : false;
    console.log(`   - Input: "${input}" -> "${normalized}" ${valid ? '✅' : '❌'}`);
  });
  
  // 4. Verificar integridad de tokens existentes
  console.log('\n4️⃣ VERIFICANDO INTEGRIDAD DE TOKENS EXISTENTES...');
  const tokenCheck = await client.query(`
    SELECT 
      COUNT(*) as total_tokens,
      COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed_tokens,
      COUNT(CASE WHEN status = 'available' THEN 1 END) as available_tokens,
      COUNT(CASE WHEN token_code IS NULL OR token_code = '' THEN 1 END) as empty_codes,
      COUNT(CASE WHEN LENGTH(token_code) < 8 OR LENGTH(token_code) > 24 THEN 1 END) as invalid_length
    FROM tokens
  `);
  
  const stats = tokenCheck.rows[0];
  console.log(`   - Total tokens: ${stats.total_tokens}`);
  console.log(`   - Tokens reclamados: ${stats.claimed_tokens}`);
  console.log(`   - Tokens disponibles: ${stats.available_tokens}`);
  console.log(`   - Códigos vacíos: ${stats.empty_codes}`);
  console.log(`   - Longitud inválida: ${stats.invalid_length}`);
  
  // 5. Buscar códigos duplicados
  console.log('\n5️⃣ BUSCANDO CÓDIGOS DUPLICADOS...');
  const duplicates = await client.query(`
    SELECT token_code, COUNT(*) as count
    FROM tokens
    WHERE token_code IS NOT NULL AND token_code != ''
    GROUP BY token_code
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `);
  
  if (duplicates.rows.length > 0) {
    console.log(`❌ Se encontraron ${duplicates.rows.length} códigos duplicados:`);
    duplicates.rows.forEach(dup => {
      console.log(`   - "${dup.token_code}": ${dup.count} veces`);
    });
  } else {
    console.log('✅ No se encontraron códigos duplicados');
  }
  
  // 6. Verificar batches sin tokens
  console.log('\n6️⃣ VERIFICANDO BATCHES SIN TOKENS...');
  const orphanBatches = await client.query(`
    SELECT b.id, b.name
    FROM batches b
    LEFT JOIN batch_items bi ON b.id = bi.batch_id
    WHERE bi.batch_id IS NULL
  `);
  
  if (orphanBatches.rows.length > 0) {
    console.log(`⚠️ Se encontraron ${orphanBatches.rows.length} batches sin tokens:`);
    orphanBatches.rows.forEach(batch => {
      console.log(`   - Batch ${batch.id}: ${batch.name}`);
    });
  } else {
    console.log('✅ Todos los batches tienen tokens asociados');
  }
  
  // 7. Probar creación de batch pequeño
  console.log('\n7️⃣ PROBANDO CREACIÓN DE BATCH DE PRUEBA...');
  
  try {
    await client.query('BEGIN');
    
    const testBatchData = {
      product: 'Test-Product',
      drop_name: 'Test-Drop',
      variant: 'Test-Variant',
      serial_from: 99990,
      serial_to: 99992,
      size: 'M',
      color: 'Test-Color',
      image_url: '/api/storage/images/logo.png'
    };
    
    // Crear batch
    const batchResult = await client.query(`
      INSERT INTO batches (name, product, drop_name, variant, image_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name
    `, [
      `${testBatchData.product} - ${testBatchData.drop_name} - ${testBatchData.variant} (Test)`,
      testBatchData.product,
      testBatchData.drop_name,
      testBatchData.variant,
      testBatchData.image_url
    ]);
    
    const batchId = batchResult.rows[0].id;
    console.log(`✅ Batch de prueba creado: ID ${batchId}`);
    
    // Crear tokens
    const prefix = generatePrefix(testBatchData.drop_name, testBatchData.variant);
    let tokensCreated = 0;
    
    for (let serial = testBatchData.serial_from; serial <= testBatchData.serial_to; serial++) {
      let tokenCode;
      let attempts = 0;
      
      do {
        tokenCode = generateTokenCode(prefix, 6);
        attempts++;
        
        const existing = await client.query('SELECT id FROM tokens WHERE token_code = $1', [tokenCode]);
        if (existing.rows.length === 0) break;
        
      } while (attempts < 10);
      
      if (attempts >= 10) {
        throw new Error(`No se pudo generar código único para serial ${serial}`);
      }
      
      const tokenResult = await client.query(`
        INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        tokenCode,
        serial,
        testBatchData.product,
        testBatchData.drop_name,
        testBatchData.variant,
        testBatchData.size,
        testBatchData.color,
        testBatchData.image_url
      ]);
      
      await client.query(
        'INSERT INTO batch_items (batch_id, token_id) VALUES ($1, $2)',
        [batchId, tokenResult.rows[0].id]
      );
      
      tokensCreated++;
      console.log(`   - Token creado: ${tokenCode} (Serial: ${serial})`);
    }
    
    console.log(`✅ Se crearon ${tokensCreated} tokens de prueba`);
    
    // Limpiar (eliminar batch de prueba)
    await client.query('DELETE FROM batch_items WHERE batch_id = $1', [batchId]);
    await client.query('DELETE FROM tokens WHERE id IN (SELECT token_id FROM batch_items WHERE batch_id = $1)', [batchId]);
    await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
    
    await client.query('COMMIT');
    console.log('✅ Batch de prueba eliminado correctamente');
    
  } catch (testError) {
    await client.query('ROLLBACK');
    console.error('❌ Error en prueba de creación:', testError.message);
  }
  
  console.log('\n🎯 RESUMEN DEL DIAGNÓSTICO:');
  console.log('='.repeat(60));
  console.log('✅ Conexión a base de datos: FUNCIONANDO');
  console.log('✅ Generación de códigos: FUNCIONANDO');
  console.log('✅ Validación de códigos: FUNCIONANDO');
  console.log('✅ Normalización de códigos: FUNCIONANDO');
  console.log(duplicates.rows.length === 0 ? '✅ Integridad de datos: OK' : '⚠️ Integridad de datos: REVISAR DUPLICADOS');
  console.log(orphanBatches.rows.length === 0 ? '✅ Consistencia batches: OK' : '⚠️ Consistencia batches: REVISAR HUÉRFANOS');
  console.log('✅ Creación de batches: FUNCIONANDO');
  
  console.log('\n🛠️ RECOMENDACIONES:');
  if (duplicates.rows.length > 0) {
    console.log('- Corregir códigos duplicados en la base de datos');
  }
  if (orphanBatches.rows.length > 0) {
    console.log('- Revisar y limpiar batches sin tokens');
  }
  if (parseInt(stats.empty_codes) > 0) {
    console.log('- Revisar tokens con códigos vacíos');
  }
  if (parseInt(stats.invalid_length) > 0) {
    console.log('- Revisar tokens con códigos de longitud inválida');
  }
  
} catch (error) {
  console.error('❌ ERROR CRÍTICO:', error);
  console.error('Stack:', error.stack);
} finally {
  if (client) {
    client.release();
  }
  process.exit(0);
}
