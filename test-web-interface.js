
import fetch from 'node-fetch';

async function testWebInterface() {
  console.log('🌐 PRUEBA DE INTERFAZ WEB');
  console.log('='.repeat(50));

  const baseUrl = 'http://localhost:5000';

  try {
    // 1. Test admin tokens page
    console.log('\n1️⃣ PROBANDO PÁGINA ADMIN TOKENS...');
    const adminResponse = await fetch(`${baseUrl}/admin/tokens`);
    console.log(`📄 Admin page status: ${adminResponse.status}`);

    if (adminResponse.ok) {
      const adminHtml = await adminResponse.text();
      if (adminHtml.includes('TOKEN BATCHES')) {
        console.log('✅ Página admin carga correctamente');
      } else {
        console.log('⚠️ Página admin carga pero contenido incompleto');
      }
    }

    // 2. Test batches API
    console.log('\n2️⃣ PROBANDO API DE BATCHES...');
    const batchesResponse = await fetch(`${baseUrl}/admin/tokens/batches`);
    console.log(`📊 Batches API status: ${batchesResponse.status}`);

    if (batchesResponse.ok) {
      const batchesData = await batchesResponse.json();
      console.log(`✅ API devuelve ${Array.isArray(batchesData) ? batchesData.length : 0} batches`);
      
      if (Array.isArray(batchesData) && batchesData.length > 0) {
        const firstBatch = batchesData[0];
        console.log(`📦 Primer batch: ${firstBatch.name || 'Sin nombre'}`);
        console.log(`🖼️ Tiene imagen: ${firstBatch.image_url ? 'SÍ' : 'NO'}`);
      }
    } else {
      const errorText = await batchesResponse.text();
      console.log(`❌ Error en API: ${errorText}`);
    }

    // 3. Test diagnostic endpoint
    console.log('\n3️⃣ PROBANDO ENDPOINT DE DIAGNÓSTICO...');
    const diagnosticResponse = await fetch(`${baseUrl}/admin/tokens/diagnostic`);
    console.log(`🔧 Diagnostic status: ${diagnosticResponse.status}`);

    if (diagnosticResponse.ok) {
      const diagnosticData = await diagnosticResponse.json();
      console.log(`✅ Diagnóstico funcionando`);
      console.log(`   - DB Status: ${diagnosticData.database?.status || 'unknown'}`);
      console.log(`   - Response time: ${diagnosticData.responseTime || 'unknown'}ms`);
    } else {
      const errorText = await diagnosticResponse.text();
      console.log(`❌ Error en diagnóstico: ${errorText}`);
    }

    // 4. Test health endpoint
    console.log('\n4️⃣ PROBANDO ENDPOINT DE SALUD...');
    const healthResponse = await fetch(`${baseUrl}/admin/tokens/health`);
    console.log(`🏥 Health status: ${healthResponse.status}`);

    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log(`✅ Health check: ${healthData.status}`);
      console.log(`   - DB: ${healthData.checks?.database?.status || 'unknown'}`);
      console.log(`   - Batches: ${healthData.checks?.dataIntegrity?.batches || 0}`);
      console.log(`   - Tokens: ${healthData.checks?.dataIntegrity?.tokens || 0}`);
    }

    console.log('\n='.repeat(50));
    console.log('🎯 INTERFAZ WEB VERIFICADA');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ ERROR EN PRUEBA WEB:', error);
    console.log('\n💡 ASEGÚRATE DE QUE EL SERVIDOR ESTÉ EJECUTÁNDOSE:');
    console.log('   npm start o node index.js');
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testWebInterface();
}

export { testWebInterface };
