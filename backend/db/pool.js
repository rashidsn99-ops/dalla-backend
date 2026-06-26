// db/pool.js — Production-grade PostgreSQL Connection Pool
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL غير مُعرَّف.");
}

// ═══════════════════════════════════════════════════════════════
// حساب max connections:
// Render Standard DB: يدعم حتى 97 اتصالاً متزامناً
// عدد نسخ Node.js (PM2 Cluster): حتى 4 نسخ
// max per instance = floor(97 / 4) - 2 = ~22
//
// قاعدة: (DB max_connections - 5 للـ superuser) / عدد النسخ
// ═══════════════════════════════════════════════════════════════
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || "20", 10);
const DB_MIN_CONNECTIONS = parseInt(process.env.DB_MIN_CONNECTIONS || "2", 10);
const DB_IDLE_TIMEOUT_MS = parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10);
const DB_CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_CONN_TIMEOUT_MS || "5000", 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // SSL مطلوب في Render production
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,

  // Connection pool settings
  max: DB_MAX_CONNECTIONS,              // أقصى عدد اتصالات متزامنة
  min: DB_MIN_CONNECTIONS,              // احتفظ باتصالات جاهزة دائماً
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS, // أغلق الاتصال الخامل بعد 30s
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS, // timeout للحصول على اتصال

  // Statement timeout: لا تدع استعلام ينتظر أكثر من 10 ثوانٍ
  statement_timeout: parseInt(process.env.DB_STMT_TIMEOUT_MS || "10000", 10),

  // Application name يساعد في تشخيص الاتصالات من pg_stat_activity
  application_name: `dalla-worker-${process.pid}`,
});

pool.on("connect", (client) => {
  // إعدادات الجلسة لكل اتصال جديد
  client.query("SET timezone = 'Asia/Muscat'").catch(() => {});
});

pool.on("error", (err) => {
  console.error("[DB Pool Error]", err.message);
  // لا تُوقف البروسيس، PM2 سيعيد تشغيله عند الحاجة
});

pool.on("remove", () => {
  // اتصال أُغلق — طبيعي
});

// Graceful shutdown: أغلق الـ Pool عند إيقاف التطبيق
process.on("SIGTERM", async () => {
  console.log("[DB] SIGTERM — إغلاق Pool...");
  await pool.end();
  console.log("[DB] Pool أُغلق بنجاح");
});

// ── دالة query مع logging للاستعلامات البطيئة ──────────────────
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_MS || "200", 10);

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms = Date.now() - start;
    if (ms > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(`[DB Slow Query] ${ms}ms | ${text.slice(0, 120).replace(/\s+/g, " ")}`);
    }
    return res;
  } catch (err) {
    console.error("[DB Query Error]", err.message, "|", text.slice(0, 80));
    throw err;
  }
}

// ── Health check دالة مساعدة ────────────────────────────────────
async function healthCheck() {
  const { rows } = await pool.query("SELECT 1 AS ok, now() AS time");
  return {
    status: "connected",
    time: rows[0].time,
    poolTotal: pool.totalCount,
    poolIdle: pool.idleCount,
    poolWaiting: pool.waitingCount,
  };
}

module.exports = { pool, query, healthCheck };
