

import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Get all videos
router.get("/", async (req, res) => {
  try {
    const videosPath = path.join(process.cwd(), 'public', 'data', 'videos.json');
    
    try {
      const videosData = await fs.readFile(videosPath, 'utf8');
      const videos = JSON.parse(videosData);
      res.json(videos);
    } catch (fileError) {
      // Return fallback videos if file doesn't exist
      const fallbackVideos = [
        {
          id: "HVIwlYgXCok",
          title: "SCHWARZ - Industrial Techno Live Set | Black Room Miami",
          thumbnail: "https://i.ytimg.com/vi/HVIwlYgXCok/mqdefault.jpg"
        },
        {
          id: "7FrdvQCv1Uk", 
          title: "KATALINA - Melodic Techno Journey | Black Room Radio",
          thumbnail: "https://i.ytimg.com/vi/7FrdvQCv1Uk/mqdefault.jpg"
        },
        {
          id: "gSLsZo4qN14",
          title: "MVRPH - Acid Techno Set | Underground Series", 
          thumbnail: "https://i.ytimg.com/vi/gSLsZo4qN14/mqdefault.jpg"
        }
      ];
      res.json(fallbackVideos);
    }
  } catch (error) {
    console.error('Error loading videos:', error);
    res.status(500).json({ error: 'Error loading videos' });
  }
});

// Get latest videos
router.get("/latest", async (req, res) => {
  try {
    const latestPath = path.join(process.cwd(), 'public', 'data', 'latest_videos.json');
    
    try {
      const latestData = await fs.readFile(latestPath, 'utf8');
      const latest = JSON.parse(latestData);
      res.json(latest.videos || []);
    } catch (fileError) {
      // Return empty array if file doesn't exist
      res.json([]);
    }
  } catch (error) {
    console.error('Error loading latest videos:', error);
    res.status(500).json({ error: 'Error loading latest videos' });
  }
});

export default router;
