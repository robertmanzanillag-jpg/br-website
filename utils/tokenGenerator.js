
// Alfabeto sin caracteres confusos (sin I, O, 1, 0)
const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePrefix(dropName, variant) {
  try {
    // Limpiar y normalizar strings - REMOVER caracteres confusos (I, O, 0, 1)
    const cleanDrop = (dropName || '').trim().toUpperCase()
      .replace(/[^A-Z0-9]/g, '')  // Remover caracteres especiales
      .replace(/[IO01]/g, '');     // Remover caracteres confusos
    const cleanVariant = (variant || '').trim().toUpperCase()
      .replace(/[^A-Z0-9]/g, '')  // Remover caracteres especiales
      .replace(/[IO01]/g, '');     // Remover caracteres confusos
    
    let prefix = '';
    
    // Tomar primeras 2 letras del drop (después de limpiar)
    if (cleanDrop.length >= 2) {
      prefix = cleanDrop.substring(0, 2);
    } else if (cleanDrop.length === 1) {
      prefix = cleanDrop + 'X';
    } else {
      prefix = 'BR'; // Black Room default
    }
    
    // Agregar separador y variant si existe
    if (cleanVariant && cleanVariant.length > 0) {
      const variantPart = cleanVariant.length >= 3 ? cleanVariant.substring(0, 3) : cleanVariant.padEnd(3, 'X');
      prefix += '-' + variantPart;
    } else {
      prefix += '-GEN'; // Generic
    }
    
    console.log(`🏷️ Generated prefix: "${prefix}" from drop:"${dropName}" variant:"${variant}"`);
    return prefix;
  } catch (error) {
    console.error('Error generating prefix:', error);
    return 'BR-ERR'; // Fallback
  }
}

export function generateTokenCode(prefix = 'BR', length = 6, retryCount = 0) {
  try {
    // Evitar bucles infinitos - máximo 5 reintentos
    if (retryCount > 5) {
      console.error(`❌ Failed to generate valid token after 5 retries. Prefix may contain invalid characters: ${prefix}`);
      throw new Error(`Token generation failed: prefix "${prefix}" contains invalid characters`);
    }
    
    // Validar inputs
    if (!prefix || typeof prefix !== 'string') {
      prefix = 'BR-GEN';
    }
    if (!length || length < 4 || length > 12) {
      length = 6;
    }
    
    // Generar código aleatorio
    let randomPart = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * SAFE_ALPHABET.length);
      randomPart += SAFE_ALPHABET[randomIndex];
    }
    
    const fullCode = `${prefix}-${randomPart}`;
    
    // Validar que el código generado sea válido
    if (!validateTokenCode(fullCode)) {
      console.warn(`⚠️ Generated invalid code: ${fullCode}, regenerating... (attempt ${retryCount + 1}/5)`);
      return generateTokenCode(prefix, length, retryCount + 1); // Retry con contador
    }
    
    console.log(`🎫 Generated token code: ${fullCode}`);
    return fullCode;
  } catch (error) {
    console.error('Error generating token code:', error);
    return `BR-ERR-${Date.now().toString(36).toUpperCase()}`;
  }
}

export function validateTokenCode(code) {
  try {
    if (!code || typeof code !== 'string') {
      return false;
    }
    
    // Limpiar espacios
    code = code.trim().toUpperCase();
    
    // Verificar longitud (entre 8 y 24 caracteres)
    if (code.length < 8 || code.length > 24) {
      console.log(`❌ Code length invalid: ${code.length}`);
      return false;
    }
    
    // Verificar formato básico (debe contener al menos un guión)
    if (!code.includes('-')) {
      console.log(`❌ Code missing separator: ${code}`);
      return false;
    }
    
    // Verificar caracteres permitidos (letras, números y guiones)
    const validChars = /^[A-Z0-9\-]+$/;
    if (!validChars.test(code)) {
      console.log(`❌ Code contains invalid characters: ${code}`);
      return false;
    }
    
    // Verificar que no tenga caracteres confusos
    const confusingChars = /[IO01]/;
    if (confusingChars.test(code)) {
      console.log(`❌ Code contains confusing characters (I,O,0,1): ${code}`);
      return false;
    }
    
    console.log(`✅ Code validation passed: ${code}`);
    return true;
  } catch (error) {
    console.error('Error validating token code:', error);
    return false;
  }
}

// Función para limpiar y normalizar códigos de input del usuario
export function normalizeTokenCode(inputCode) {
  if (!inputCode || typeof inputCode !== 'string') {
    return null;
  }
  
  return inputCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-]/g, '') // Remover caracteres no válidos
    .replace(/[IO01]/g, '') // Remover caracteres confusos
    .substring(0, 24); // Limitar longitud
}
