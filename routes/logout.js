
import express from 'express';

const router = express.Router();

// POST logout
router.post("/", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.status(500).json({ error: "Error al cerrar sesión" });
    }
    
    res.clearCookie('connect.sid'); // Clear the session cookie
    res.json({ success: true, message: "Logout exitoso" });
  });
});

export default router;
