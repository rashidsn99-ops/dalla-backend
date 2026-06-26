const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { flexAuth } = require("../middleware/flexAuth");

// helper: notify user by id
async function pushNotif(userId, msg, type="warning") {
  await query(
    "INSERT INTO notifications(user_id, msg, type) VALUES ($1,$2,$3)",
    [userId, msg, type]
  );
}

// POST /api/complaints — PUBLIC
router.post("/", async (req, res) => {
  const { type, cafeId, details, fromName, fromPhone } = req.body;
  if (!type || !details) return res.status(400).json({ error: "نوع الشكوى والتفاصيل مطلوبان" });

  let cafeDbId = null;
  let fromUserId = null;
  let fromUserName = fromName || null;
  let fromUserPhone = fromPhone || null;

  // Get user from JWT if present
  try {
    const jwt = require("jsonwebtoken");
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-only-insecure-secret-change-me");
      fromUserId = decoded.id || null;
      // Fetch full user details for the complaint record
      if (fromUserId) {
        const ur = await query("SELECT name, phone FROM users WHERE id=$1", [fromUserId]);
        if (ur.rowCount > 0) {
          fromUserName = fromUserName || ur.rows[0].name;
          fromUserPhone = fromUserPhone || ur.rows[0].phone;
        }
      }
    }
  } catch {}

  // Find café by name or slug
  if (cafeId) {
    const c = await query("SELECT id FROM cafes WHERE slug=$1 OR name_ar=$1", [cafeId]);
    cafeDbId = c.rows[0]?.id || null;
  }

  const ins = await query(
    `INSERT INTO complaints(from_user_id, cafe_id, type, details) VALUES ($1,$2,$3,$4) RETURNING *`,
    [fromUserId, cafeDbId, type, details]
  );

  // ── Notify ALL admins immediately ──
  const admins = await query("SELECT id FROM users WHERE role='ADMIN'");
  const notifMsg = `📋 شكوى جديدة: ${type}${fromUserName ? " من " + fromUserName : ""}${fromUserPhone ? " (" + fromUserPhone + ")" : ""}`;
  for (const admin of admins.rows) {
    await pushNotif(admin.id, notifMsg, "warning");
  }

  // ── Notify manager of the specific café (if complaint is against one) ──
  if (cafeDbId) {
    const managers = await query(
      "SELECT id FROM users WHERE role='MANAGER' AND shop_id=$1",
      [cafeDbId]
    );
    for (const mgr of managers.rows) {
      await pushNotif(mgr.id, notifMsg, "warning");
    }
  }

  res.status(201).json({ complaint: ins.rows[0], message: "تم إرسال شكواك بنجاح" });
});

// GET /api/complaints — ADMIN sees all, MANAGER sees their café's
router.get("/", flexAuth("ADMIN", "MANAGER"), async (req, res) => {
  let sql, params;
  if (req.user.role === "MANAGER") {
    sql = `SELECT cm.id, cm.type, cm.details, cm.status, cm.created_at,
                  u.name AS from_name, u.phone AS from_phone,
                  c.name_ar AS cafe_name
           FROM complaints cm
           LEFT JOIN users u ON u.id = cm.from_user_id
           LEFT JOIN cafes c ON c.id = cm.cafe_id
           WHERE cm.cafe_id = $1
           ORDER BY cm.id DESC`;
    params = [req.user.shopId];
  } else {
    sql = `SELECT cm.id, cm.type, cm.details, cm.status, cm.created_at,
                  u.name AS from_name, u.phone AS from_phone,
                  c.name_ar AS cafe_name
           FROM complaints cm
           LEFT JOIN users u ON u.id = cm.from_user_id
           LEFT JOIN cafes c ON c.id = cm.cafe_id
           ORDER BY cm.id DESC`;
    params = [];
  }
  const r = await query(sql, params);
  res.json({ count: r.rowCount, complaints: r.rows });
});

module.exports = router;
