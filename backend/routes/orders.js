const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { auth, role } = require("../middleware/auth");
const { flexAuth } = require("../middleware/flexAuth");

function baristaShiftStart() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Muscat" }));
  const base = new Date(now);
  base.setHours(6, 0, 0, 0);
  if (now.getHours() < 6) base.setDate(base.getDate() - 1);
  return base;
}

async function pushNotif(userId, msg, type = "info", data = null) {
  await query(
    "INSERT INTO notifications(user_id, msg, type, data) VALUES ($1,$2,$3,$4)",
    [userId, msg, type, data ? JSON.stringify(data) : null]
  );
}

// GET /api/orders — customer sees their own; staff/manager see their café's shift; admin sees all
router.get("/", flexAuth(), async (req, res) => {
  const { status } = req.query;
  let sql, params;

  if (req.user.role === "CUSTOMER") {
    sql = `SELECT o.*, c.name_ar AS cafe_name, c.slug AS cafe_slug, u.name AS customer_name, u.phone AS customer_phone
           FROM orders o JOIN cafes c ON c.id=o.cafe_id LEFT JOIN users u ON u.id=o.customer_id
           WHERE o.customer_id=$1 ORDER BY o.id DESC`;
    params = [req.user.id];
  } else if (req.user.role === "ADMIN") {
    sql = `SELECT o.*, c.name_ar AS cafe_name, c.slug AS cafe_slug, u.name AS customer_name, u.phone AS customer_phone
           FROM orders o JOIN cafes c ON c.id=o.cafe_id LEFT JOIN users u ON u.id=o.customer_id
           ORDER BY o.id DESC LIMIT 500`;
    params = [];
  } else {
    // STAFF / MANAGER — current shift only, scoped to their café
    const shiftStart = baristaShiftStart();
    sql = `SELECT o.*, c.name_ar AS cafe_name, c.slug AS cafe_slug, u.name AS customer_name, u.phone AS customer_phone
           FROM orders o JOIN cafes c ON c.id=o.cafe_id LEFT JOIN users u ON u.id=o.customer_id
           WHERE o.cafe_id=$1 AND o.created_at >= $2 ORDER BY o.id DESC`;
    params = [req.user.shopId, shiftStart];
  }

  const r = await query(sql, params);
  let rows = r.rows;
  if (status) {
    const statuses = status.split(",");
    rows = rows.filter(o => statuses.includes(o.status));
  }
  res.json({ count: rows.length, orders: rows });
});

// POST /api/orders — barista creates an order after scanning a QR / code
router.post("/", flexAuth("STAFF", "MANAGER", "ADMIN"), async (req, res) => {
  const { customerId, drink, size, price, cafeId, isGiftOrder, giftId } = req.body;
  const cafeRes = await query("SELECT id, name_ar FROM cafes WHERE slug=$1", [cafeId]);
  if (cafeRes.rowCount === 0) return res.status(404).json({ error: "الكوفي غير موجود" });

  const ins = await query(
    `INSERT INTO orders(customer_id, cafe_id, drink, size, price, barista_id, status, is_gift_order, gift_id)
     VALUES ($1,$2,$3,$4,$5,$6,'awaiting_confirm',$7,$8) RETURNING *`,
    [customerId || null, cafeRes.rows[0].id, drink, size, price || 0, req.user.id, !!isGiftOrder, giftId || null]
  );
  const order = ins.rows[0];

  if (customerId) {
    await pushNotif(customerId, `الباريستا سجّل: ${drink} ${size} — وافق أو ارفض`, "info", { orderId: order.id, type: "order_confirm" });
  }
  res.status(201).json({ order });
});

// PATCH /api/orders/:id/status — update order status (barista progresses it / customer confirms)
router.patch("/:id/status", flexAuth(), async (req, res) => {
  const { status } = req.body;
  const VALID = ["pending", "preparing", "ready", "completed", "cancelled", "awaiting_confirm"];
  if (!VALID.includes(status)) return res.status(400).json({ error: "حالة غير صحيحة" });

  const orderRes = await query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
  const order = orderRes.rows[0];
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

  const prevStatus = order.status;
  await query("UPDATE orders SET status=$1, updated_at=now() WHERE id=$2", [status, req.params.id]);

  if (status === "ready" && order.customer_id) {
    await pushNotif(order.customer_id, `طلبك جاهز! ${order.drink} ${order.size} ☕`, "success");
  }

  if (status === "completed" && prevStatus !== "completed" && order.customer_id) {
    // Deduct a cup from the most-recently-used active subscription at this café
    const subRes = await query(
      `SELECT * FROM subscriptions WHERE user_id=$1 AND cafe_id=$2 AND active=true AND cups>0
       ORDER BY start_date DESC LIMIT 1`,
      [order.customer_id, order.cafe_id]
    );
    if (subRes.rowCount > 0) {
      await query(
        "UPDATE subscriptions SET cups=cups-1, last_used_date=CURRENT_DATE WHERE id=$1",
        [subRes.rows[0].id]
      );
    }
    await pushNotif(order.customer_id, `تم تأكيد: ${order.drink} ${order.size} ☕`, "success");
  }

  if (status === "cancelled" && order.customer_id) {
    await pushNotif(order.customer_id, "تم إلغاء الطلب", "info");
  }

  const updated = await query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
  res.json({ order: updated.rows[0] });
});

module.exports = router;
