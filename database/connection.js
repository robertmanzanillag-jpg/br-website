import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased from 2000ms to 10000ms
  acquireTimeoutMillis: 60000,
  createTimeoutMillis: 30000,
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 200,
});

// Handle pool errors to prevent crashes
pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
  // Don't exit process, just log the error
});

pool.on('connect', () => {
  console.log('✅ Database client connected');
});

pool.on('remove', () => {
  console.log('📤 Database client removed');
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error acquiring client', err.stack);
    return;
  }
  console.log('✅ Database pool connected successfully');
  if (client) {
    release();
  }
});

// Función helper para ejecutar queries con retry
export async function queryWithRetry(text, params, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query(text, params);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Query attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw lastError;
}

export default pool;