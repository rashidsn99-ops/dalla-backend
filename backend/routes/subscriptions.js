const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { auth, role } = require("../middleware/auth");
const { flexAuth } = require("../middleware/flexAuth");

function omanToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Muscat" });
}

// GET /api/subscriptions/me — all active subscriptions for the logged-in customer
router.get("/me", flexAuth("CUSTOMER"), async (req, res) => {
  const r = await query(
    `SELECT s.*, c.slug AS cafe_slug, c.name_ar AS cafe_name, c.color AS cafe_color
     FROM subscriptions s JOIN cafes c ON c.id = s.cafe_id
     WHERE s.user_id=$1 AND s.active=true AND s.cups > 0
     ORDER BY s.start_date DESC`,
    [req.user.id]
  );
  const today = omanToday();
  const subs = r.rows.map(s => ({
    id: s.id, cafeId: s.cafe_slug, cafeName: s.cafe_name,
    pkg: s.package_label, cups: s.cups, totalCups: s.total_cups,
    price1: s.price_first, priceR: s.price_renew,
    startDate: s.start_date, fromGift: s.from_gift,
    canRedeem: s.cups > 0 && (!s.last_used_date || s.last_used_date.toISOString?.().slice(0,10) !== today),
  }));
  res.json({ subscriptions: subs });
});

// POST /api/subscriptions — create a new subscription (purchase)
router.post("/", flexAuth("CUSTOMER"), async (req, res) => {
  const { cafeId, cafeName, pkg, cups, price1, priceR } = req.body;
  const cafeRes = await query("SELECT id FROM cafes WHERE slug=$1", [cafeId]);
  if (cafeRes.rowCount === 0) return res.status(404).json({ error: "الكوفي غير موجود" });

  const ins = await query(
    `INSERT INTO subscriptions(user_id, cafe_id, package_label, cups, total_cups, price_first, price_renew)
     VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING *`,
    [req.user.id, cafeRes.rows[0].id, pkg, cups, price1 || 0, priceR || 0]
  );
  res.status(201).json({ subscription: ins.rows[0] });
});

// GET /api/subscriptions/qr-token — get a redemption token for the day
router.get("/qr-token", flexAuth("CUSTOMER"), async (req, res) => {
  const { subscriptionId } = req.query;
  let subRes;
  if (subscriptionId) {
    subRes = await query("SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2 AND active=true", [subscriptionId, req.user.id]);
  } else {
    subRes = await query(
      "SELECT * FROM subscriptions WHERE user_id=$1 AND active=true AND cups>0 ORDER BY start_date DESC LIMIT 1",
      [req.user.id]
    );
  }
  const sub = subRes.rows[0];
  if (!sub) return res.status(400).json({ error: "لا يوجد اشتراك نشط" });
  if (sub.cups <= 0) return res.status(400).json({ error: "انتهت الأكواب" });

  const today = omanToday();
  if (sub.last_used_date && sub.last_used_date.toISOString?.().slice(0, 10) === today)
    return res.status(400).json({ error: "استخدمت كوبك اليومي" });

  res.json({ subscriptionId: sub.id, expiresInSeconds: 30 });
});

module.exports = router;
