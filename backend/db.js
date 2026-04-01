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
      CREATE TABLE IF NOT EXISTS masters (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        brand      TEXT,
        note       TEXT,
        store      TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
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

      CREATE TABLE IF NOT EXISTS sync_state (
        id         INTEGER PRIMARY KEY DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO sync_state(id) VALUES(1) ON CONFLICT DO NOTHING;
    `);
    console.log('✅ DB ready');
  } finally {
    client.release();
  }
}

// 差分取得用：最終更新タイムスタンプを更新
async function touchSyncState(client) {
  await client.query('UPDATE sync_state SET updated_at=NOW() WHERE id=1');
}

module.exports = { pool, initDB, touchSyncState };
