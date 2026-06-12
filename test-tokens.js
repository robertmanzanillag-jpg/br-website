
// Test script for Black Room Token System
// Run with: node test-tokens.js

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('🧪 Starting Black Room Token System Tests\n');

  try {
    // Test 1: Create a batch
    console.log('1️⃣ Testing batch creation...');
    const batchResponse = await fetch(`${API_BASE}/admin/tokens/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: 'T-Shirt',
        drop_name: 'Test Drop',
        variant: 'Test Variant',
        serial_from: 1,
        serial_to: 5,
        size: 'M',
        color: 'Black',
        image_url: 'https://example.com/test.jpg'
      })
    });

    if (batchResponse.ok) {
      const batchResult = await batchResponse.json();
      console.log(`✅ Batch created with ${batchResult.tokens_created} tokens`);
      console.log(`   Batch ID: ${batchResult.batch_id}`);
      console.log(`   Batch Name: ${batchResult.batch_name}\n`);
    } else {
      console.log(`❌ Batch creation failed: ${batchResponse.status}\n`);
    }

    // Test 2: Get stats
    console.log('2️⃣ Testing stats endpoint...');
    const statsResponse = await fetch(`${API_BASE}/admin/tokens/stats`);
    
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log(`✅ Stats retrieved:`);
      console.log(`   Total tokens: ${stats.total_tokens}`);
      console.log(`   Available: ${stats.available_tokens}`);
      console.log(`   Claimed: ${stats.claimed_tokens}\n`);
    } else {
      console.log(`❌ Stats failed: ${statsResponse.status}\n`);
    }

    // Test 3: Test token validation
    console.log('3️⃣ Testing token code validation...');
    const testCodes = [
      'VALID-CODE-123',
      'invalid-with-lowercase',
      'INVALID-WITH-I',
      'INVALID-WITH-O',
      'INVALID-WITH-1',
      'INVALID-WITH-0'
    ];

    testCodes.forEach(code => {
      const isValid = validateTokenCode(code);
      console.log(`   ${code}: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
    });

    console.log('\n🎉 Tests completed!');

  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

// Token validation function (copied from utils)
function validateTokenCode(code) {
  if (!code || typeof code !== 'string') return false;
  
  const normalized = code.trim().toUpperCase();
  const regex = /^[A-Z0-9-]{6,24}$/;
  
  return regex.test(normalized) && 
         !normalized.includes('I') && 
         !normalized.includes('O') && 
         !normalized.includes('1') && 
         !normalized.includes('0');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}
