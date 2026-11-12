import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function imageExtension(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return '';
}

// Storage is injected so upload and public retrieval use the same durable bucket.
export function createBioFlyerRouter(storage) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0 } });

  router.post('/admin/bio-flyers', (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Sign in to upload a photo.' });
    if (!req.session.user.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
    next();
  }, upload.single('image'), async (req, res) => {
    const extension = req.file && imageExtension(req.file.buffer);
    if (!extension) return res.status(400).json({ error: 'Choose a JPG, PNG, GIF or WebP photo.' });
    const filename = `${randomUUID()}.${extension}`;
    try {
      const result = await storage.uploadFromBytes(`bio-flyers/${filename}`, req.file.buffer);
      if (!result.ok) throw new Error('Storage rejected upload');
      res.status(201).json({ imageUrl: `/api/bio-flyers/${filename}` });
    } catch {
      res.status(503).json({ error: 'Photo could not be saved. Please try again.' });
    }
  });

  router.get('/bio-flyers/:filename', async (req, res) => {
    const match = /^([a-f0-9-]{36})\.(jpg|png|gif|webp)$/.exec(req.params.filename);
    if (!match) return res.sendStatus(404);
    try {
      const result = await storage.downloadAsBytes(`bio-flyers/${req.params.filename}`);
      if (!result.ok) return res.sendStatus(result.error?.statusCode === 404 ? 404 : 503);
      res.set({ 'Content-Type': TYPES[match[2]], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.send(result.value[0]);
    } catch {
      res.sendStatus(503);
    }
  });

  router.use((error, req, res, next) => {
    if (!(error instanceof multer.MulterError)) return next(error);
    res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 5 MB or smaller.' : 'Choose one photo only.' });
  });
  return router;
}
