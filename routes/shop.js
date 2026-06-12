import { Router } from "express";
import Stripe from "stripe";
import fs from 'fs';
import path from 'path';

// Import database connection
let pool = null;
try {
  const dbModule = await import('../database/connection.js');
  pool = dbModule.default;
} catch (error) {
  console.warn('Database connection not available:', error.message);
}

// Helper function to process image URLs
function processImageUrl(imageUrl, batchId) {
  if (imageUrl) {
    // Example: If images are stored in a specific directory or have a pattern
    // For demonstration, let's assume a pattern or a simple return
    return imageUrl; 
  }
  // Fallback image if none provided
  return '/images/default-product.png';
}

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// crea la sesión de checkout
router.post("/create-checkout-session", async (req, res) => {
  const { cart } = req.body;
  if (!Array.isArray(cart) || !cart.length) {
    return res.status(400).json({ error: "Carrito vacío." });
  }

  const line_items = cart.map((item) => {
    // Build product name with model and size
    let productName = item.name;
    let details = [];
    
    if (item.model) details.push(`Model: ${item.model}`);
    if (item.size) details.push(`Size: ${item.size}`);
    
    if (details.length > 0) {
      productName = `${item.name} (${details.join(' | ')})`;
    }
    
    return {
      price_data: {
        currency: "usd",
        product_data: { 
          name: productName,
          description: details.length > 0 ? details.join(' - ') : undefined,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty,
    };
  });

  try {
    // Calculate total amount to determine available payment methods
    const totalAmount = line_items.reduce((sum, item) => {
      return sum + (item.price_data.unit_amount * item.quantity);
    }, 0);
    
    // Configure all available payment methods
    const paymentMethods = ["card", "link"]; // Always include cards and Link
    
    // Buy Now, Pay Later options (require minimum amounts)
    if (totalAmount >= 5000) { // $50 minimum for BNPL
      paymentMethods.push("affirm");
      paymentMethods.push("klarna");
      paymentMethods.push("afterpay_clearpay");
    }
    
    // Note: Apple Pay and Google Pay appear automatically in Stripe Checkout
    // when available on the user's device - no need to specify them explicitly

    console.log(`💰 Total amount: $${totalAmount/100}, Payment methods: ${paymentMethods.join(', ')}`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethods,
      line_items,
      mode: "payment",
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/shop.html`,
      phone_number_collection: {
        enabled: true,
      },
      payment_intent_data: {
        capture_method: 'automatic',
      },
    });
    res.json({ id: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products - Obtener todos los productos
router.get('/api/products', async (req, res) => {
  try {
    console.log('📦 Loading products from all sources...');

    // Cargar productos de JSON
    let products = [];
    const productsPath = path.join(__dirname, '../db/products.json');
    if (fs.existsSync(productsPath)) {
      products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
      console.log(`📄 Loaded ${products.length} products from JSON`);
    }

    // Cargar batches de la base de datos si está disponible
    let batchProducts = [];
    if (pool) {
      try {
        const client = await pool.connect();
      try {
        const batchResult = await client.query(`
          SELECT 
            b.id,
            b.name,
            b.product,
            b.drop_name,
            b.variant,
            b.image_url,
            COALESCE(b.price, 29.99) as price,
            'batch' as source,
            b.id as batch_id,
            COUNT(t.id) as total_tokens,
            COUNT(CASE WHEN t.status = 'available' THEN 1 END) as available_tokens
          FROM batches b
          LEFT JOIN batch_items bi ON b.id = bi.batch_id
          LEFT JOIN tokens t ON bi.token_id = t.id
          GROUP BY b.id, b.name, b.product, b.drop_name, b.variant, b.image_url, b.price
          ORDER BY b.id DESC
        `);

        console.log(`🏷️ Loaded ${batchResult.rows.length} batches from database`);

        batchProducts = batchResult.rows.map(batch => ({
          id: `batch_${batch.id}`,
          name: batch.variant ? `${batch.product} - ${batch.variant}` : batch.product,
          price: parseFloat(batch.price),
          description: `${batch.name} - Limited Edition`,
          image: processImageUrl(batch.image_url, batch.id),
          category: 'clothing',
          source: 'batch',
          batchId: batch.id,
          availableTokens: parseInt(batch.available_tokens),
          totalTokens: parseInt(batch.total_tokens),
          originalImageUrl: batch.image_url
        }));
      } finally {
        client.release();
      }
      } catch (dbError) {
        console.warn('Error loading batch products:', dbError.message);
      }
    }

    // Combinar productos
    const allProducts = [...products, ...batchProducts];
    console.log(`📦 Total products loaded: ${allProducts.length}`);
    console.log('🆔 Product IDs:', allProducts.map(p => ({ id: p.id, name: p.name })));

    res.json(allProducts);
  } catch (error) {
    console.error('❌ Error loading products:', error);
    res.status(500).json({ error: 'Error loading products', details: error.message });
  }
});

// Productos movidos a index.js para evitar duplicación

export default router;