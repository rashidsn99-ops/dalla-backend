const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { auth, role } = require("../middleware/auth");
const { flexAuth } = require("../middleware/flexAuth");

async function pushNotif(userId, msg, type = "info", data = null) {
  await query(
    "INSERT INTO notifications(user_id, msg, type, data) VALUES ($1,$2,$3,$4)",
    [userId, msg, type, data ? JSON.stringify(data) : null]
  );
}

// POST /api/codes/validate — checks code + enforces gift code phone ownership
router.post("/validate", async (req, res) => {
  const k = String(req.body.code || "").toUpperCase().trim();
  const requesterPhone = req.body.requesterPhone || null; // passed by frontend after login
  if (!k) return res.json({ ok: false, msg: "أدخل الكود" });

  const r = await query("SELECT * FROM discount_codes WHERE code=$1", [k]);
  const c = r.rows[0];
  if (!c || !c.active) return res.json({ ok: false, msg: "الكود غير صحيح أو غير نشط" });
  if (c.uses_limit > 0 && c.used_count >= c.uses_limit) return res.json({ ok: false, msg: "انتهى عدد استخدامات الكود" });
  if (c.expires_at && new Date(c.expires_at) < new Date()) return res.json({ ok: false, msg: "انتهت صلاحية الكود" });

  // ── Security: gift codes are ONLY usable by the linked phone number ──
  if (c.is_gift && c.gift_phone) {
    if (!requesterPhone) {
      return res.json({ ok: false, msg: "كود الهدية مخصص لرقم محدد — سجّل دخولك أولاً" });
    }
    const reqDigits = String(requesterPhone).replace(/\D/g, "").slice(-8);
    const giftDigits = String(c.gift_phone).replace(/\D/g, "").slice(-8);
    if (reqDigits !== giftDigits) {
      return res.json({ ok: false, msg: "هذا الكود مخصص لرقم آخر ولا يمكنك استخدامه" });
    }
  }

  res.json({
    ok: true,
    pct: c.pct,
    isGift: c.is_gift,
    giftPhone: c.gift_phone || null,
    applyTo: c.apply_to,
    msg: c.is_gift ? "كود هدية صالح ☕" : `خصم ${c.pct}%`
  });
});

// POST /api/codes/use — PUBLIC (mark code as used)
router.post("/use", async (req, res) => {
  const k = String(req.body.code || "").toUpperCase().trim();
  if (!k) return res.status(400).json({ error: "الكود مطلوب" });
  await query("UPDATE discount_codes SET used_count=used_count+1 WHERE code=$1", [k]);
  res.json({ ok: true });
});

// POST /api/codes — ADMIN creates a discount code OR a gift code
router.post("/", flexAuth("ADMIN"), async (req, res) => {
  const { code, pct, uses, exp, applyTo, isGift, giftPhone } = req.body;
  if (!code || pct === undefined) return res.status(400).json({ error: "code و pct مطلوبان" });

  const upperCode = code.toUpperCase().trim();
  await query(
    `INSERT INTO discount_codes(code, pct, uses_limit, active, expires_at, apply_to, is_gift, gift_phone)
     VALUES ($1,$2,$3,true,$4,$5,$6,$7)
     ON CONFLICT (code) DO UPDATE SET pct=$2, uses_limit=$3, active=true, expires_at=$4, apply_to=$5, is_gift=$6, gift_phone=$7`,
    [upperCode, pct, uses || 0, exp || null, applyTo || "both", !!isGift, giftPhone || null]
  );

  // If this is a gift code tied to a specific phone, notify only that person
  if (isGift && giftPhone) {
    const recipient = await query("SELECT id FROM users WHERE phone=$1", [String(giftPhone).replace(/\D/g, "")]);
    if (recipient.rowCount > 0) {
      await pushNotif(recipient.rows[0].id, "🎁 تم إهداؤك كود قهوة من دلّة — استخدمه من زر طلب جديد", "gift", { code: upperCode });
    }
  }

  res.status(201).json({ ok: true, code: upperCode });
});

// PATCH /api/codes/:code/toggle — ADMIN enables/disables a code
router.patch("/:code/toggle", flexAuth("ADMIN"), async (req, res) => {
  const k = req.params.code.toUpperCase();
  const r = await query("UPDATE discount_codes SET active = NOT active WHERE code=$1 RETURNING active", [k]);
  if (r.rowCount === 0) return res.status(404).json({ error: "الكود غير موجود" });
  res.json({ ok: true, active: r.rows[0].active });
});

// GET /api/codes — ADMIN lists all codes
router.get("/", flexAuth("ADMIN"), async (_req, res) => {
  const r = await query("SELECT * FROM discount_codes ORDER BY created_at DESC");
  res.json({ codes: r.rows });
});

module.exports = router;
