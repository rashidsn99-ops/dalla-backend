-- ═══════════════════════════════════════════════════════════
-- دلّة ☕ — Database Schema (PostgreSQL)
-- شغّل هذا الملف مرة واحدة فقط عند إعداد قاعدة بيانات جديدة
-- ═══════════════════════════════════════════════════════════

-- ── Users (customers, staff, managers, admins) ──────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  phone         VARCHAR(20) UNIQUE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER', -- CUSTOMER | STAFF | MANAGER | ADMIN
  pin_hash      TEXT,            -- for STAFF/MANAGER/ADMIN login (bcrypt)
  shop_id       INTEGER,         -- for STAFF/MANAGER: which café they belong to
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cafés ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cafes (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(60) UNIQUE NOT NULL,
  name_ar       VARCHAR(120) NOT NULL,
  area          VARCHAR(120),
  color         VARCHAR(10) DEFAULT '#B8974A',
  logo          VARCHAR(10),
  image_url     TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  avg_cup       NUMERIC(6,3) NOT NULL DEFAULT 1.5,
  popularity    INTEGER NOT NULL DEFAULT 0,
  featured      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT fk_users_shop
  FOREIGN KEY (shop_id) REFERENCES cafes(id) ON DELETE SET NULL;

-- ── Menu items per café ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            SERIAL PRIMARY KEY,
  cafe_id       INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name          VARCHAR(120) NOT NULL,
  sizes         TEXT[] NOT NULL DEFAULT '{}',
  price         NUMERIC(8,3) NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Packages (auto-derived from avg_cup, but persisted for stability) ──
CREATE TABLE IF NOT EXISTS packages (
  id            SERIAL PRIMARY KEY,
  cafe_id       INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  label         VARCHAR(60) NOT NULL,   -- "١٥ كوب" / "٣٠ كوب"
  cups          INTEGER NOT NULL,
  price_first   NUMERIC(8,3) NOT NULL,
  price_renew   NUMERIC(8,3) NOT NULL,
  popular       BOOLEAN NOT NULL DEFAULT false
);

-- ── Subscriptions (a user can have many, even at the same café over time) ──
CREATE TABLE IF NOT EXISTS subscriptions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cafe_id       INTEGER NOT NULL REFERENCES cafes(id),
  package_label VARCHAR(60) NOT NULL,
  cups          INTEGER NOT NULL,
  total_cups    INTEGER NOT NULL,
  price_first   NUMERIC(8,3),
  price_renew   NUMERIC(8,3),
  from_gift     BOOLEAN NOT NULL DEFAULT false,
  gift_id       INTEGER,
  active        BOOLEAN NOT NULL DEFAULT true,
  start_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_date DATE
);

-- ── Orders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cafe_id         INTEGER NOT NULL REFERENCES cafes(id),
  drink           VARCHAR(120) NOT NULL,
  size            VARCHAR(40),
  price           NUMERIC(8,3) NOT NULL DEFAULT 0,
  barista_id      INTEGER REFERENCES users(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | preparing | ready | completed | cancelled | awaiting_confirm
  is_gift_order   BOOLEAN NOT NULL DEFAULT false,
  gift_id         INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_created ON orders(cafe_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

-- ── Complaints ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
  id            SERIAL PRIMARY KEY,
  from_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cafe_id       INTEGER REFERENCES cafes(id),
  type          VARCHAR(60) NOT NULL,
  details       TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open', -- open | resolved
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Gifts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gifts (
  id              SERIAL PRIMARY KEY,
  from_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_display    VARCHAR(120),
  to_phone        VARCHAR(20) NOT NULL,
  to_name         VARCHAR(120),
  anonymous       BOOLEAN NOT NULL DEFAULT false,
  type            VARCHAR(10) NOT NULL,   -- cup | pkg
  cafe_id         INTEGER REFERENCES cafes(id),
  package_label   VARCHAR(60),
  cups            INTEGER DEFAULT 1,
  drink           VARCHAR(120),
  size            VARCHAR(40),
  amount          NUMERIC(8,3) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | used | activated | expired
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gifts_to_phone ON gifts(to_phone);

-- ── Discount codes / gift codes ─────────────────────────────
CREATE TABLE IF NOT EXISTS discount_codes (
  code          VARCHAR(40) PRIMARY KEY,
  pct           INTEGER NOT NULL,
  uses_limit    INTEGER NOT NULL DEFAULT 0,  -- 0 = unlimited
  used_count    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  expires_at    TIMESTAMPTZ,
  apply_to      VARCHAR(20) NOT NULL DEFAULT 'both', -- subscription | gift | both
  is_gift       BOOLEAN NOT NULL DEFAULT false,
  gift_phone    VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Offers (time-bound promotions) ──────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(160) NOT NULL,
  pct           INTEGER NOT NULL,
  apply_to      VARCHAR(20) NOT NULL DEFAULT 'both', -- subscription | gift | both
  cafe_id       INTEGER REFERENCES cafes(id),         -- NULL = all cafés
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Notifications (targeted, per-user) ──────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  msg           TEXT NOT NULL,
  type          VARCHAR(20) NOT NULL DEFAULT 'info',
  data          JSONB,
  read          BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- ── OTP store (short-lived) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  phone         VARCHAR(20) PRIMARY KEY,
  code          VARCHAR(8) NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL
);

-- ══════════════════════════════════════════════════════════════
-- Performance Indexes — أضِفها على قاعدة بيانات موجودة بـ:
-- psql $DATABASE_URL -c "$(tail -20 schema.sql)"
-- ══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_subs_user_active
  ON subscriptions(user_id, active);
CREATE INDEX IF NOT EXISTS idx_subs_cafe_active
  ON subscriptions(cafe_id, active);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_date
  ON orders(cafe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gifts_phone_status
  ON gifts(to_phone, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_codes_active
  ON discount_codes(code, active);
CREATE INDEX IF NOT EXISTS idx_notifs_user_unread
  ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_shop
  ON users(shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cafes_featured
  ON cafes(featured, featured_order) WHERE featured = true;
