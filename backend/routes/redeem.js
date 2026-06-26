const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { auth, role } = require("../middleware/auth");

function omanToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Muscat" });
}

// POST /api/redeem/scan — barista scans a code (subscription QR identity, or GIFT-xxx code)
router.post("/scan", auth, role("STAFF", "MANAGER", "ADMIN"), async (req, res) => {
  const { identity } = req.body; // decoded from the secure QR token, or a manually typed code
  if (!identity) return res.status(400).json({ error: "الرمز مطلوب" });
  const k = String(identity).trim();

  // Gift code path (admin-issued GIFT-XXXXXX or cup-gift GIFT-<id>)
  if (k.toUpperCase().startsWith("GIFT-")) {
    const giftPart = k.slice(5);

    // Cup gift created via GiftForm → identified by its numeric gifts.id
    if (/^\d+$/.test(giftPart)) {
      const giftRes = await query("SELECT g.*, c.name_ar AS cafe_name FROM gifts g LEFT JOIN cafes c ON c.id=g.cafe_id WHERE g.id=$1 AND g.type='cup'", [giftPart]);
      const gift = giftRes.rows[0];
      if (!gift) return res.json({ valid: false, msg: "الهدية غير موجودة" });
      if (gift.status !== "pending") return res.json({ valid: false, msg: "تم استخدام هذه الهدية مسبقاً" });
      if (new Date(gift.expires_at) < new Date()) return res.json({ valid: false, msg: "انتهت صلاحية الهدية" });
      return res.json({ valid: true, isGift: true, giftRecordId: gift.id, name: gift.to_name || "عميل", cups: 1 });
    }

    // Admin-issued discount-style gift code
    const codeRes = await query("SELECT * FROM discount_codes WHERE code=$1 AND is_gift=true", [k.toUpperCase()]);
    const code = codeRes.rows[0];
    if (!code) return res.json({ valid: false, msg: "كود الهدية غير صحيح" });
    if (!code.active || code.used_count >= 1) return res.json({ valid: false, msg: "كود الهدية مستخدم أو منتهي" });
    return res.json({ valid: true, isGift: true, giftCode: code.code, name: "صاحب " + code.gift_phone, cups: 1 });
  }

  // Regular subscriber identity (phone number, the QR's encoded identity)
  const userRes = await query("SELECT * FROM users WHERE phone=$1", [k]);
  const user = userRes.rows[0];
  if (!user) return res.json({ valid: false, msg: "المستخدم غير موجود في النظام" });

  const subRes = await query(
    "SELECT s.*, c.slug AS cafe_slug, c.name_ar AS cafe_name FROM subscriptions s JOIN cafes c ON c.id=s.cafe_id WHERE s.user_id=$1 AND s.active=true AND s.cups>0 ORDER BY s.start_date DESC",
    [user.id]
  );
  if (subRes.rowCount === 0) return res.json({ valid: false, msg: "لا يوجد اشتراك نشط", name: user.name });

  const today = omanToday();
  const usable = subRes.rows.find(s => !s.last_used_date || s.last_used_date.toISOString?.().slice(0, 10) !== today);
  if (!usable) return res.json({ valid: false, msg: "استُخدم الكوب اليومي — يتجدد منتصف الليل", name: user.name });

  res.json({
    valid: true, name: user.name, customerId: user.id,
    subscriptionId: usable.id, cups: usable.cups, cafeId: usable.cafe_slug, cafeName: usable.cafe_name,
  });
});

// POST /api/redeem/use — confirm a cup was consumed (called after customer approves the order)
router.post("/use", auth, role("STAFF", "MANAGER", "ADMIN"), async (req, res) => {
  const { subscriptionId, isGift, giftRecordId, giftCode } = req.body;

  if (isGift) {
    if (giftRecordId) {
      await query("UPDATE gifts SET status='used' WHERE id=$1", [giftRecordId]);
    } else if (giftCode) {
      await query("UPDATE discount_codes SET used_count=used_count+1, active=false WHERE code=$1", [giftCode]);
    }
    return res.json({ success: true, msg: "تم استخدام الهدية ☕" });
  }

  if (!subscriptionId) return res.status(400).json({ error: "subscriptionId مطلوب" });
  const subRes = await query(
    "UPDATE subscriptions SET cups=GREATEST(cups-1,0), last_used_date=CURRENT_DATE WHERE id=$1 RETURNING *",
    [subscriptionId]
  );
  if (subRes.rowCount === 0) return res.status(404).json({ error: "الاشتراك غير موجود" });
  res.json({ success: true, cupsRemaining: subRes.rows[0].cups, msg: "تم تأكيد الكوب ☕" });
});

module.exports = router;
