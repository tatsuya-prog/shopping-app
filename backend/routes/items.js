const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { broadcast, queueNotification } = require('../ws');

// 買い物リスト取得
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.master_id, s.checked, s.added_by, s.freq, s.created_at,
             m.name, m.brand, m.note, m.store, m.category_id,
             c.name AS category_name, c.color AS category_color
      FROM shop_list s
      JOIN masters m ON s.master_id = m.id
      LEFT JOIN categories c ON m.category_id = c.id
      ORDER BY c.sort_order NULLS LAST, c.id NULLS LAST, s.created_at ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 商品追加
router.post('/', async (req, res) => {
  const { name, brand, note, store, added_by, freq, category_id } = req.body;
  if (!name || !added_by) return res.status(400).json({ error: 'name, added_by は必須' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const catId = category_id || null;
    const mr = await client.query(
      `INSERT INTO masters(name,brand,note,store,category_id) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(name) DO UPDATE SET brand=EXCLUDED.brand, note=EXCLUDED.note, store=EXCLUDED.store,
       category_id=COALESCE(EXCLUDED.category_id, masters.category_id)
       RETURNING id`,
      [name, brand||null, note||null, store||null, catId]
    );
    const masterId = mr.rows[0].id;
    const itemFreq = freq || 'once';
    const ir = await client.query(
      'INSERT INTO shop_list(master_id,added_by,freq) VALUES($1,$2,$3) RETURNING id',
      [masterId, added_by, itemFreq]
    );
    if (itemFreq !== 'once') {
      const nd = new Date();
      if (itemFreq === 'weekly')  nd.setDate(nd.getDate() + 7);
      if (itemFreq === 'monthly') nd.setMonth(nd.getMonth() + 1);
      await client.query(
        `INSERT INTO recurring(master_id,freq,next_date,added_by) VALUES($1,$2,$3,$4)
         ON CONFLICT(master_id) DO UPDATE SET freq=EXCLUDED.freq, next_date=EXCLUDED.next_date`,
        [masterId, itemFreq, nd.toISOString(), added_by]
      );
    }
    await client.query('COMMIT');

    // カテゴリー情報を取得して返す
    const { rows: catRows } = await pool.query('SELECT name,color FROM categories WHERE id=$1', [catId]);
    const cat = catRows[0] || null;
    const item = {
      id: ir.rows[0].id, master_id: masterId, checked: false,
      added_by, freq: itemFreq, name,
      brand: brand||'', note: note||'', store: store||'',
      category_id: catId,
      category_name:  cat ? cat.name  : null,
      category_color: cat ? cat.color : null
    };
    broadcast('SHOP_ADDED', item);
    queueNotification('SHOP_ADDED', item);
    res.status(201).json(item);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// チェック更新
router.patch('/:id/check', async (req, res) => {
  const { checked } = req.body;
  try {
    await pool.query('UPDATE shop_list SET checked=$1 WHERE id=$2', [checked, req.params.id]);
    broadcast('SHOP_CHECKED', { id: +req.params.id, checked });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 買い物完了
router.post('/complete', async (req, res) => {
  const { bought_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT s.master_id, s.freq, m.name, m.brand, m.store
      FROM shop_list s JOIN masters m ON s.master_id=m.id WHERE s.checked=true
    `);
    const today = (() => { const d=new Date(); return `${d.getMonth()+1}/${d.getDate()}`; })();
    for (const r of rows) {
      await client.query(
        'INSERT INTO history(name,brand,store,bought_by,bought_at) VALUES($1,$2,$3,$4,$5)',
        [r.name, r.brand||'', r.store||'', bought_by, today]
      );
      if (r.freq === 'once') {
        await client.query(
          `INSERT INTO inventory(master_id,stage) VALUES($1,'full')
           ON CONFLICT(master_id) DO UPDATE SET stage='full', updated_at=NOW()`,
          [r.master_id]
        );
      }
    }
    await client.query('DELETE FROM shop_list WHERE checked=true');
    await client.query('COMMIT');
    broadcast('SHOP_COMPLETED', { bought_by, date: today, count: rows.length });
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 削除
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_list WHERE id=$1', [req.params.id]);
    broadcast('SHOP_DELETED', { id: +req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
