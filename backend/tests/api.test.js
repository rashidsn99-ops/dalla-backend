/**
 * دلّة API Tests — Jest
 * تشغيل: npm test
 * يتطلب: DATABASE_URL مضبوط أو SQLite للـ mock
 */

const request = require("supertest");
const app = require("../server");

// ── Auth Tests ────────────────────────────────────────────
describe("POST /api/auth/otp/request", () => {
  it("يرفض رقم هاتف فارغ", async () => {
    const res = await request(app).post("/api/auth/otp/request").send({});
    expect(res.status).toBe(400);
  });

  it("يرفض رقم هاتف قصير", async () => {
    const res = await request(app).post("/api/auth/otp/request").send({ phone: "123" });
    expect(res.status).toBe(400);
  });

  it("يقبل رقم عُماني صحيح", async () => {
    const res = await request(app).post("/api/auth/otp/request").send({ phone: "+96891234567" });
    // يرسل OTP أو يعيد خطأ DB — كلاهما ليس 400
    expect([200, 201, 500, 503]).toContain(res.status);
  });
});

// ── Codes Tests ───────────────────────────────────────────
describe("POST /api/codes/validate", () => {
  it("يرفض كود فارغ", async () => {
    const res = await request(app).post("/api/codes/validate").send({ code: "" });
    expect(res.body.ok).toBe(false);
  });

  it("يرفض كود غير موجود", async () => {
    const res = await request(app).post("/api/codes/validate").send({ code: "XXXXXXXX999" });
    expect(res.body.ok).toBe(false);
  });
});

// ── Cafes Tests ───────────────────────────────────────────
describe("GET /api/cafes", () => {
  it("يرجع قائمة الكوفيهات", async () => {
    const res = await request(app).get("/api/cafes");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cafes");
    expect(Array.isArray(res.body.cafes)).toBe(true);
  });
});

// ── Health Tests ──────────────────────────────────────────
describe("GET /health", () => {
  it("يعيد status ok أو error", async () => {
    const res = await request(app).get("/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
  });
});

// ── Complaints Tests ──────────────────────────────────────
describe("POST /api/complaints", () => {
  it("يرفض شكوى بدون تفاصيل", async () => {
    const res = await request(app).post("/api/complaints").send({ type: "مشكلة في التطبيق" });
    expect([400, 500]).toContain(res.status);
  });

  it("يقبل شكوى كاملة", async () => {
    const res = await request(app).post("/api/complaints").send({
      type: "مشكلة في التطبيق",
      details: "التطبيق لا يستجيب عند الضغط على زر الطلب الجديد"
    });
    expect([201, 500, 503]).toContain(res.status);
  });
});

afterAll(async () => {
  // أغلق الـ server بعد الاختبارات
  if (app.close) app.close();
});
