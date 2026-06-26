/**
 * دلّة ☕ — Production Backend
 * Node.js + Express + PostgreSQL (Render)
 */
require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const { pool } = require("./db/pool");
const authRouter      = require("./routes/auth");
const cafesRouter      = require("./routes/cafes");
const subsRouter       = require("./routes/subscriptions");
const ordersRouter     = require("./routes/orders");
const redeemRouter     = require("./routes/redeem");
const complaintsRouter = require("./routes/complaints");
const giftsRouter       = require("./routes/gifts");
const codesRouter       = require("./routes/codes");
const offersRouter      = require("./routes/offers");
const adminRouter       = require("./routes/admin");
const notificationsRouter = require("./routes/notifications");

const app  = express();
const PORT = process.env.PORT || 4000;

// ══ MIDDLEWARE ══════════════════════════════════════════
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "5mb" })); // 5mb to allow base64 café images
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  if (!req.path.includes("/health"))
    console.log(`[${new Date().toLocaleTimeString("ar-OM")}] ${req.method} ${req.path}`);
  next();
});

// ══ SERVE FRONTEND ══════════════════════════════════════
app.get("/", (req, res) => {
  const htmlPath = path.join(__dirname, "..", "dalla-v3.html");
  if (fs.existsSync(htmlPath)) res.sendFile(htmlPath);
  else res.send("<h1>dalla-v3.html غير موجود</h1><p>ضعه بجانب مجلد backend/</p>");
});
app.get("/dalla-v3.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dalla-v3.html"));
});

// ══ PWA: manifest + service worker (يجب أن يُخدَّما من الجذر) ══
app.get("/manifest.json", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "manifest.json"));
});
app.get("/sw.js", (req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(__dirname, "..", "sw.js"));
});
// أيقونات التطبيق (ضعها في مجلد icons/ بجانب dalla-v3.html)
app.use("/icon-192.png", express.static(path.join(__dirname, "..", "icons", "icon-192.png")));
app.use("/icon-512.png", express.static(path.join(__dirname, "..", "icons", "icon-512.png")));
app.use("/icon-192-maskable.png", express.static(path.join(__dirname, "..", "icons", "icon-192-maskable.png")));
app.use("/icon-512-maskable.png", express.static(path.join(__dirname, "..", "icons", "icon-512-maskable.png")));

// ══ HEALTH CHECK (Render uses this to verify the service is alive) ══
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: "error", db: "disconnected", error: e.message });
  }
});

// ══ API ROUTES ══════════════════════════════════════════
app.use("/api/auth", authRouter);
app.use("/api/cafes", cafesRouter);
app.use("/api/subscriptions", subsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/redeem", redeemRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/gifts", giftsRouter);
app.use("/api/codes", codesRouter);
app.use("/api/offers", offersRouter);
app.use("/api/admin", adminRouter);
app.use("/api/notifications", notificationsRouter);

// ══ 404 & ERROR HANDLERS ════════════════════════════════
app.use((_req, res) => res.status(404).json({ error: "المسار غير موجود" }));
app.use((err, _req, res, _next) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: "خطأ في السيرفر" });
});

// ══ START (with DB connectivity check) ═════════════════
async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ تم الاتصال بقاعدة البيانات بنجاح");
  } catch (e) {
    console.error("❌ تعذّر الاتصال بقاعدة البيانات:", e.message);
    console.error("   تأكد من ضبط DATABASE_URL في متغيرات البيئة، ومن تشغيل schema.sql");
  }
  app.listen(PORT, () => {
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║   ☕  دلّة — Production Backend           ║");
    console.log(`║   🚀  http://localhost:${PORT}                 ║`);
    console.log("╚══════════════════════════════════════════╝\n");
  });
}

start();

// ══ KEEP-ALIVE: يمنع Render من إيقاف السيرفر بعد الخمول ══
// Render Free/Starter يوقف السيرفر بعد 15 دقيقة خمول
// هذا الـ ping الذاتي يبقيه مستيقظاً
if (process.env.RENDER_EXTERNAL_URL) {
  const PING_INTERVAL = 10 * 60 * 1000; // كل 10 دقائق
  setInterval(async () => {
    try {
      const url = process.env.RENDER_EXTERNAL_URL + '/health';
      const https = require('https');
      https.get(url, (res) => {
        console.log(`[Keep-Alive] ping → ${res.statusCode}`);
      }).on('error', () => {});
    } catch {}
  }, PING_INTERVAL);
  console.log('🔄 Keep-alive ping مفعّل كل 10 دقائق');
}
module.exports = app;
