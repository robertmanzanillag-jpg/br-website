
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const usersFile = path.join(__dirname, "../db/users.json");

// POST - Dar like a un video
router.post("/", (req, res) => {
  const userId = req.session?.userId;
  
  if (!userId) {
    return res.status(401).json({ message: 'Debe iniciar sesión para dar like' });
  }

  const { videoId, title } = req.body;
  
  if (!videoId) {
    return res.status(400).json({ message: 'videoId es requerido' });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const userIndex = users.findIndex(u => u.email === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Inicializar likes si no existe
    if (!users[userIndex].likes) {
      users[userIndex].likes = [];
    }

    // Verificar si ya tiene like
    const existingLikeIndex = users[userIndex].likes.findIndex(like => like.videoId === videoId);
    
    if (existingLikeIndex !== -1) {
      // Remover like (toggle)
      users[userIndex].likes.splice(existingLikeIndex, 1);
      fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
      console.log(`✅ Like removido para video ${videoId} por usuario ${userId}`);
      return res.json({ message: 'Like removido', liked: false });
    } else {
      // Agregar like
      users[userIndex].likes.push({
        videoId,
        title: title || 'Video Sin Título',
        likedAt: new Date().toISOString()
      });
      fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
      console.log(`✅ Like agregado para video ${videoId} por usuario ${userId}`);
      return res.json({ message: 'Like agregado', liked: true });
    }

  } catch (error) {
    console.error("Error managing like:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// GET - Obtener likes del usuario
router.get("/", (req, res) => {
  const userId = req.session?.userId;
  
  if (!userId) {
    return res.status(401).json({ message: 'Debe iniciar sesión' });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const user = users.find(u => u.email === userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const likes = user.likes || [];
    console.log(`✅ Devolviendo ${likes.length} likes para usuario ${userId}`);
    res.json(likes);

  } catch (error) {
    console.error("Error getting likes:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// GET - Verificar si un video específico tiene like del usuario
router.get("/check/:videoId", (req, res) => {
  const userId = req.session?.userId;
  const { videoId } = req.params;
  
  if (!userId) {
    return res.status(401).json({ message: 'Debe iniciar sesión' });
  }

  try {
    const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, "utf8")) : [];
    const user = users.find(u => u.email === userId);
    
    if (!user) {
      return res.json({ liked: false });
    }

    const likes = user.likes || [];
    const isLiked = likes.some(like => like.videoId === videoId);
    
    res.json({ liked: isLiked });

  } catch (error) {
    console.error("Error checking like:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

export default router;
