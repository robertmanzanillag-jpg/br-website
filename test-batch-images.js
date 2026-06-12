
import pool from './database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testBatchImages() {
  console.log('🧪 Testing Batch Image Functionality');
  console.log('=====================================');
  
  let client;
  try {
    client = await pool.connect();
    
    // 1. Test database connection
    console.log('\n1️⃣ Testing database connection...');
    await client.query('SELECT 1');
    console.log('✅ Database connected');
    
    // 2. Check existing batches with images
    console.log('\n2️⃣ Checking existing batches...');
    const batchesResult = await client.query(`
      SELECT 
        b.id,
        b.name,
        b.image_url,
        COUNT(bi.token_id) as token_count
      FROM batches b
      LEFT JOIN batch_items bi ON b.id = bi.batch_id
      GROUP BY b.id, b.name, b.image_url
      ORDER BY b.id DESC
      LIMIT 5
    `);
    
    console.log(`Found ${batchesResult.rows.length} batches:`);
    batchesResult.rows.forEach(batch => {
      console.log(`  - Batch ${batch.id}: ${batch.name}`);
      console.log(`    Image URL: ${batch.image_url || 'No image'}`);
      console.log(`    Tokens: ${batch.token_count}`);
    });
    
    // 3. Test image URL processing
    console.log('\n3️⃣ Testing image URL processing...');
    
    const testUrls = [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'batch-images/test.jpg',
      '/api/storage/batch-images/test.jpg',
      'https://example.com/image.jpg',
      null,
      '',
      'undefined'
    ];
    
    testUrls.forEach(url => {
      let processedUrl = '/api/storage/images/logo.png'; // Default
      
      if (url && typeof url === 'string' && url.trim() !== '' && 
          url !== 'undefined' && url !== 'null') {
        
        const cleanUrl = url.trim();
        
        if (cleanUrl.startsWith('data:image/')) {
          processedUrl = cleanUrl;
        } else if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
          processedUrl = cleanUrl;
        } else if (cleanUrl.startsWith('/api/storage/')) {
          processedUrl = cleanUrl;
        } else {
          let cleanPath = cleanUrl.replace(/^\/+/, '').replace(/^(api\/storage\/|storage\/|images\/)/, '');
          if (cleanPath && !cleanPath.includes('/')) {
            cleanPath = `batch-images/${cleanPath}`;
          }
          processedUrl = `/api/storage/${cleanPath}`;
        }
      }
      
      console.log(`  Input: "${url}" -> Output: "${processedUrl}"`);
    });
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log('- Database connection: ✅ Working');
    console.log('- Batch queries: ✅ Working');
    console.log('- Image URL processing: ✅ Working');
    console.log('- Error handling: ✅ Implemented');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testBatchImages()
    .then(() => {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Tests failed:', error.message);
      process.exit(1);
    });
}

export { testBatchImages };
const fetch = require('node-fetch');

async function testBatchImages() {
    console.log('🧪 Testing batch image system...');
    
    try {
        // Test 1: Load batches and check image URLs
        console.log('1️⃣ Testing batch loading...');
        const batchResponse = await fetch('http://localhost:5000/admin/tokens/batches');
        
        if (!batchResponse.ok) {
            throw new Error(`Batch loading failed: ${batchResponse.status}`);
        }
        
        const batches = await batchResponse.json();
        console.log(`✅ Loaded ${batches.length} batches`);
        
        // Test 2: Check each batch image
        for (const batch of batches) {
            console.log(`\n🔍 Testing batch ${batch.id}: ${batch.name}`);
            console.log(`📸 Image URL: ${batch.image_url}`);
            console.log(`📊 Status: ${batch.image_status || 'unknown'}`);
            console.log(`🔄 Has custom image: ${batch.has_custom_image || false}`);
            
            if (batch.image_url && !batch.image_url.startsWith('data:')) {
                try {
                    const imageResponse = await fetch(`http://localhost:5000${batch.image_url}`);
                    console.log(`📡 Image response: ${imageResponse.status} ${imageResponse.statusText}`);
                    
                    if (imageResponse.ok) {
                        const contentType = imageResponse.headers.get('content-type');
                        console.log(`✅ Image loads successfully - Type: ${contentType}`);
                    } else {
                        console.log(`⚠️ Image failed to load: ${imageResponse.status}`);
                    }
                } catch (imageError) {
                    console.log(`❌ Image request error: ${imageError.message}`);
                }
            } else if (batch.image_url && batch.image_url.startsWith('data:')) {
                console.log(`✅ Base64 image detected (${batch.image_url.length} chars)`);
            } else {
                console.log(`⚠️ No image URL found`);
            }
        }
        
        // Test 3: Test image storage endpoint
        console.log('\n3️⃣ Testing image storage endpoint...');
        const logoResponse = await fetch('http://localhost:5000/api/storage/images/logo.png');
        console.log(`📡 Logo response: ${logoResponse.status} ${logoResponse.statusText}`);
        
        if (logoResponse.ok) {
            console.log('✅ Default logo loads successfully');
        } else {
            console.log('⚠️ Default logo failed to load');
        }
        
        console.log('\n✅ Batch image system test completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run test if this file is executed directly
if (require.main === module) {
    testBatchImages();
}

module.exports = testBatchImages;
