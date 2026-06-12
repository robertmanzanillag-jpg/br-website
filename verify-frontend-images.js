
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyFrontendImages() {
  console.log('🔍 VERIFICACIÓN DE IMÁGENES EN FRONTEND');
  console.log('='.repeat(50));

  console.log('\n1️⃣ Ejecutando diagnóstico de imágenes del shop...');
  
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('node', ['debug-shop-images.js'], {
        stdio: 'inherit',
        cwd: __dirname
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Diagnóstico falló con código ${code}`));
        }
      });
    });

    console.log('\n2️⃣ Ejecutando prueba completa del sistema...');
    
    await new Promise((resolve, reject) => {
      const child = spawn('node', ['test-complete-image-system.js'], {
        stdio: 'inherit',
        cwd: __dirname
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Prueba completa falló con código ${code}`));
        }
      });
    });

    console.log('\n' + '='.repeat(50));
    console.log('🎉 VERIFICACIÓN COMPLETADA');
    console.log('✅ Ahora deberías poder ver las imágenes de los batches');
    console.log('✅ Ve a /admin/tokens para ver los lotes');
    console.log('✅ Ve a /shop.html para ver los productos');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ Error en verificación:', error.message);
    process.exit(1);
  }
}

verifyFrontendImages();
