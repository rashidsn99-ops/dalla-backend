const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { flexAuth } = require("../middleware/flexAuth");

async function pushNotif(userId, msg, type = "info", data = null) {
  await query(
    "INSERT INTO notifications(user_id, msg, type, data) VALUES ($1,$2,$3,$4)",
    [userId, msg, type, data ? JSON.stringify(data) : null]
  );
}

// POST /api/gifts — send a gift (requires auth)
router.post("/", flexAuth(), async (req, res) => {
  const { toPhone, toName, anonymous, type, cafeId, cups, drink, size, amount, packageLabel } = req.body;
  if (!toPhone || !type) return res.status(400).json({ error: "toPhone و type مطلوبان" });

  const cafeRes = await query("SELECT id, name_ar FROM cafes WHERE slug=$1 OR id=$2",
    [cafeId, parseInt(cafeId)||0]);
  if (cafeRes.rowCount === 0) return res.status(404).json({ error: "الكوفي غير موجود" });

  const days = type === "pkg" ? 7 : 5;
  const expiresAt = new Date(Date.now() + days * 86400000);
  const fromDisplay = anonymous ? "مجهول" : (req.user?.name || req.user?.phone || "مجهول");

  const ins = await query(
    `INSERT INTO gifts(from_user_id, from_display, to_phone, to_name, anonymous, type, cafe_id,
      package_label, cups, drink, size, amount, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.user?.id || null, fromDisplay, toPhone, toName || null, !!anonymous, type,
     cafeRes.rows[0].id, packageLabel || null, cups || 1,
     drink || null, size || null, amount || 0, expiresAt]
  );
  const gift = ins.rows[0];

  // ── Notify recipient on their device ──
  // Try exact phone match and last-8-digits match
  const toPhoneDigits = String(toPhone).replace(/\D/g, "");
  const recipientRes = await query(
    `SELECT id FROM users WHERE
       phone = $1
       OR phone = $2
       OR RIGHT(REGEXP_REPLACE(phone,'\\D','','g'), 8) = RIGHT($2, 8)
     LIMIT 1`,
    [toPhone, toPhoneDigits]
  );

  if (recipientRes.rowCount > 0) {
    const recipId = recipientRes.rows[0].id;
    const msg = type === "pkg"
      ? `🎁 تم إهداؤك اشتراك ${packageLabel || ""} في ${cafeRes.rows[0].name_ar} — ${anonymous ? "من مجهول" : "من " + fromDisplay}`
      : `🎁 تم إهداؤك كوب قهوة في ${cafeRes.rows[0].name_ar} — ${anonymous ? "من مجهول" : "من " + fromDisplay}`;
    await pushNotif(recipId, msg, "gift", { giftId: gift.id });
  }

  res.status(201).json({ gift });
});

// GET /api/gifts/received — all pending gifts for the logged-in user
router.get("/received", flexAuth(), async (req, res) => {
  if (!req.user?.phone) return res.json({ gifts: [] });

  const phoneDigits = String(req.user.phone).replace(/\D/g, "");

  const r = await query(
    `SELECT g.*, c.name_ar AS cafe_name, c.slug AS cafe_slug, c.color AS cafe_color
     FROM gifts g JOIN cafes c ON c.id = g.cafe_id
     WHERE (
       g.to_phone = $1
       OR g.to_phone = $2
       OR RIGHT(REGEXP_REPLACE(g.to_phone,'\\D','','g'), 8) = RIGHT($2, 8)
     )
     AND g.status IN ('pending','activated')
     AND g.expires_at > now()
     ORDER BY g.created_at DESC`,
    [req.user.phone, phoneDigits]
  );
  res.json({ gifts: r.rows });
});

// POST /api/gifts/:id/activate — activate a subscription gift
router.post("/:id/activate", flexAuth(), async (req, res) => {
  const giftRes = await query(
    "SELECT * FROM gifts WHERE id=$1 AND type='pkg' AND status='pending'",
    [req.params.id]
  );
  const gift = giftRes.rows[0];
  if (!gift) return res.status(404).json({ error: "الهدية غير موجودة أو مُفعَّلة بالفعل" });
  if (new Date(gift.expires_at) < new Date()) return res.status(400).json({ error: "انتهت صلاحية الهدية" });

  const sub = await query(
    `INSERT INTO subscriptions(user_id, cafe_id, package_label, cups, total_cups, from_gift, gift_id)
     VALUES ($1,$2,$3,$4,$4,true,$5) RETURNING *`,
    [req.user?.id || 0, gift.cafe_id, gift.package_label, gift.cups, gift.id]
  );
  await query("UPDATE gifts SET status='activated' WHERE id=$1", [gift.id]);
  res.status(201).json({ subscription: sub.rows[0] });
});

module.exports = router;
