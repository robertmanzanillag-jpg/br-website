import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();
const usersFile = path.join(__dirname, "../db/users.json");

router.post("/", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format." });
  }
  // Validate password has at least 8 characters
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  const dbDir = path.dirname(usersFile);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  let users = [];
  if (fs.existsSync(usersFile)) {
    try {
      users = JSON.parse(fs.readFileSync(usersFile, "utf8") || "[]");
    } catch (err) {
      console.error("Error reading users.json:", err);
      return res
        .status(500)
        .json({ message: "Internal error reading users" });
    }
  }
  // Check if user already exists
  const existingUser = users.find(user => user.email === email);
  if (existingUser) {
    return res.status(400).json({ message: 'User already exists.' });
  }
  users.push({ 
    name, 
    email: email.toLowerCase(), 
    password,
    createdAt: new Date().toISOString()
  });
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    console.error("Error writing users.json:", err);
    res.status(500).json({ message: "Internal error saving user" });
  }
});

export default router;