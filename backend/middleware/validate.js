/**
 * Validation Middleware — باستخدام Joi
 * يمنع البيانات الخاطئة من الوصول لقاعدة البيانات
 * تثبيت: npm install joi
 */
const Joi = require("joi");

// Helper: ينظّف رقم الهاتف ويتحقق منه
const phoneSchema = Joi.string()
  .pattern(/^\+?[\d\s\-()]{6,20}$/)
  .required()
  .messages({
    "string.pattern.base": "رقم الهاتف غير صحيح",
    "any.required": "رقم الهاتف مطلوب",
  });

// Schemas
const schemas = {
  // POST /api/auth/otp/request
  otpRequest: Joi.object({
    phone: phoneSchema,
    name: Joi.string().max(120).optional(),
  }),

  // POST /api/auth/otp/verify
  otpVerify: Joi.object({
    phone: phoneSchema,
    code: Joi.string().length(4).pattern(/^\d{4}$/).required().messages({
      "string.pattern.base": "رمز التحقق يجب أن يكون 4 أرقام",
    }),
    name: Joi.string().max(120).optional(),
  }),

  // POST /api/auth/staff/login
  staffLogin: Joi.object({
    phone: Joi.string().max(120).optional(),
    name: Joi.string().max(120).optional(),
    pin: Joi.string().min(4).max(20).required().messages({
      "string.min": "الرمز السري يجب أن يكون 4 أرقام على الأقل",
      "any.required": "الرمز السري مطلوب",
    }),
  }),

  // POST /api/complaints
  complaint: Joi.object({
    type: Joi.string().max(100).required().messages({ "any.required": "نوع الشكوى مطلوب" }),
    details: Joi.string().min(10).max(2000).required().messages({
      "string.min": "التفاصيل يجب أن تكون 10 أحرف على الأقل",
      "any.required": "تفاصيل الشكوى مطلوبة",
    }),
    cafeId: Joi.string().max(100).optional().allow(null, ""),
    fromName: Joi.string().max(120).optional().allow(""),
    fromPhone: Joi.string().max(30).optional().allow(""),
  }),

  // POST /api/cafes
  createCafe: Joi.object({
    slug: Joi.string().alphanum().max(60).required(),
    nameAr: Joi.string().max(120).required(),
    area: Joi.string().max(120).optional().allow(""),
    color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
    logo: Joi.string().max(10).optional().allow(""),
    avgCup: Joi.number().min(0.1).max(100).required(),
    lat: Joi.number().min(-90).max(90).optional().allow(null),
    lng: Joi.number().min(-180).max(180).optional().allow(null),
    featured: Joi.boolean().optional(),
  }),

  // POST /api/codes
  createCode: Joi.object({
    code: Joi.string().alphanum().min(3).max(40).required(),
    pct: Joi.number().integer().min(1).max(100).required(),
    uses: Joi.number().integer().min(0).default(0),
    exp: Joi.string().isoDate().optional().allow(null, ""),
    applyTo: Joi.string().valid("subscription", "gift", "both").default("both"),
    isGift: Joi.boolean().default(false),
    giftPhone: Joi.string().max(30).optional().allow(null, ""),
  }),

  // POST /api/gifts
  sendGift: Joi.object({
    toPhone: phoneSchema,
    toName: Joi.string().max(120).optional().allow(""),
    anonymous: Joi.boolean().default(false),
    type: Joi.string().valid("cup", "pkg").required(),
    cafeId: Joi.string().max(60).required(),
    cups: Joi.number().integer().min(1).max(100).default(1),
    drink: Joi.string().max(120).optional().allow(null, ""),
    size: Joi.string().max(40).optional().allow(null, ""),
    amount: Joi.number().min(0).default(0),
    packageLabel: Joi.string().max(60).optional().allow(null, ""),
  }),
};

/**
 * validate(schemaName) — Middleware يُستخدم كـ:
 * router.post("/", validate("createCafe"), handler)
 */
function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next(); // no schema = skip validation

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,  // أظهر كل الأخطاء دفعة واحدة
      stripUnknown: true, // احذف الحقول غير المعروفة
    });

    if (error) {
      const msg = error.details.map((d) => d.message).join(" | ");
      return res.status(400).json({ error: msg });
    }

    req.body = value; // استخدم البيانات المُنظَّفة
    next();
  };
}

module.exports = { validate, schemas };
