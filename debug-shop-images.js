
import pool from './database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function debugShopImages() {
  let client;
  try {
    console.log('🔍 DIAGNÓSTICO COMPLETO DE IMÁGENES EN SHOP');
    console.log('='.repeat(60));

    client = await pool.connect();

    // 1. Check batches with images
    console.log('\n1️⃣ VERIFICANDO LOTES CON IMÁGENES...');
    const batches = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.product,
        b.drop_name,
        b.variant,
        b.image_url,
        COUNT(bi.token_id) as token_count,
        COUNT(CASE WHEN t.status = 'claimed' THEN 1 END) as claimed_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.batch_id
      LEFT JOIN tokens t ON bi.token_id = t.id
      GROUP BY b.id, b.name, b.product, b.drop_name, b.variant, b.image_url
      ORDER BY b.created_at DESC
    `);

    console.log(`📋 Encontrados ${batches.rows.length} lotes:`);
    
    for (const batch of batches.rows) {
      console.log(`\n🎯 Lote ID: ${batch.id}`);
      console.log(`   Nombre: ${batch.name || 'N/A'}`);
      console.log(`   Producto: ${batch.product}`);
      console.log(`   Drop: ${batch.drop_name}`);
      console.log(`   Variante: ${batch.variant || 'N/A'}`);
      console.log(`   Tokens: ${batch.token_count} (${batch.claimed_count} reclamados)`);
      console.log(`   URL Original: ${batch.image_url || 'Sin imagen'}`);
      
      if (batch.image_url) {
        const url = batch.image_url.trim();
        
        if (url.startsWith('data:image/')) {
          console.log(`   ✅ Imagen Base64 (${url.length} caracteres)`);
        } else if (url.startsWith('http')) {
          console.log(`   🌐 URL Externa: ${url}`);
        } else if (url.startsWith('/api/storage/')) {
          console.log(`   📦 Ruta de API Storage: ${url}`);
        } else {
          // Procesar para Object Storage
          let cleanPath = url.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/|images\/)/, '');
          if (cleanPath && !cleanPath.includes('/')) {
            cleanPath = `batch-images/${cleanPath}`;
          }
          const processedUrl = `/api/storage/${cleanPath}`;
          console.log(`   🔄 Procesado para Storage: ${processedUrl}`);
        }
      }
    }

    // 2. Test products API endpoint
    console.log('\n2️⃣ PROBANDO ENDPOINT DE PRODUCTOS...');
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch('http://localhost:5000/api/products');
      
      if (response.ok) {
        const products = await response.json();
        console.log(`✅ API de productos funciona: ${products.length} productos`);
        
        const batchProducts = products.filter(p => p.source === 'batch');
        console.log(`📦 Productos de lotes: ${batchProducts.length}`);
        
        batchProducts.slice(0, 3).forEach(product => {
          console.log(`   - ${product.name}`);
          console.log(`     Imagen: ${product.image}`);
          console.log(`     Debug: ${JSON.stringify(product.debugInfo || {})}`);
        });
      } else {
        console.log(`❌ Error en API de productos: ${response.status}`);
      }
    } catch (apiError) {
      console.log(`❌ Error conectando a API: ${apiError.message}`);
    }

    // 3. Check file system images
    console.log('\n3️⃣ VERIFICANDO SISTEMA DE ARCHIVOS...');
    const publicImagesPath = path.join(__dirname, 'public', 'images');
    const logoPath = path.join(publicImagesPath, 'logo.png');
    
    if (fs.existsSync(logoPath)) {
      console.log(`✅ Logo por defecto existe: ${logoPath}`);
    } else {
      console.log(`❌ Logo por defecto NO existe: ${logoPath}`);
    }

    if (fs.existsSync(publicImagesPath)) {
      const imageFiles = fs.readdirSync(publicImagesPath);
      console.log(`📁 Archivos en /public/images: ${imageFiles.length}`);
      imageFiles.slice(0, 5).forEach(file => {
        console.log(`   - ${file}`);
      });
    }

    // 4. Test image storage endpoint
    console.log('\n4️⃣ PROBANDO ENDPOINT DE ALMACENAMIENTO...');
    try {
      const { default: fetch } = await import('node-fetch');
      const logoResponse = await fetch('http://localhost:5000/api/storage/images/logo.png');
      console.log(`📡 Respuesta del logo: ${logoResponse.status} ${logoResponse.statusText}`);
      
      if (logoResponse.ok) {
        const contentType = logoResponse.headers.get('content-type');
        console.log(`✅ Logo carga correctamente, tipo: ${contentType}`);
      }
    } catch (storageError) {
      console.log(`❌ Error en endpoint de almacenamiento: ${storageError.message}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ DIAGNÓSTICO COMPLETADO');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
  } finally {
    if (client) client.release();
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  debugShopImages();
}

export default debugShopImages;
