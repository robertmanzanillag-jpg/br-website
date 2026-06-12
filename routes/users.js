import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const usersFile = path.join(__dirname, "../db/users.json");

router.get("/", (req, res) => {
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    return res.json(users);
  } else {
    return res.json([]);
  }
});

export default router;