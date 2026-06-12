import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Archivo de usuarios existente
const usersFile = path.join(__dirname, '../db/users.json');

// Middleware para requerir autenticación
export const requireAuth = async (req, res, next) => {
  const userId = req.session?.userId;

  if (!userId) {
    // Para peticiones API o cualquier método POST/PUT/DELETE/PATCH, devolver JSON
    if (req.path.startsWith('/api/') || req.method !== 'GET') {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'You must log in or create an account to continue',
        redirect: '/login.html?redirect=' + encodeURIComponent(req.originalUrl)
      });
    }
    return res.redirect('/login.html');
  }

  try {
    // Buscar usuario en users.json
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const user = users.find(u => u.email === userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Crear un ID numérico único basado en el email para consistencia con PostgreSQL
    const numericId = Math.abs(userId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0));

    // Adjuntar información del usuario a la request
    req.session.user = {
      id: numericId, // Usar ID numérico consistente
      email: user.email,
      username: user.fullName || user.name,
      name: user.fullName || user.name
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

// Rate limiting para claims
const claimAttempts = new Map();

export const rateLimitClaims = (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 5 * 60 * 1000; // 5 minutos
  const maxAttempts = 10;

  if (!claimAttempts.has(clientIp)) {
    claimAttempts.set(clientIp, []);
  }

  const attempts = claimAttempts.get(clientIp);
  const recentAttempts = attempts.filter(time => now - time < windowMs);

  if (recentAttempts.length >= maxAttempts) {
    return res.status(429).json({ 
      error: 'Too many claim attempts. Please try again later.' 
    });
  }

  recentAttempts.push(now);
  claimAttempts.set(clientIp, recentAttempts);

  next();
};

// Función para obtener usuario por ID
export const getUserById = async (userId) => {
  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];

    // Buscar por ID numérico o por email
    let user = users.find(u => {
      const numericId = Math.abs(u.email.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0));
      return numericId === userId || u.email === userId;
    });

    return user ? {
      id: userId,
      email: user.email,
      username: user.fullName || user.name,
      name: user.fullName || user.name
    } : null;
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
};