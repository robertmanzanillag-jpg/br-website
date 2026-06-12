
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

// Serve past_raves.json
router.get('/past_raves.json', async (req, res) => {
  try {
    const filePath = path.join(__dirname, '../public/data/past_raves.json');
    const data = await fs.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (error) {
    console.error('Error serving past_raves.json:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Serve latest_videos.json
router.get('/latest_videos.json', async (req, res) => {
  try {
    const filePath = path.join(__dirname, '../public/data/latest_videos.json');
    const data = await fs.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (error) {
    console.error('Error serving latest_videos.json:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

module.exports = router;
