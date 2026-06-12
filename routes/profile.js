import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import pool from '../database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const usersFile = path.join(__dirname, "../db/users.json");
const JWT_SECRET = process.env.SESSION_SECRET || 'blackroom-secret-key-2024';

// Helper to get userId from session OR JWT token
function getUserId(req) {
  // First try session (cookie-based)
  if (req.session?.userId) {
    console.log('🍪 Auth via session cookie');
    return req.session.userId;
  }
  
  // Then try JWT token from Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('🔑 Auth via JWT token');
      return decoded.userId || decoded.email;
    } catch (err) {
      console.log('❌ Invalid JWT token:', err.message);
      return null;
    }
  }
  
  return null;
}

// GET profile data
router.get("/", (req, res) => {
  console.log('🍪 Profile - Cookies received:', req.headers.cookie || 'NONE');
  console.log('🔑 Profile - Auth header:', req.headers.authorization ? 'Bearer ***' : 'NONE');
  
  const userId = getUserId(req);
  console.log('👤 Profile - userId resolved:', userId || 'NONE');

  if (!userId) {
    console.log('❌ Profile: No auth (no session, no token)');
    return res.status(401).json({ authenticated: false, message: 'No autenticado' });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const user = users.find(u => u.email === userId); // userId is actually email in this system

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Return user data without password
    res.json({ 
      name: user.name,
      fullName: user.fullName || user.name,
      email: user.email,
      city: user.city || "",
      phone: user.phone || "",
      instagram: user.instagram || "",
      soundcloud: user.soundcloud || "",
      photo: user.photo || "",
      likes: user.likes || [],
      role: user.role || "user",
      authenticated: true 
    });
  } catch (error) {
    console.error("Error reading user profile:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// POST update profile (FormData from frontend)
router.post("/", (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ message: "No autenticado" });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const userIndex = users.findIndex(u => u.email === userId);

    if (userIndex === -1) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Update user data - frontend sends: name, city, website, instagram
    const { name, fullName, city, website, instagram, phone, soundcloud, photo } = req.body;

    if (name !== undefined) users[userIndex].name = name;
    if (fullName !== undefined) users[userIndex].fullName = fullName;
    if (city !== undefined) users[userIndex].city = city;
    if (website !== undefined) users[userIndex].website = website;
    if (instagram !== undefined) users[userIndex].instagram = instagram;
    if (phone !== undefined) users[userIndex].phone = phone;
    if (soundcloud !== undefined) users[userIndex].soundcloud = soundcloud;
    if (photo !== undefined) users[userIndex].photo = photo;

    // Save updated users
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    console.log(`✅ Profile updated for ${userId}`);
    res.json({ 
      message: "Perfil actualizado exitosamente",
      user: users[userIndex]
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// PUT update profile (alternative)
router.put("/", (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ message: "No autenticado" });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const userIndex = users.findIndex(u => u.email === userId);

    if (userIndex === -1) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Update user data
    const { name, fullName, city, website, instagram, phone, soundcloud, photo } = req.body;

    if (name !== undefined) users[userIndex].name = name;
    if (fullName !== undefined) users[userIndex].fullName = fullName;
    if (city !== undefined) users[userIndex].city = city;
    if (website !== undefined) users[userIndex].website = website;
    if (instagram !== undefined) users[userIndex].instagram = instagram;
    if (phone !== undefined) users[userIndex].phone = phone;
    if (soundcloud !== undefined) users[userIndex].soundcloud = soundcloud;
    if (photo !== undefined) users[userIndex].photo = photo;

    // Save updated users
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    console.log(`✅ Profile updated for ${userId}`);
    res.json({ 
      message: "Perfil actualizado exitosamente",
      user: users[userIndex]
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// GET user's claimed tokens
router.get("/tokens", async (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ message: "No autenticado" });
  }

  try {
    const result = await pool.query(`
      SELECT t.*
      FROM tokens t
      WHERE t.owner_id = $1
      ORDER BY t.claimed_at DESC
    `, [userId]);

    res.json({ tokens: result.rows });
  } catch (error) {
    console.error("Error fetching user tokens:", error);
    res.json({ tokens: [] });
  }
});

export default router;