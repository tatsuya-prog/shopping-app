const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { broadcast } = require('../ws');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.master_id, r.freq, r.next_date, r.added_by,
             m.name, m.brand, m.store
      FROM recurring r JOIN masters m ON r.master_id=m.id
      ORDER BY r.next_date ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 定期チェック（アプリ起動時 & 1時間ごとにサーバーから呼ぶ）
async function runCheck(client) {
  const now = new Date();
  const { rows } = await client.query('SELECT * FROM recurring WHERE next_date <= $1', [now]);
  let added = 0;
  for (const rec of rows) {
    const ex = await client.query(
      'SELECT id FROM shop_list WHERE master_id=$1 AND checked=false', [rec.master_id]
    );
    if (!ex.rows.length) {
      await client.query(
        'INSERT INTO shop_list(master_id,added_by,freq) VALUES($1,$2,$3)',
        [rec.master_id, rec.added_by, rec.freq]
      );
      added++;
    }
    const nd = new Date(rec.next_date);
    if (rec.freq === 'weekly')  nd.setDate(nd.getDate() + 7);
    if (rec.freq === 'monthly') nd.setMonth(nd.getMonth() + 1);
    await client.query('UPDATE recurring SET next_date=$1 WHERE id=$2', [nd, rec.id]);
  }
  return added;
}

router.post('/check', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const added = await runCheck(client);
    await client.query('COMMIT');
    if (added > 0) broadcast('RECURRING_TRIGGERED', { added });
    res.json({ ok: true, added });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM recurring WHERE id=$1', [req.params.id]);
    broadcast('REC_DELETED', { id: +req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, runCheck };
