const express = require("express");
const router  = express.Router();
const { query } = require("../db/pool");
const { auth, role } = require("../middleware/auth");
const { flexAuth } = require("../middleware/flexAuth");

function makePkgs(avgCup) {
  const w = avgCup * 0.7;
  const p15_1 = Math.round(w * 15 * 0.8 * 10) / 10;
  const p15_r = Math.round(w * 15 * 10) / 10;
  const p30_1 = Math.round(w * 30 * 0.8 * 10) / 10;
  const p30_r = Math.round(w * 30 * 10) / 10;
  return [
    { label: "١٥ كوب", cups: 15, price_first: p15_1, price_renew: p15_r, popular: false },
    { label: "٣٠ كوب", cups: 30, price_first: p30_1, price_renew: p30_r, popular: true },
  ];
}

async function syncPackages(cafeId, avgCup) {
  await query("DELETE FROM packages WHERE cafe_id=$1", [cafeId]);
  const pkgs = makePkgs(avgCup);
  for (const p of pkgs) {
    await query(
      "INSERT INTO packages(cafe_id, label, cups, price_first, price_renew, popular) VALUES ($1,$2,$3,$4,$5,$6)",
      [cafeId, p.label, p.cups, p.price_first, p.price_renew, p.popular]
    );
  }
}

async function fullCafe(row) {
  const menu = await query("SELECT * FROM menu_items WHERE cafe_id=$1 AND active=true ORDER BY id", [row.id]);
  const pkgs = await query("SELECT * FROM packages WHERE cafe_id=$1 ORDER BY cups", [row.id]);
  return {
    id: row.slug,
    dbId: row.id,
    nameAr: row.name_ar,
    area: row.area,
    color: row.color,
    logo: row.logo,
    image: row.image_url,
    lat: row.lat,
    lng: row.lng,
    avgCup: parseFloat(row.avg_cup),
    popularity: row.popularity,
    featured: row.featured,
    menu: menu.rows.map(m => ({ id: m.id, name: m.name, sizes: m.sizes, price: parseFloat(m.price) })),
    pkgs: pkgs.rows.map(p => ({
      id: p.id, label: p.label, cups: p.cups,
      price1: parseFloat(p.price_first), priceR: parseFloat(p.price_renew),
      pop: p.popular,
      desc: "أول شهر " + p.price_first + " ر.ع ثم " + p.price_renew + " ر.ع / شهر",
    })),
  };
}

// GET /api/cafes — public, list all cafés
router.get("/", async (_req, res) => {
  const r = await query("SELECT * FROM cafes ORDER BY id");
  const cafes = await Promise.all(r.rows.map(fullCafe));
  res.json({ cafes });
});

// POST /api/cafes — ADMIN creates a new café
router.post("/", flexAuth("ADMIN"), async (req, res) => {

  const { slug, nameAr, area, color, logo, avgCup, lat, lng, featured } = req.body;
  if (!slug || !nameAr || !avgCup) return res.status(400).json({ error: "slug، nameAr، avgCup مطلوبة" });
  const ins = await query(
    `INSERT INTO cafes(slug, name_ar, area, color, logo, avg_cup, lat, lng, featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [slug, nameAr, area || null, color || "#B8974A", logo || nameAr.slice(0, 2), avgCup, lat || null, lng || null, !!featured]
  );
  await syncPackages(ins.rows[0].id, avgCup);
  res.status(201).json({ cafe: await fullCafe(ins.rows[0]) });
});

// PATCH /api/cafes/:id — ADMIN/MANAGER updates café (price, image, etc.)
router.patch("/:id", flexAuth("ADMIN", "MANAGER"), async (req, res) => {
  const { id } = req.params;
  const cafeRes = await query("SELECT * FROM cafes WHERE id=$1 OR slug=$1", [id]);
  const cafe = cafeRes.rows[0];
  if (!cafe) return res.status(404).json({ error: "الكوفي غير موجود" });

  // Manager may only edit their own café
  if (req.user.role === "MANAGER" && req.user.shopId !== cafe.id)
    return res.status(403).json({ error: "لا تملك صلاحية تعديل هذا الكوفي" });

  const { area, avgCup, image, featured } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  if (area !== undefined) { fields.push(`area=$${i++}`); values.push(area); }
  if (avgCup !== undefined) { fields.push(`avg_cup=$${i++}`); values.push(avgCup); }
  if (image !== undefined) { fields.push(`image_url=$${i++}`); values.push(image); }
  if (featured !== undefined && req.user.role === "ADMIN") { fields.push(`featured=$${i++}`); values.push(featured); }
  if (fields.length === 0) return res.status(400).json({ error: "لا يوجد تحديث" });

  values.push(cafe.id);
  await query(`UPDATE cafes SET ${fields.join(", ")} WHERE id=$${i}`, values);
  if (avgCup !== undefined) await syncPackages(cafe.id, avgCup);

  const updated = await query("SELECT * FROM cafes WHERE id=$1", [cafe.id]);
  res.json({ cafe: await fullCafe(updated.rows[0]) });
});

// POST /api/cafes/:id/menu — add a menu item
router.post("/:id/menu", flexAuth("ADMIN", "MANAGER"), async (req, res) => {
  const { id } = req.params;
  const cafeRes = await query("SELECT * FROM cafes WHERE id=$1 OR slug=$1", [id]);
  const cafe = cafeRes.rows[0];
  if (!cafe) return res.status(404).json({ error: "الكوفي غير موجود" });
  if (req.user.role === "MANAGER" && req.user.shopId !== cafe.id)
    return res.status(403).json({ error: "لا تملك صلاحية" });

  const { name, sizes, price } = req.body;
  if (!name || !price) return res.status(400).json({ error: "name و price مطلوبان" });
  const ins = await query(
    "INSERT INTO menu_items(cafe_id, name, sizes, price) VALUES ($1,$2,$3,$4) RETURNING *",
    [cafe.id, name, sizes || ["وسط"], price]
  );
  res.status(201).json({ item: ins.rows[0] });
});

// DELETE /api/cafes/:cafeId/menu/:itemId — soft-disable a menu item
router.delete("/:cafeId/menu/:itemId", flexAuth("ADMIN", "MANAGER"), async (req, res) => {
  const { cafeId, itemId } = req.params;
  const cafeRes = await query("SELECT * FROM cafes WHERE id=$1 OR slug=$1", [cafeId]);
  const cafe = cafeRes.rows[0];
  if (!cafe) return res.status(404).json({ error: "الكوفي غير موجود" });
  if (req.user.role === "MANAGER" && req.user.shopId !== cafe.id)
    return res.status(403).json({ error: "لا تملك صلاحية" });

  await query("UPDATE menu_items SET active=false WHERE id=$1 AND cafe_id=$2", [itemId, cafe.id]);
  res.json({ ok: true });
});

module.exports = router;

// DELETE /api/cafes/:id — ADMIN deletes a café
router.delete("/:id", flexAuth("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const r = await query("DELETE FROM cafes WHERE id=$1 OR slug=$1 RETURNING id", [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "الكوفي غير موجود" });
  res.json({ ok: true });
});
