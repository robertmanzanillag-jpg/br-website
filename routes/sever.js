import express from "express";
import path from "path";
import fs from "fs";
import session from "express-session";
import Stripe from "stripe";
import registerRouter from "./routes/register.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2020-08-27",
});

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, "db", "users.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "clave-secreta-fuerte",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 86400000 },
  }),
);

// --- Registro de usuarios ---
app.use(registerRouter);

// --- Login ---
app.post("/api/login", (req, res) => {
  const { email, pass } = req.body;
  if (!email || !pass) {
    return res.status(400).json({ message: "Faltan credenciales" });
  }
  let users = [];
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8") || "[]");
  }
  const user = users.find((u) => u.email === email && u.pass === pass);
  if (!user) {
    return res.status(401).json({ message: "Email o contraseña inválidos" });
  }
  req.session.user = { name: user.name, email: user.email };
  res.json({ name: user.name });
});

// --- Logout ---
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Error al cerrar sesión" });
    res.clearCookie("connect.sid");
    res.json({ message: "Sesión cerrada" });
  });
});

// --- Stripe API para productos ---
app.get("/api/products", async (req, res) => {
  try {
    const products = await stripe.products.list({ active: true });
    const prices = await stripe.prices.list({ active: true });
    const catalog = products.data.map((product) => {
      const price = prices.data.find((p) => p.product === product.id);
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        image: product.images[0],
        price: price ? price.unit_amount / 100 : 0,
        currency: price ? price.currency : "usd",
      };
    });
    res.json(catalog);
  } catch (err) {
    console.error("Error al obtener productos:", err.message);
    res.status(500).json({ error: "Error al obtener productos" });
  }
});

// --- Stripe Checkout Session ---
app.post("/api/create-checkout-session", async (req, res) => {
  const { cart } = req.body;
  if (!Array.isArray(cart) || !cart.length) {
    return res.status(400).json({ error: "Carrito vacío" });
  }
  try {
    const line_items = cart.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: { name: item.name },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty,
    }));
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items,
      success_url: `https://${req.get("host")}/shop.html?success=true`,
      cancel_url: `https://${req.get("host")}/shop.html?canceled=true`,
    });
    res.json({ id: session.id });
  } catch (err) {
    console.error("Error en checkout:", err.message);
    res.status(500).json({ error: "No se pudo crear sesión de pago" });
  }
});

// 404 fallback
app.use((req, res) => res.status(404).send("Not Found"));

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
