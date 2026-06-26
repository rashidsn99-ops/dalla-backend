// تشغيل: npm run db:init
// ينفّذ schema.sql على قاعدة البيانات المحددة في DATABASE_URL
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL غير مُعرَّف. أضِفه في ملف .env أو متغيرات البيئة.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");

  console.log("⏳ جارٍ تنفيذ schema.sql ...");
  try {
    await pool.query(sql);
    console.log("✅ تم إنشاء كل الجداول بنجاح");
  } catch (e) {
    console.error("❌ فشل تنفيذ المخطط:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
