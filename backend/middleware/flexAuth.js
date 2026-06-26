/**
 * flexAuth — middleware مرن
 * إذا مفيه أدمن في قاعدة البيانات بعد → يسمح بدون token (وضع الإعداد الأول)
 * إذا فيه أدمن → يتحقق من الـ JWT ويتطلب role معيّن
 */
const jwt = require("jsonwebtoken");
const { query } = require("../db/pool");

const SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

let _adminExists = null; // cache للأداء
let _lastCheck = 0;

async function checkAdminExists() {
  if (Date.now() - _lastCheck < 30000) return _adminExists; // cache 30 ثانية
  const r = await query("SELECT COUNT(*) FROM users WHERE role='ADMIN'");
  _adminExists = parseInt(r.rows[0].count, 10) > 0;
  _lastCheck = Date.now();
  return _adminExists;
}

function flexAuth(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const hasAdmins = await checkAdminExists();
      if (!hasAdmins) {
        // وضع الإعداد الأول — اسمح بأي طلب بدون token
        req.user = { id: 0, role: "ADMIN", name: "setup" };
        return next();
      }
      // تحقق من الـ JWT
      const header = req.headers.authorization || "";
      const token = header.replace("Bearer ", "");
      if (!token) return res.status(401).json({ error: "غير مصرح — سجّل دخول أولاً" });
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
      if (allowedRoles.length && !allowedRoles.includes(decoded.role))
        return res.status(403).json({ error: "لا تملك صلاحية لهذا الإجراء" });
      next();
    } catch (e) {
      res.status(401).json({ error: "الجلسة منتهية أو غير صالحة" });
    }
  };
}

module.exports = { flexAuth };
