const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

function signToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role, shopId: user.shop_id || null, name: user.name },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "90d" }  // 90 يوم — يبقى مسجلاً دخوله
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "غير مصرح — أرسل Authorization: Bearer <token>" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "الجلسة منتهية أو غير صالحة" });
  }
}

function role(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: "لا تملك صلاحية" });
    next();
  };
}

module.exports = { signToken, auth, role, SECRET };
