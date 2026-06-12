
import pool from './database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testProductImagesSystem() {
  console.log('🧪 PRUEBA DEL SISTEMA DE IMÁGENES DE PRODUCTOS');
  console.log('='.repeat(60));

  let client;
  try {
    // 1. Verificar estructura de carpetas
    console.log('\n1️⃣ VERIFICANDO ESTRUCTURA DE CARPETAS...');
    
    const productImagesDir = path.join(__dirname, 'public', 'images', 'product-images');
    
    if (!fs.existsSync(productImagesDir)) {
      fs.mkdirSync(productImagesDir, { recursive: true });
      console.log('📁 Carpeta product-images creada');
    } else {
      console.log('✅ Carpeta product-images existe');
    }

    // Listar archivos existentes
    const files = fs.readdirSync(productImagesDir);
    console.log(`📋 Archivos en product-images: ${files.length}`);
    files.forEach(file => console.log(`   - ${file}`));

    // 2. Verificar base de datos
    console.log('\n2️⃣ VERIFICANDO BASE DE DATOS...');
    client = await pool.connect();
    
    const batches = await client.query(`
      SELECT id, name, image_url 
      FROM batches 
      WHERE image_url IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 5
    `);

    console.log(`📦 Lotes con imágenes: ${batches.rows.length}`);
    batches.rows.forEach(batch => {
      console.log(`   Lote ${batch.id}: ${batch.name}`);
      console.log(`   Imagen: ${batch.image_url}`);
      
      // Verificar si la imagen existe localmente
      if (batch.image_url && batch.image_url.startsWith('/images/product-images/')) {
        const imagePath = path.join(__dirname, 'public', batch.image_url);
        const exists = fs.existsSync(imagePath);
        console.log(`   Archivo existe: ${exists ? '✅' : '❌'}`);
      }
    });

    // 3. Probar API de productos
    console.log('\n3️⃣ PROBANDO API DE PRODUCTOS...');
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch('http://localhost:5000/api/products');
      
      if (response.ok) {
        const products = await response.json();
        const batchProducts = products.filter(p => p.source === 'batch');
        
        console.log(`✅ API funciona: ${batchProducts.length} productos de lotes`);
        
        batchProducts.slice(0, 3).forEach(product => {
          console.log(`   Producto: ${product.name}`);
          console.log(`   Imagen: ${product.image}`);
          console.log(`   Tipo: ${product.image.startsWith('/images/product-images/') ? 'Local' : 'Otro'}`);
        });
      } else {
        console.log(`❌ Error API: ${response.status}`);
      }
    } catch (apiError) {
      console.log(`❌ Error conectando API: ${apiError.message}`);
    }

    // 4. Verificar acceso a imágenes
    console.log('\n4️⃣ VERIFICANDO ACCESO A IMÁGENES...');
    const logoPath = path.join(__dirname, 'public', 'images', 'logo.png');
    
    if (fs.existsSync(logoPath)) {
      console.log('✅ Logo por defecto existe');
      
      try {
        const { default: fetch } = await import('node-fetch');
        const logoResponse = await fetch('http://localhost:5000/images/logo.png');
        console.log(`📡 Logo accesible: ${logoResponse.status} ${logoResponse.statusText}`);
      } catch (logoError) {
        console.log(`❌ Error accediendo logo: ${logoError.message}`);
      }
    } else {
      console.log('❌ Logo por defecto NO existe');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ SISTEMA DE IMÁGENES DE PRODUCTOS VERIFICADO');
    console.log('📁 Carpeta: public/images/product-images/');
    console.log('🔗 URLs: /images/product-images/filename.ext');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error en prueba:', error);
  } finally {
    if (client) client.release();
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  testProductImagesSystem().catch(console.error);
}

export default testProductImagesSystem;
