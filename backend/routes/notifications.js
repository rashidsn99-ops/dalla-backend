const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { flexAuth } = require("../middleware/flexAuth");

// GET /api/notifications
router.get("/", flexAuth(), async (req, res) => {
  const r = await query(
    "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
    [req.user.id]
  );
  res.json({ notifs: r.rows });
});

// POST /api/notifications/read
router.post("/read", flexAuth(), async (req, res) => {
  await query("UPDATE notifications SET read=true WHERE user_id=$1", [req.user.id]);
  res.json({ ok: true });
});

// POST /api/notifications/send — cross-device: send to user by phone number
// targetPhone can be a phone number OR "admin" to broadcast to all admins
router.post("/send", async (req, res) => {
  const { targetPhone, msg, type, data } = req.body;
  if (!targetPhone || !msg) return res.status(400).json({ error: "targetPhone و msg مطلوبان" });

  let userIds = [];

  if (targetPhone === "admin") {
    // Send to all admin accounts
    const r = await query("SELECT id FROM users WHERE role='ADMIN'");
    userIds = r.rows.map(u => u.id);
  } else {
    const phone = String(targetPhone).replace(/\D/g, "");
    const r = await query(
      `SELECT id FROM users WHERE phone=$1 OR phone=$2 OR RIGHT(phone,8)=RIGHT($1,8) LIMIT 1`,
      [targetPhone, phone]
    );
    if (r.rowCount > 0) userIds = [r.rows[0].id];
  }

  if (userIds.length === 0) {
    return res.json({ ok: false, msg: "المستخدم غير مسجّل بعد" });
  }

  for (const uid of userIds) {
    await query(
      "INSERT INTO notifications(user_id, msg, type, data) VALUES ($1,$2,$3,$4)",
      [uid, msg, type || "info", data || null]
    );
  }
  res.json({ ok: true, sent: userIds.length });
});

module.exports = router;
