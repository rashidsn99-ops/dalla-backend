const express = require("express");
const bcrypt  = require("bcryptjs");
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

router.use(auth, role("ADMIN", "MANAGER"));

// GET /api/admin/stats — overview KPIs, scoped per role
router.get("/stats", async (req, res) => {
  const shiftStart = baristaShiftStart();
  const cafeFilter = req.user.role === "MANAGER" ? "AND o.cafe_id=$2" : "";
  const params = req.user.role === "MANAGER" ? [shiftStart, req.user.shopId] : [shiftStart];

  const todayOrders = await query(
    `SELECT * FROM orders o WHERE o.created_at >= $1 ${cafeFilter}`, params
  );
  const completed = todayOrders.rows.filter(o => o.status === "completed");
  const cupsByType = completed.reduce((acc, o) => {
    const k = (o.drink || "غير محدد") + (o.size ? ` (${o.size})` : "");
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const complaintsRes = await query(
    req.user.role === "MANAGER"
      ? "SELECT COUNT(*) FROM complaints WHERE status='open' AND cafe_id=$1"
      : "SELECT COUNT(*) FROM complaints WHERE status='open'",
    req.user.role === "MANAGER" ? [req.user.shopId] : []
  );

  const subsRes = await query(
    req.user.role === "MANAGER"
      ? "SELECT COUNT(*) FROM subscriptions WHERE active=true AND cups>0 AND cafe_id=$1"
      : "SELECT COUNT(*) FROM subscriptions WHERE active=true AND cups>0"
    ,
    req.user.role === "MANAGER" ? [req.user.shopId] : []
  );

  res.json({
    todayCups: completed.length,
    todayOrders: todayOrders.rowCount,
    totalComplaints: parseInt(complaintsRes.rows[0].count, 10),
    activeSubscribers: parseInt(subsRes.rows[0].count, 10),
    cupsByType,
  });
});

// GET /api/admin/subscribers — full subscriber list (admin: all, manager: own café)
router.get("/subscribers", async (req, res) => {
  const sql = req.user.role === "MANAGER"
    ? `SELECT s.*, u.name, u.phone, c.name_ar AS cafe_name, c.slug AS cafe_slug
       FROM subscriptions s JOIN users u ON u.id=s.user_id JOIN cafes c ON c.id=s.cafe_id
       WHERE s.active=true AND s.cups>0 AND s.cafe_id=$1 ORDER BY s.start_date DESC`
    : `SELECT s.*, u.name, u.phone, c.name_ar AS cafe_name, c.slug AS cafe_slug
       FROM subscriptions s JOIN users u ON u.id=s.user_id JOIN cafes c ON c.id=s.cafe_id
       WHERE s.active=true AND s.cups>0 ORDER BY s.start_date DESC`;
  const params = req.user.role === "MANAGER" ? [req.user.shopId] : [];
  const r = await query(sql, params);
  res.json({ total: r.rowCount, data: r.rows });
});

// GET /api/admin/orders — filterable order list (date range / café / drink)
router.get("/orders", async (req, res) => {
  const { from, to, cafeId, drink } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;

  if (req.user.role === "MANAGER") {
    conditions.push(`o.cafe_id = $${i++}`);
    params.push(req.user.shopId);
  } else if (cafeId) {
    const c = await query("SELECT id FROM cafes WHERE slug=$1", [cafeId]);
    if (c.rowCount > 0) { conditions.push(`o.cafe_id = $${i++}`); params.push(c.rows[0].id); }
  }
  if (drink) { conditions.push(`o.drink = $${i++}`); params.push(drink); }
  if (from) { conditions.push(`o.created_at::date >= $${i++}`); params.push(from); }
  if (to) { conditions.push(`o.created_at::date <= $${i++}`); params.push(to); }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const r = await query(
    `SELECT o.*, c.name_ar AS cafe_name, u.name AS customer_name
     FROM orders o JOIN cafes c ON c.id=o.cafe_id LEFT JOIN users u ON u.id=o.customer_id
     ${where} ORDER BY o.id DESC LIMIT 500`,
    params
  );
  res.json({ count: r.rowCount, orders: r.rows });
});

// POST /api/admin/staff — ADMIN creates STAFF/MANAGER accounts
router.post("/staff", flexAuth("ADMIN"), async (req, res) => {
  const { phone, name, pin, role: newRole, cafeId } = req.body;
  if (!pin || !["STAFF", "MANAGER", "ADMIN"].includes(newRole))
    return res.status(400).json({ error: "pin و role (STAFF|MANAGER|ADMIN) مطلوبة" });
  if (!name && !phone)
    return res.status(400).json({ error: "الاسم مطلوب" });

  // Auto-generate phone if not provided
  const finalPhone = phone || ("staff-" + Date.now() + "-" + Math.floor(Math.random()*9999));

  // Look up café by slug OR numeric id
  let shopDbId = null;
  if (cafeId) {
    const c = await query("SELECT id FROM cafes WHERE slug=$1 OR id=$2", [String(cafeId), parseInt(cafeId)||0]);
    shopDbId = c.rows[0]?.id || null;
  }

  const pinHash = await bcrypt.hash(String(pin), 10);
  const ins = await query(
    `INSERT INTO users(phone, name, role, pin_hash, shop_id) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (phone) DO UPDATE SET name=$2, role=$3, pin_hash=$4, shop_id=$5
     RETURNING id, phone, name, role, shop_id`,
    [finalPhone, name || finalPhone, newRole, pinHash, shopDbId]
  );
  res.status(201).json({ user: ins.rows[0] });
});

// GET /api/admin/users — list all staff/manager/admin users with their café
router.get("/users", flexAuth("ADMIN"), async (req, res) => {
  const r = await query(
    `SELECT u.id, u.name, u.phone, u.role, u.shop_id,
            c.name_ar AS cafe_name, c.slug AS cafe_slug
     FROM users u LEFT JOIN cafes c ON c.id = u.shop_id
     WHERE u.role IN ('ADMIN','MANAGER','STAFF')
     ORDER BY u.role, u.name`
  );
  res.json({ users: r.rows });
});

// PATCH /api/admin/users/:id — change PIN or name
router.patch("/users/:id", flexAuth("ADMIN"), async (req, res) => {
  const { pin, name } = req.body;
  const updates = [];
  const params = [];
  let i = 1;
  if (pin) {
    const hash = await bcrypt.hash(String(pin), 10);
    updates.push(`pin_hash=$${i++}`);
    params.push(hash);
  }
  if (name) { updates.push(`name=$${i++}`); params.push(name); }
  if (!updates.length) return res.status(400).json({ error: "لا يوجد شيء للتحديث" });
  params.push(req.params.id);
  const r = await query(
    `UPDATE users SET ${updates.join(", ")} WHERE id=$${i} RETURNING id, name, role`,
    params
  );
  res.json({ user: r.rows[0] });
});

// DELETE /api/admin/users/:id — remove a staff/manager account
router.delete("/users/:id", flexAuth("ADMIN"), async (req, res) => {
  await query("DELETE FROM users WHERE id=$1 AND role IN ('STAFF','MANAGER')", [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/slow-queries — last slow queries from pg_stat_statements
router.get("/slow-queries", flexAuth("ADMIN"), async (_req, res) => {
  try {
    // Try to get from pg_stat_statements if available
    const r = await query(`
      SELECT query, mean_exec_time::numeric(10,2) AS avg_ms, calls
      FROM pg_stat_statements
      WHERE mean_exec_time > 200
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `);
    res.json({ queries: r.rows });
  } catch {
    // pg_stat_statements not enabled — return placeholder
    res.json({ queries: [], msg: "تفعيل pg_stat_statements في قاعدة البيانات مطلوب لهذه الميزة" });
  }
});

// GET /api/admin/analytics — daily open/register/subscribe counts
router.get("/analytics", flexAuth("ADMIN"), async (_req, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Muscat" });
  const [newUsers, newSubs, openComplaints] = await Promise.all([
    query("SELECT COUNT(*) FROM users WHERE created_at::date = $1", [today]),
    query("SELECT COUNT(*) FROM subscriptions WHERE start_date::date = $1", [today]),
    query("SELECT COUNT(*) FROM complaints WHERE status='open'"),
  ]);
  res.json({
    newUsersToday: parseInt(newUsers.rows[0].count, 10),
    newSubsToday: parseInt(newSubs.rows[0].count, 10),
    openComplaints: parseInt(openComplaints.rows[0].count, 10),
  });
});

module.exports = router;
