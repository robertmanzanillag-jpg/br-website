import { generateTokenCode } from './utils/tokenGenerator.js';

// Test function
async function testBatchCreation() {
  console.log('🧪 TESTING BATCH CREATION SYSTEM');
  console.log('='.repeat(50));

  let client;
  try {
    // Test database connection
    console.log('🔗 New database client connected');
    const { default: dbPool } = await import('./database/connection.js');
    console.log('📝 Database client acquired');

    const dbTest = await dbPool.connect();
    console.log('✅ Database connection established successfully');

    console.log(`📊 Pool status: Total: ${dbPool.totalCount}, Idle: ${dbPool.idleCount}, Waiting: ${dbPool.waitingCount}`);

    dbTest.release();
    console.log('📤 Database client released');

    // Now test batch creation
    client = await dbPool.connect();
    console.log('🔗 New database client connected');
    console.log('📝 Database client acquired');

    const testBatchData = {
      product: 'T-Shirt',
      drop_name: 'Test Drop',
      variant: 'Test Variant',
      serial_from: 1000,
      serial_to: 1005,
      size: 'M',
      color: 'Black',
      image_url: 'https://example.com/test.jpg'
    };

    console.log('1️⃣ Testing batch creation with data:', testBatchData);

    // Test basic query
    const queryTest = await client.query('SELECT NOW()');
    console.log('✅ Database query test successful:', queryTest.rows[0].now);
    console.log('✅ Test client released successfully');

    // Start transaction
    await client.query('BEGIN');

    try {
      // Create batch
      const batchResult = await client.query(`
        INSERT INTO batches (name, product, drop_name, variant, image_url, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, name
      `, [
        `${testBatchData.product} - ${testBatchData.drop_name} - ${testBatchData.variant} (${testBatchData.serial_from}-${testBatchData.serial_to}) [1x each]`,
        testBatchData.product,
        testBatchData.drop_name,
        testBatchData.variant,
        testBatchData.image_url
      ]);

      const batchId = batchResult.rows[0].id;
      const batchName = batchResult.rows[0].name;

      console.log('✅ Batch created with ID:', batchId);
      console.log('   Name:', batchName);

      // Generate prefix
      const prefix = `${testBatchData.drop_name.substring(0,2).toUpperCase()}-${testBatchData.variant.substring(0,2).toUpperCase()}`;
      console.log('🏷️ Using prefix:', prefix);

      // Create tokens
      const tokens = [];


      for (let serial = testBatchData.serial_from; serial <= testBatchData.serial_to; serial++) {
        const tokenCode = generateTokenCode(prefix, 6);

        const tokenResult = await client.query(`
          INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available', NOW())
          RETURNING id, token_code
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

        const tokenId = tokenResult.rows[0].id;

        // Create batch item relationship
        await client.query(`
          INSERT INTO batch_items (batch_id, token_id)
          VALUES ($1, $2)
        `, [batchId, tokenId]);

        tokens.push({
          serial,
          code: tokenCode
        });
      }

      console.log('✅ Created', tokens.length, 'tokens:');
      tokens.forEach(token => {
        console.log(`   - Serial ${token.serial}: ${token.code}`);
      });

      // Verify data integrity
      console.log('\n2️⃣ Verifying data integrity...');

      const batchCheck = await client.query('SELECT COUNT(*) as count FROM batches WHERE id = $1', [batchId]);
      const tokensCheck = await client.query('SELECT COUNT(*) as count FROM tokens WHERE id IN (SELECT token_id FROM batch_items WHERE batch_id = $1)', [batchId]);
      const batchItemsCheck = await client.query('SELECT COUNT(*) as count FROM batch_items WHERE batch_id = $1', [batchId]);

      console.log('✅ Batch record exists:', batchCheck.rows[0].count > 0);
      console.log('✅ All tokens created:', tokensCheck.rows[0].count == tokens.length);
      console.log('✅ All batch items created:', batchItemsCheck.rows[0].count == tokens.length);

      // Test uniqueness
      console.log('\n3️⃣ Testing token code uniqueness...');
      const duplicateCheck = await client.query(`
        SELECT token_code, COUNT(*) as count
        FROM tokens
        WHERE token_code = ANY($1::text[])
        GROUP BY token_code
        HAVING COUNT(*) > 1
      `, [tokens.map(t => t.code)]);

      if (duplicateCheck.rows.length > 0) {
        throw new Error(`Duplicate token codes found: ${duplicateCheck.rows.map(r => r.token_code).join(', ')}`);
      }
      console.log('✅ No duplicate token codes found');

      // Test batch consistency
      console.log('\n4️⃣ Testing batch consistency...');
      const consistencyCheck = await client.query(`
        SELECT 
          b.id as batch_id,
          COUNT(bi.token_id) as token_count,
          COUNT(DISTINCT t.serial) as unique_serials,
          MIN(t.serial) as min_serial,
          MAX(t.serial) as max_serial
        FROM batches b
        LEFT JOIN batch_items bi ON b.id = bi.batch_id
        LEFT JOIN tokens t ON bi.token_id = t.id
        WHERE b.id = $1
        GROUP BY b.id
      `, [batchId]);

      const consistency = consistencyCheck.rows[0];
      console.log(`📊 Consistency check results:`, {
        expected_tokens: tokens.length,
        actual_token_count: parseInt(consistency.token_count),
        unique_serials: parseInt(consistency.unique_serials),
        serial_range: `${consistency.min_serial}-${consistency.max_serial}`
      });

      const expectedTokenCount = parseInt(consistency.token_count);
      const expectedUniqueSerials = parseInt(consistency.unique_serials);
      
      if (expectedTokenCount !== tokens.length) {
        throw new Error(`Batch token count mismatch: expected ${tokens.length} tokens, got ${expectedTokenCount}`);
      }
      
      if (expectedUniqueSerials !== tokens.length) {
        throw new Error(`Batch serial count mismatch: expected ${tokens.length} unique serials, got ${expectedUniqueSerials}`);
      }
      
      console.log('✅ Batch consistency check passed');

      // Commit transaction
      await client.query('COMMIT');
      console.log('\n✅ Transaction committed successfully');

      console.log('\n🎉 BATCH CREATION TEST COMPLETED SUCCESSFULLY');
      console.log(`   - Batch ID: ${batchId}`);
      console.log(`   - Tokens created: ${tokens.length}`);
      console.log(`   - Serial range: ${testBatchData.serial_from}-${testBatchData.serial_to}`);
      console.log(`   - Prefix used: ${prefix}`);

      return {
        success: true,
        batchId: batchId.toString(),
        tokensCreated: tokens.length,
        tokens: tokens
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (client) {
      client.release();
      console.log('📤 Database client released');
    }
  }
}

// Run the test
testBatchCreation().then(result => {
  console.log('\n📊 Test Result:', result);
  process.exit(result.success ? 0 : 1);
}).catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});