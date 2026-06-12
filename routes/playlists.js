
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const playlistsFile = path.join(__dirname, '../db/playlists.json');

// Helper functions
const readPlaylists = () => {
  if (!fs.existsSync(playlistsFile)) {
    fs.writeFileSync(playlistsFile, JSON.stringify([]));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(playlistsFile, 'utf8'));
  } catch (error) {
    console.error('Error reading playlists:', error);
    return [];
  }
};

const savePlaylists = (playlists) => {
  try {
    fs.writeFileSync(playlistsFile, JSON.stringify(playlists, null, 2));
  } catch (error) {
    console.error('Error saving playlists:', error);
  }
};

// Middleware para verificar autenticación
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Debes iniciar sesión' });
  }
  next();
};

// GET /api/playlists - Obtener todas las playlists del usuario
router.get('/', requireAuth, (req, res) => {
  try {
    const playlists = readPlaylists();
    const userPlaylists = playlists.filter(p => p.userId === req.session.user.email);
    
    console.log(`✅ Devolviendo ${userPlaylists.length} playlists para usuario ${req.session.user.email}`);
    console.log(`📁 IDs de playlists disponibles: ${userPlaylists.map(p => p.id).join(', ')}`);
    res.json(userPlaylists);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ error: 'Error al cargar playlists' });
  }
});

// POST /api/playlists - Crear nueva playlist
router.post('/', requireAuth, (req, res) => {
  try {
    const { name, description = '' } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'El nombre de la playlist es requerido' });
    }

    const playlists = readPlaylists();
    const newPlaylist = {
      id: Date.now().toString(),
      name: name.trim(),
      description: description.trim(),
      userId: req.session.user.email,
      videos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    playlists.push(newPlaylist);
    savePlaylists(playlists);

    console.log(`✅ Playlist creada: ${newPlaylist.name} por ${req.session.user.email}`);
    res.status(201).json(newPlaylist);
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ error: 'Error al crear playlist' });
  }
});

// PUT /api/playlists/:id - Editar playlist
router.put('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    const playlists = readPlaylists();
    const playlistIndex = playlists.findIndex(p => p.id === id && p.userId === req.session.user.email);
    
    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }

    if (name && name.trim() !== '') {
      playlists[playlistIndex].name = name.trim();
    }
    if (description !== undefined) {
      playlists[playlistIndex].description = description.trim();
    }
    playlists[playlistIndex].updatedAt = new Date().toISOString();

    savePlaylists(playlists);

    console.log(`✅ Playlist actualizada: ${playlists[playlistIndex].name}`);
    res.json(playlists[playlistIndex]);
  } catch (error) {
    console.error('Error updating playlist:', error);
    res.status(500).json({ error: 'Error al actualizar playlist' });
  }
});

// DELETE /api/playlists/:id - Eliminar playlist
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    
    const playlists = readPlaylists();
    const playlistIndex = playlists.findIndex(p => p.id === id && p.userId === req.session.user.email);
    
    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }

    const deletedPlaylist = playlists.splice(playlistIndex, 1)[0];
    savePlaylists(playlists);

    console.log(`✅ Playlist eliminada: ${deletedPlaylist.name}`);
    res.json({ message: 'Playlist eliminada exitosamente' });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ error: 'Error al eliminar playlist' });
  }
});

// POST /api/playlists/:id/videos - Agregar video a playlist
router.post('/:id/videos', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { videoId, title } = req.body;
    
    if (!videoId || !title) {
      return res.status(400).json({ error: 'videoId y title son requeridos' });
    }

    const playlists = readPlaylists();
    const playlistIndex = playlists.findIndex(p => p.id === id && p.userId === req.session.user.email);
    
    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }

    // Verificar si el video ya existe en la playlist
    const videoExists = playlists[playlistIndex].videos.some(v => v.videoId === videoId);
    if (videoExists) {
      return res.status(400).json({ error: 'El video ya está en esta playlist' });
    }

    const video = {
      videoId,
      title,
      addedAt: new Date().toISOString()
    };

    playlists[playlistIndex].videos.push(video);
    playlists[playlistIndex].updatedAt = new Date().toISOString();
    savePlaylists(playlists);

    console.log(`✅ Video ${title} agregado a playlist ${playlists[playlistIndex].name}`);
    res.json({ message: 'Video agregado a la playlist', playlist: playlists[playlistIndex] });
  } catch (error) {
    console.error('Error adding video to playlist:', error);
    res.status(500).json({ error: 'Error al agregar video a playlist' });
  }
});

// GET /api/playlists/:id - Obtener playlist específica
router.get('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    
    const playlists = readPlaylists();
    const playlist = playlists.find(p => p.id === id && p.userId === req.session.user.email);
    
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }

    console.log(`✅ Devolviendo playlist: ${playlist.name} con ${playlist.videos.length} videos`);
    res.json(playlist);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ error: 'Error al cargar la playlist' });
  }
});

// DELETE /api/playlists/:id/videos/:videoId - Remover video de playlist
router.delete('/:id/videos/:videoId', requireAuth, (req, res) => {
  try {
    const { id, videoId } = req.params;
    
    const playlists = readPlaylists();
    const playlistIndex = playlists.findIndex(p => p.id === id && p.userId === req.session.user.email);
    
    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }

    const videoIndex = playlists[playlistIndex].videos.findIndex(v => v.videoId === videoId);
    if (videoIndex === -1) {
      return res.status(404).json({ error: 'Video no encontrado en la playlist' });
    }

    const removedVideo = playlists[playlistIndex].videos.splice(videoIndex, 1)[0];
    playlists[playlistIndex].updatedAt = new Date().toISOString();
    savePlaylists(playlists);

    console.log(`✅ Video ${removedVideo.title} removido de playlist ${playlists[playlistIndex].name}`);
    res.json({ message: 'Video removido de la playlist' });
  } catch (error) {
    console.error('Error removing video from playlist:', error);
    res.status(500).json({ error: 'Error al remover video de playlist' });
  }
});

export default router;
