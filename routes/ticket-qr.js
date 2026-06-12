
import express from 'express';
import QRCode from 'qrcode';

const router = express.Router();

// Generate QR code for ticket
router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!code) {
      return res.status(400).json({ error: "No ticket code provided" });
    }

    // Generate QR code as PNG
    const qrCodeBuffer = await QRCode.toBuffer(code, {
      type: 'png',
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.set('Content-Type', 'image/png');
    res.send(qrCodeBuffer);
  } catch (error) {
    console.error("Error generating QR code:", error);
    res.status(500).json({ error: "Error generating QR code" });
  }
});

export default router;
