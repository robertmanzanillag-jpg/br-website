
import pool from './database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const usersFile = path.join(__dirname, "db/users.json");

async function fixTokenOwnership() {
  try {
    console.log('🔧 Fixing token ownership IDs...');
    
    // Cargar usuarios
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    console.log(`📋 Found ${users.length} users`);
    
    // Obtener todos los tokens reclamados
    const claimedTokens = await pool.query('SELECT * FROM tokens WHERE status = $1', ['claimed']);
    console.log(`🎟️ Found ${claimedTokens.rows.length} claimed tokens`);
    
    let updatedCount = 0;
    
    for (const token of claimedTokens.rows) {
      // Buscar usuario por email si owner_id es un email
      const user = users.find(u => u.email === token.owner_id);
      
      if (user) {
        // Generar ID numérico consistente
        const numericId = Math.abs(user.email.split('').reduce((a, b) => {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0));
        
        if (token.owner_id !== numericId) {
          await pool.query(
            'UPDATE tokens SET owner_id = $1 WHERE id = $2',
            [numericId, token.id]
          );
          
          console.log(`✅ Updated token ${token.token_code}: ${token.owner_id} → ${numericId}`);
          updatedCount++;
        }
      }
    }
    
    console.log(`🎉 Updated ${updatedCount} token ownership records`);
    
  } catch (error) {
    console.error('❌ Error fixing token ownership:', error);
  } finally {
    process.exit(0);
  }
}

fixTokenOwnership();
