const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { auth, role } = require("../middleware/auth");
const { flexAuth } = require("../middleware/flexAuth");

// GET /api/offers/active — public, used by customer app to auto-apply discounts
router.get("/active", async (_req, res) => {
  const r = await query(
    `SELECT o.*, c.slug AS cafe_slug FROM offers o
     LEFT JOIN cafes c ON c.id = o.cafe_id
     WHERE o.active=true
       AND (o.starts_at IS NULL OR o.starts_at <= now())
       AND (o.ends_at IS NULL OR o.ends_at >= now())`
  );
  res.json({ offers: r.rows });
});

// GET /api/offers — ADMIN sees all offers (active and inactive)
router.get("/", flexAuth("ADMIN"), async (_req, res) => {
  const r = await query(
    `SELECT o.*, c.name_ar AS cafe_name FROM offers o LEFT JOIN cafes c ON c.id=o.cafe_id ORDER BY o.created_at DESC`
  );
  res.json({ offers: r.rows });
});

// POST /api/offers — ADMIN creates an offer
router.post("/", flexAuth("ADMIN"), async (req, res) => {
  const { title, pct, applyTo, cafeId, startsAt, endsAt } = req.body;
  if (!title || pct === undefined) return res.status(400).json({ error: "title و pct مطلوبان" });

  let cafeDbId = null;
  if (cafeId) {
    const c = await query("SELECT id FROM cafes WHERE slug=$1", [cafeId]);
    cafeDbId = c.rows[0]?.id || null;
  }

  const ins = await query(
    `INSERT INTO offers(title, pct, apply_to, cafe_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, pct, applyTo || "both", cafeDbId, startsAt || null, endsAt || null]
  );
  res.status(201).json({ offer: ins.rows[0] });
});

// DELETE /api/offers/:id — ADMIN removes an offer
router.delete("/:id", flexAuth("ADMIN"), async (req, res) => {
  await query("DELETE FROM offers WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// PATCH /api/offers/:id — edit an existing offer
router.patch("/:id", flexAuth("ADMIN"), async (req, res) => {
  const { title, pct, applyTo, cafeId, startsAt, endsAt, active } = req.body;
  const fields = [];
  const vals = [];
  let i = 1;
  if (title !== undefined) { fields.push(`title=$${i++}`); vals.push(title); }
  if (pct !== undefined) { fields.push(`pct=$${i++}`); vals.push(pct); }
  if (applyTo !== undefined) { fields.push(`apply_to=$${i++}`); vals.push(applyTo); }
  if (cafeId !== undefined) {
    let dbId = null;
    if (cafeId) {
      const c = await query("SELECT id FROM cafes WHERE slug=$1 OR id=$2", [String(cafeId), parseInt(cafeId)||0]);
      dbId = c.rows[0]?.id || null;
    }
    fields.push(`cafe_id=$${i++}`); vals.push(dbId);
  }
  if (startsAt !== undefined) { fields.push(`starts_at=$${i++}`); vals.push(startsAt || null); }
  if (endsAt !== undefined) { fields.push(`ends_at=$${i++}`); vals.push(endsAt || null); }
  if (active !== undefined) { fields.push(`active=$${i++}`); vals.push(active); }
  if (!fields.length) return res.status(400).json({ error: "لا يوجد شيء للتحديث" });
  vals.push(req.params.id);
  const r = await query(`UPDATE offers SET ${fields.join(",")} WHERE id=$${i} RETURNING *`, vals);
  res.json({ offer: r.rows[0] });
});

// DELETE /api/offers/:id
router.delete("/:id", flexAuth("ADMIN"), async (req, res) => {
  await query("DELETE FROM offers WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
