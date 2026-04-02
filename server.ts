import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Razorpay from "razorpay";
import bodyParser from "body-parser";
import crypto from "crypto";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(bodyParser.json());

  // --- Razorpay Initialization ---
  let razorpay: Razorpay | null = null;
  const getRazorpay = () => {
    if (!razorpay) {
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keyId || !keySecret) {
        console.warn("RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing. Razorpay will be unavailable.");
        return null;
      }
      razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return razorpay;
  };

  // --- API Routes ---

  // Create Razorpay Order
  app.post("/api/razorpay/order", async (req, res) => {
    const rzp = getRazorpay();
    if (!rzp) return res.status(503).json({ error: "Razorpay not configured" });

    const { amount, currency = "INR", receipt } = req.body;

    try {
      const order = await rzp.orders.create({
        amount: amount, // amount in smallest currency unit
        currency,
        receipt,
      });
      res.json(order);
    } catch (error) {
      console.error("Razorpay order error:", error);
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  // Verify Razorpay Payment
  app.post("/api/razorpay/verify", (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return res.status(503).json({ error: "Razorpay secret missing" });

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
    const generated_signature = hmac.digest("hex");

    if (generated_signature === razorpay_signature) {
      res.json({ status: "ok" });
    } else {
      res.status(400).json({ status: "failed" });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
