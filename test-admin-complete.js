import { Client } from '@replit/object-storage';
import { generateTokenCode } from './utils/tokenGenerator.js';

const objectStorage = new Client();

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:5000',
  testBatch: {
    product: 'T-Shirt',
    drop_name: 'Test Drop 2025',
    variant: 'Test Variant',
    serial_from: 2000,
    serial_to: 2005,
    size: 'M',
    color: 'Black'
  }
};

let testBatchId = null;
let testTokenCodes = [];

const BASE_URL = TEST_CONFIG.baseUrl; // Define BASE_URL

console.log('🧪 INICIANDO PRUEBA COMPLETA DEL SISTEMA DE TOKENS');
console.log('=' * 60);

// Test 1: Database Connection
async function testDatabaseConnection() {
  console.log('\n1️⃣ VERIFICANDO CONEXIÓN A BASE DE DATOS...');
  try {
    const { default: pool } = await import('./database/connection.js');
    const client = await pool.connect();

    const result = await client.query('SELECT NOW() as current_time');
    console.log(`✅ Base de datos conectada: ${result.rows[0].current_time}`);

    // Check tables exist
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('tokens', 'batches', 'batch_items')
    `);

    const tableNames = tables.rows.map(row => row.table_name);
    console.log(`✅ Tablas encontradas: ${tableNames.join(', ')}`);

    if (tableNames.length !== 3) {
      throw new Error(`Faltan tablas. Encontradas: ${tableNames.length}/3`);
    }

    client.release();
    return true;
  } catch (error) {
    console.error(`❌ Error de conexión: ${error.message}`);
    return false;
  }
}

// Test 2: Token Code Generation
async function testTokenGeneration() {
  console.log('\n2️⃣ PROBANDO GENERACIÓN DE CÓDIGOS...');
  try {
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const code = generateTokenCode('TEST', 6);
      codes.push(code);
      console.log(`✅ Código generado: ${code}`);
    }

    // Check uniqueness
    const uniqueCodes = new Set(codes);
    if (uniqueCodes.size !== codes.length) {
      throw new Error('Se generaron códigos duplicados');
    }

    console.log(`✅ ${codes.length} códigos únicos generados exitosamente`);
    return true;
  } catch (error) {
    console.error(`❌ Error en generación: ${error.message}`);
    return false;
  }
}

// Test 3: Create Test Batch
async function createTestBatch(batchData) {
  try {
    const response = await fetch(`${BASE_URL}/admin/tokens/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchData)
    });

    if (!response.ok) {
      let errorText = 'Unknown error';
      try {
        const errorJson = await response.json();
        errorText = errorJson.error || errorJson.details || response.statusText;
      } catch (e) {
        errorText = response.statusText;
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`🔍 Batch creation response:`, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error(`❌ Error en petición:`, error);
    throw error;
  }
}


// Test 4: Verify Batch Data
async function verifyBatchData() {
  console.log('\n4️⃣ VERIFICANDO DATOS DEL BATCH...');
  try {
    if (testBatchId) {
      const batchesResponse = await fetch(`${BASE_URL}/admin/tokens/batches`);

      if (!batchesResponse.ok) {
        throw new Error(`HTTP ${batchesResponse.status}: ${batchesResponse.statusText}`);
      }

      const batches = await batchesResponse.json();

      if (!Array.isArray(batches)) {
        throw new Error('Response is not an array of batches');
      }

      const createdBatch = batches.find(b => b.id === testBatchId);

      if (createdBatch) {
        testResults.verifyBatch = 'PASS';
        console.log(`✅ Batch encontrado en base de datos:`);
        console.log(`   - Nombre: ${createdBatch.name}`);
        console.log(`   - Total tokens: ${createdBatch.total_tokens}`);
        console.log(`   - Tokens disponibles: ${createdBatch.available_tokens}`);
      } else {
        testResults.verifyBatch = 'FAIL - Batch no encontrado';
        console.log(`❌ Error verificando batch: Batch no encontrado en base de datos`);
        console.log(`❌ Buscando ID: ${testBatchId} en ${batches.length} batches`);
      }
    } else {
      testResults.verifyBatch = 'FAIL - No batch ID';
      console.log(`❌ Error verificando batch: No hay ID de batch para verificar`);
    }
  } catch (error) {
    testResults.verifyBatch = 'FAIL';
    console.error('❌ Error verificando batch:', error.message);
  }
}

// Test 5: Export CSV
async function testCsvExport() {
  console.log('\n5️⃣ PROBANDO EXPORTACIÓN CSV...');
  try {
    if (testBatchId) {
      const csvResponse = await fetch(`${BASE_URL}/admin/tokens/batch/${testBatchId}/export.csv`);

      if (csvResponse.ok) {
        const csvContent = await csvResponse.text();
        if (csvContent.includes('serial,token_code') && csvContent.length > 100) {
          testResults.csvExport = 'PASS';
          console.log(`✅ CSV exportado correctamente (${csvContent.length} caracteres)`);
          console.log(`📄 CSV headers: ${csvContent.split('\n')[0]}`);
        } else {
          testResults.csvExport = 'FAIL - CSV content invalid';
          console.log(`❌ Error en exportación CSV: Contenido inválido (${csvContent.length} chars)`);
          console.log(`📄 CSV preview: ${csvContent.substring(0, 200)}...`);
        }
      } else {
        testResults.csvExport = 'FAIL';
        let errorText = '';
        try {
          errorText = await csvResponse.text();
        } catch (e) {
          errorText = 'Could not read error response';
        }
        console.log(`❌ Error en exportación CSV: HTTP ${csvResponse.status}: ${errorText}`);
      }
    } else {
      testResults.csvExport = 'FAIL - No batch ID';
      console.log(`❌ Error en exportación CSV: No hay ID de batch para exportar`);
    }
  } catch (error) {
    testResults.csvExport = 'FAIL';
    console.error('❌ Error en exportación CSV:', error.message);
  }
}

// Test 6: Test Token Claim Process
async function testTokenClaim() {
  console.log('\n6️⃣ PROBANDO PROCESO DE CLAIM...');
  try {
    if (testTokenCodes.length === 0) {
      throw new Error('No hay códigos de prueba disponibles');
    }

    const testCode = testTokenCodes[0];
    console.log(`🔍 Probando claim con código: ${testCode}`);

    // Test claim endpoint (without auth for now)
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/tokens/${testCode}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const tokenData = await response.json();
    console.log(`✅ Token encontrado:`);
    console.log(`   - Código: ${tokenData.token_code}`);
    console.log(`   - Producto: ${tokenData.product}`);
    console.log(`   - Serial: ${tokenData.serial}`);
    console.log(`   - Estado: ${tokenData.status}`);

    return true;
  } catch (error) {
    console.error(`❌ Error en claim: ${error.message}`);
    return false;
  }
}

// Test 7: Admin Panel Access
async function testAdminPanel() {
  console.log('\n7️⃣ PROBANDO ACCESO AL PANEL ADMIN...');
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/admin/tokens`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    if (!html.includes('Token System Admin') && !html.includes('admin-tokens')) {
      throw new Error('Panel admin no contiene elementos esperados');
    }

    console.log(`✅ Panel admin accesible y renderizando correctamente`);
    return true;
  } catch (error) {
    console.error(`❌ Error en panel admin: ${error.message}`);
    return false;
  }
}

// Test 8: Cleanup Test Data
async function cleanupTestData() {
  console.log('\n8️⃣ LIMPIANDO DATOS DE PRUEBA...');
  try {
    const { default: pool } = await import('./database/connection.js');
    const client = await pool.connect();

    if (testBatchId) {
      // Delete batch_items first (foreign key constraint)
      await client.query('DELETE FROM batch_items WHERE batch_id = $1', [testBatchId]);

      // Delete tokens
      const tokenIds = await client.query(`
        SELECT t.id FROM tokens t 
        WHERE t.token_code = ANY($1)
      `, [testTokenCodes]);

      for (const row of tokenIds.rows) {
        await client.query('DELETE FROM tokens WHERE id = $1', [row.id]);
      }

      // Delete batch
      await client.query('DELETE FROM batches WHERE id = $1', [testBatchId]);

      console.log(`✅ Datos de prueba limpiados exitosamente`);
      console.log(`   - Batch eliminado: ${testBatchId}`);
      console.log(`   - Tokens eliminados: ${testTokenCodes.length}`);
    }

    client.release();
    return true;
  } catch (error) {
    console.error(`❌ Error en limpieza: ${error.message}`);
    return false;
  }
}

// Main test execution
async function runAllTests() {
  const testResults = { // Initialize testResults
    databaseConnection: 'PENDING',
    tokenGeneration: 'PENDING',
    createBatch: 'PENDING',
    verifyBatch: 'PENDING',
    csvExport: 'PENDING',
    tokenClaim: 'PENDING',
    adminPanel: 'PENDING',
    cleanup: 'PENDING'
  };

  const tests = [
    { name: 'Database Connection', fn: testDatabaseConnection, resultKey: 'databaseConnection' },
    { name: 'Token Generation', fn: testTokenGeneration, resultKey: 'tokenGeneration' },
    { name: 'Create Test Batch', fn: async () => {
      const batchData = {
        product: 'T-Shirt',
        drop_name: 'Test Drop',
        variant: 'Black',
        serial_from: 2000,
        serial_to: 2005,
        size: 'M',
        color: 'Black',
        image_url: '/api/storage/images/logo.png'
      };
      try {
        const batchResponse = await createTestBatch(batchData);
        if (batchResponse && batchResponse.batch && batchResponse.batch.id) {
          testResults.createBatch = 'PASS';
          testBatchId = batchResponse.batch.id;
          testTokenCodes = batchResponse.tokens ? batchResponse.tokens.map(t => t.token_code) : [];
          console.log(`✅ Batch creado exitosamente:`);
          console.log(`   - ID: ${testBatchId}`);
          console.log(`   - Tokens generados: ${batchResponse.batch.tokens_created}`);
          console.log(`   - Seriales: ${batchResponse.batch.serial_range}`);
          return true;
        } else {
          testResults.createBatch = 'FAIL - Invalid response structure';
          console.log(`❌ Respuesta inválida:`, JSON.stringify(batchResponse, null, 2));
          return false;
        }
      } catch (error) {
        testResults.createBatch = 'FAIL';
        console.error('❌ Error creando batch:', error.message);
        return false;
      }
    }, resultKey: 'createBatch'},
    { name: 'Verify Batch Data', fn: async () => {
      try {
        if (testBatchId) {
          const batchesResponse = await fetch(`${BASE_URL}/admin/tokens/batches`);
          if (!batchesResponse.ok) {
            throw new Error(`HTTP ${batchesResponse.status}: ${batchesResponse.statusText}`);
          }
          const batches = await batchesResponse.json();
          if (!Array.isArray(batches)) {
            throw new Error('Response is not an array of batches');
          }
          const createdBatch = batches.find(b => b.id === testBatchId);
          if (createdBatch) {
            testResults.verifyBatch = 'PASS';
            console.log(`✅ Batch encontrado en base de datos:`);
            console.log(`   - Nombre: ${createdBatch.name}`);
            console.log(`   - Total tokens: ${createdBatch.total_tokens}`);
            console.log(`   - Tokens disponibles: ${createdBatch.available_tokens}`);
            return true;
          } else {
            testResults.verifyBatch = 'FAIL - Batch no encontrado';
            console.log(`❌ Error verificando batch: Batch no encontrado en base de datos`);
            console.log(`❌ Buscando ID: ${testBatchId} en ${batches.length} batches`);
            return false;
          }
        } else {
          testResults.verifyBatch = 'FAIL - No batch ID';
          console.log(`❌ Error verificando batch: No hay ID de batch para verificar`);
          return false;
        }
      } catch (error) {
        testResults.verifyBatch = 'FAIL';
        console.error('❌ Error verificando batch:', error.message);
        return false;
      }
    }, resultKey: 'verifyBatch'},
    { name: 'CSV Export', fn: async () => {
      try {
        if (testBatchId) {
          const csvResponse = await fetch(`${BASE_URL}/admin/tokens/batch/${testBatchId}/export.csv`);
          if (csvResponse.ok) {
            const csvContent = await csvResponse.text();
            if (csvContent.includes('serial,token_code') && csvContent.length > 100) {
              testResults.csvExport = 'PASS';
              console.log(`✅ CSV exportado correctamente (${csvContent.length} caracteres)`);
              console.log(`📄 CSV headers: ${csvContent.split('\n')[0]}`);
              return true;
            } else {
              testResults.csvExport = 'FAIL - CSV content invalid';
              console.log(`❌ Error en exportación CSV: Contenido inválido (${csvContent.length} chars)`);
              console.log(`📄 CSV preview: ${csvContent.substring(0, 200)}...`);
              return false;
            }
          } else {
            testResults.csvExport = 'FAIL';
            let errorText = '';
            try {
              errorText = await csvResponse.text();
            } catch (e) {
              errorText = 'Could not read error response';
            }
            console.log(`❌ Error en exportación CSV: HTTP ${csvResponse.status}: ${errorText}`);
            return false;
          }
        } else {
          testResults.csvExport = 'FAIL - No batch ID';
          console.log(`❌ Error en exportación CSV: No hay ID de batch para exportar`);
          return false;
        }
      } catch (error) {
        testResults.csvExport = 'FAIL';
        console.error('❌ Error en exportación CSV:', error.message);
        return false;
      }
    }, resultKey: 'csvExport'},
    { name: 'Token Claim', fn: testTokenClaim, resultKey: 'tokenClaim' },
    { name: 'Admin Panel', fn: testAdminPanel, resultKey: 'adminPanel' },
    { name: 'Cleanup', fn: cleanupTestData, resultKey: 'cleanup'}
  ];

  let passedTests = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passedTests++;
      }
    } catch (error) {
      console.error(`❌ Error inesperado en ${test.name}: ${error.message}`);
      testResults[test.resultKey] = 'FAIL'; // Ensure failure is recorded
    }
  }

  // Final report
  console.log('\n' + '='.repeat(60));
  console.log('📊 REPORTE FINAL DE PRUEBAS');
  console.log('='.repeat(60));

  for (const testName in testResults) {
    const status = testResults[testName] === 'PASS' ? '✅ PASS' : (testResults[testName] === 'FAIL' ? '❌ FAIL' : '🟠 PENDING');
    console.log(`${status} - ${testName.charAt(0).toUpperCase() + testName.slice(1).replace(/([A-Z])/g, ' $1')}`);
    // Error details are logged during the test execution
  }

  console.log('\n📈 RESUMEN:');
  console.log(`   - Pruebas exitosas: ${passedTests}/${tests.length}`);
  console.log(`   - Tasa de éxito: ${Math.round((passedTests/tests.length)*100)}%`);

  if (passedTests === tests.length) {
    console.log('\n🎉 ¡TODAS LAS PRUEBAS PASARON! Sistema completamente funcional.');
    console.log('\n✅ SISTEMA LISTO PARA PRODUCCIÓN');
    console.log('\nPróximos pasos recomendados:');
    console.log('1. Crear batch real con seriales de producción');
    console.log('2. Probar flujo completo de claim con usuario real');
    console.log('3. Verificar integración con sistema de autenticación');
    console.log('4. Probar exportación CSV con fulfillment');
  } else {
    console.log('\n⚠️ HAY PROBLEMAS QUE NECESITAN ATENCIÓN');
    console.log('\nPara arreglar los problemas, usa este prompt:');
    console.log('\n"Hay errores en el sistema de tokens. Por favor revisa y arregla los siguientes problemas:');

    for (const testName in testResults) {
      if (testResults[testName] === 'FAIL') {
        console.log(`- ${testName.charAt(0).toUpperCase() + testName.slice(1).replace(/([A-Z])/g, ' $1')}`);
      }
    }

    console.log('\nAsegúrate de que todas las tablas estén creadas, las consultas SQL sean correctas, y los endpoints respondan apropiadamente."');
  }
}

// Execute tests
runAllTests().catch(error => {
  console.error('❌ ERROR CRÍTICO EN PRUEBAS:', error);
  process.exit(1);
});