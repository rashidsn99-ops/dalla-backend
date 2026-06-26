const express = require("express");
const bcrypt  = require("bcryptjs");
const router  = express.Router();
const { query } = require("../db/pool");
const { signToken } = require("../middleware/auth");

const OTP_TTL = parseInt(process.env.OTP_TTL_SECONDS || "60", 10);
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || "3", 10);

// POST /api/auth/otp/request — customer requests a login code
router.post("/otp/request", async (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !/^\d{6,15}$/.test(String(phone)))
    return res.status(400).json({ error: "رقم الهاتف غير صحيح" });

  const code = String(Math.floor(1000 + Math.random() * 9000));
  const expiresAt = new Date(Date.now() + OTP_TTL * 1000);

  await query(
    `INSERT INTO otp_codes(phone, code, attempts, expires_at) VALUES ($1,$2,0,$3)
     ON CONFLICT (phone) DO UPDATE SET code=$2, attempts=0, expires_at=$3`,
    [phone, code, expiresAt]
  );

  // Ensure a user row exists for this customer
  const existing = await query("SELECT id FROM users WHERE phone=$1", [phone]);
  if (existing.rowCount === 0) {
    await query(
      "INSERT INTO users(phone, name, role) VALUES ($1,$2,'CUSTOMER')",
      [phone, name || ("مستخدم " + phone)]
    );
  }

  // TODO: استبدل console.log بمزوّد SMS حقيقي (Twilio / Unifonic / Msegat)
  // راجع SMS_PROVIDER في .env
  console.log(`\n╔══════════════════════╗\n║ 📱 OTP: ${code}        ║\n║ للرقم: ${phone}\n╚══════════════════════╝\n`);

  res.json({ message: "تم إرسال رمز التحقق" });
});

// POST /api/auth/otp/verify
router.post("/otp/verify", async (req, res) => {
  const { phone, code, name } = req.body;
  const r = await query("SELECT * FROM otp_codes WHERE phone=$1", [phone]);
  const rec = r.rows[0];
  if (!rec) return res.status(400).json({ error: "لم يُطلب رمز لهذا الرقم" });
  if (new Date() > new Date(rec.expires_at)) return res.status(400).json({ error: "انتهت صلاحية الرمز" });
  if (rec.attempts >= OTP_MAX_ATTEMPTS) return res.status(400).json({ error: "تجاوزت عدد المحاولات" });
  if (rec.code !== String(code)) {
    await query("UPDATE otp_codes SET attempts=attempts+1 WHERE phone=$1", [phone]);
    return res.status(400).json({ error: "رمز خاطئ" });
  }

  await query("DELETE FROM otp_codes WHERE phone=$1", [phone]);

  let userRes = await query("SELECT * FROM users WHERE phone=$1", [phone]);
  let user = userRes.rows[0];
  if (!user) {
    const ins = await query(
      "INSERT INTO users(phone, name, role) VALUES ($1,$2,'CUSTOMER') RETURNING *",
      [phone, name || ("مستخدم " + phone)]
    );
    user = ins.rows[0];
  } else if (name && user.name !== name) {
    await query("UPDATE users SET name=$1 WHERE id=$2", [name, user.id]);
    user.name = name;
  }

  res.json({ token: signToken(user), user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
});

// POST /api/auth/staff/login — STAFF / MANAGER / ADMIN
router.post("/staff/login", async (req, res) => {
  const { phone, pin, name } = req.body;
  // Support login by name OR phone
  const identifier = phone || name;
  if (!identifier) return res.status(400).json({ error: "أدخل الاسم أو رقم الهاتف" });

  // Try exact phone match first, then name match
  let r = await query(
    "SELECT * FROM users WHERE phone=$1 AND role IN ('STAFF','MANAGER','ADMIN')",
    [identifier]
  );
  if (r.rowCount === 0) {
    r = await query(
      "SELECT * FROM users WHERE LOWER(name)=LOWER($1) AND role IN ('STAFF','MANAGER','ADMIN') LIMIT 1",
      [identifier]
    );
  }
  const user = r.rows[0];
  if (!user || !user.pin_hash) return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });

  const ok = await bcrypt.compare(String(pin || ""), user.pin_hash);
  if (!ok) return res.status(401).json({ error: "الرمز السري غير صحيح" });

  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, phone: user.phone, role: user.role, shopId: user.shop_id },
  });
});

// POST /api/auth/staff/create — ADMIN creates a STAFF/MANAGER/ADMIN account
// (protected — see admin.js router for the equivalent secured version;
//  this lightweight endpoint exists only for first-time bootstrap when no
//  admin account exists yet)
router.post("/bootstrap-admin", async (req, res) => {
  const adminCount = await query("SELECT COUNT(*) FROM users WHERE role='ADMIN'");
  if (parseInt(adminCount.rows[0].count, 10) > 0) {
    return res.status(403).json({ error: "يوجد حساب أدمن بالفعل — هذا المسار مخصص للإعداد الأول فقط" });
  }
  const { phone, name, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: "الهاتف والرمز السري مطلوبان" });
  const pinHash = await bcrypt.hash(String(pin), 10);
  const ins = await query(
    "INSERT INTO users(phone, name, role, pin_hash) VALUES ($1,$2,'ADMIN',$3) RETURNING *",
    [phone, name || "مدير المنصة", pinHash]
  );
  const user = ins.rows[0];
  res.status(201).json({ token: signToken(user), user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
});

// POST /api/auth/refresh — جدّد الـ token تلقائياً قبل انتهائه
// يُستدعى من الفرونت-إند كل فتح للتطبيق
router.post("/refresh", async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "لا يوجد token" });
  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-only-insecure-secret-change-me",
      { ignoreExpiration: true } // نقبل حتى المنتهي لنجدده
    );
    // تحقق أن المستخدم لا يزال موجوداً
    const { query } = require("../db/pool");
    const r = await query("SELECT * FROM users WHERE id=$1", [decoded.id]);
    if (r.rowCount === 0) return res.status(401).json({ error: "الحساب غير موجود" });
    const user = r.rows[0];
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role, shopId: user.shop_id }
    });
  } catch (e) {
    res.status(401).json({ error: "token غير صالح" });
  }
});

// GET /api/auth/me — تحقق من الجلسة الحالية (يستخدمه الفرونت-إند عند فتح التطبيق)
router.get("/me", async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "غير مسجّل" });
  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-only-insecure-secret-change-me");
    const { query } = require("../db/pool");
    const r = await query("SELECT id,name,phone,role,shop_id FROM users WHERE id=$1", [decoded.id]);
    if (r.rowCount === 0) return res.status(401).json({ error: "الحساب غير موجود" });
    const user = r.rows[0];
    res.json({ user: { id: user.id, name: user.name, phone: user.phone, role: user.role, shopId: user.shop_id } });
  } catch (e) {
    res.status(401).json({ error: "الجلسة منتهية" });
  }
});

module.exports = router;
