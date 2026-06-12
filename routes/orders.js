
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const ordersFile = path.join(__dirname, "../db/orders.json");

// GET user orders/tickets
router.get("/", (req, res) => {
  const userId = req.session?.userId;
  
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const orders = fs.existsSync(ordersFile) ? JSON.parse(fs.readFileSync(ordersFile, "utf8")) : [];
    
    // Filter orders for current user
    const userOrders = orders.filter(order => order.userId === userId);
    
    res.json(userOrders);
  } catch (error) {
    console.error("Error reading orders:", error);
    res.status(500).json({ error: "Server error reading orders" });
  }
});

export default router;
