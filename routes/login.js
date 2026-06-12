import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const usersFile = path.join(__dirname, "../db/users.json");
const JWT_SECRET = process.env.SESSION_SECRET || 'blackroom-secret-key-2024';

// POST login
router.post("/", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];

    // Find user by email or username
    const user = users.find(u => 
      u.email.toLowerCase() === username.toLowerCase() || 
      (u.username && u.username.toLowerCase() === username.toLowerCase())
    );

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Set session compatible with existing system
    req.session.userId = user.email;
    req.session.username = user.name || user.email;
    req.session.user = {
      id: user.email,
      email: user.email,
      name: user.name || user.email,
      fullName: user.fullName || user.name || user.email,
      username: user.email
    };

    // Save session explicitly and wait for completion
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      
      console.log('✅ Login successful - Session saved');
      console.log('📝 Session ID:', req.sessionID);
      console.log('📝 userId set to:', req.session.userId);
      console.log('📝 user.email set to:', req.session.user?.email);

      // Generate JWT token for localStorage auth (works without cookies)
      const token = jwt.sign(
        { userId: user.email, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      console.log('🔑 JWT token generated for:', user.email);

      // Return success with user data and token
      const { password: _, ...userData } = user;
      res.json({ 
        success: true, 
        message: "Login exitoso",
        token, // JWT token for localStorage
        user: {
          ...userData,
          name: userData.name || userData.fullName,
          fullName: userData.fullName || userData.name,
          username: userData.email
        }
      });
    });

  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

export default router;