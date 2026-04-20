const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        color      TEXT DEFAULT '#2d6a4f',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS masters (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        brand       TEXT,
        note        TEXT,
        store       TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS shop_list (
        id         SERIAL PRIMARY KEY,
        master_id  INTEGER REFERENCES masters(id) ON DELETE CASCADE,
        checked    BOOLEAN DEFAULT FALSE,
        added_by   TEXT NOT NULL,
        freq       TEXT DEFAULT 'once',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id         SERIAL PRIMARY KEY,
        master_id  INTEGER REFERENCES masters(id) ON DELETE CASCADE UNIQUE,
        stage      TEXT DEFAULT 'full',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS recurring (
        id         SERIAL PRIMARY KEY,
        master_id  INTEGER REFERENCES masters(id) ON DELETE CASCADE UNIQUE,
        freq       TEXT NOT NULL,
        next_date  TIMESTAMPTZ NOT NULL,
        added_by   TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS history (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        brand      TEXT,
        store      TEXT,
        bought_by  TEXT NOT NULL,
        bought_at  TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         SERIAL PRIMARY KEY,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        user_name  TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS push_queue (
        id         SERIAL PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 既存テーブルへのカラム追加（既存DB対応）
    await client.query(`
      ALTER TABLE masters ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
    `).catch(() => {});

    // 初期カテゴリー
    await client.query(`
      INSERT INTO categories(name, color, sort_order) VALUES
        ('食料品', '#27ae60', 1),
        ('日用品', '#2980b9', 2)
      ON CONFLICT(name) DO NOTHING;
    `);

    console.log('✅ DB ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
