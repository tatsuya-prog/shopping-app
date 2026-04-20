const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { broadcast } = require('../ws');

// 在庫一覧
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.id, i.master_id, i.stage,
             m.name, m.brand, m.store, m.category_id,
             c.name AS category_name, c.color AS category_color
      FROM inventory i
      JOIN masters m ON i.master_id=m.id
      LEFT JOIN categories c ON m.category_id=c.id
      ORDER BY c.sort_order NULLS LAST, m.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 在庫直接追加
router.post('/direct', async (req, res) => {
  const { name, brand, note, store, category_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name は必須' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mr = await client.query(
      `INSERT INTO masters(name,brand,note,store,category_id) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(name) DO UPDATE SET brand=EXCLUDED.brand, note=EXCLUDED.note,
       store=EXCLUDED.store, category_id=COALESCE(EXCLUDED.category_id, masters.category_id)
       RETURNING id`,
      [name, brand||null, note||null, store||null, category_id||null]
    );
    const masterId = mr.rows[0].id;
    const ir = await client.query(
      `INSERT INTO inventory(master_id,stage) VALUES($1,'full')
       ON CONFLICT(master_id) DO UPDATE SET stage='full', updated_at=NOW()
       RETURNING id`,
      [masterId]
    );
    await client.query('COMMIT');
    const { rows: catRows } = await pool.query('SELECT name,color FROM categories WHERE id=$1', [category_id||null]);
    const cat = catRows[0] || null;
    const inv = {
      id: ir.rows[0].id, master_id: masterId, stage: 'full',
      name, brand: brand||'', store: store||'',
      category_id: category_id||null,
      category_name: cat?cat.name:null, category_color: cat?cat.color:null
    };
    broadcast('INV_ADDED', inv);
    res.status(201).json(inv);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 在庫商品情報編集
router.patch('/:id/edit', async (req, res) => {
  const { name, brand, note, store, category_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name は必須' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: iv } = await client.query('SELECT master_id FROM inventory WHERE id=$1', [req.params.id]);
    if (!iv.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: '見つかりません' }); }
    const masterId = iv[0].master_id;
    await client.query(
      'UPDATE masters SET name=$1, brand=$2, note=$3, store=$4, category_id=$5 WHERE id=$6',
      [name, brand||null, note||null, store||null, category_id||null, masterId]
    );
    await client.query('COMMIT');
    const { rows: catRows } = await pool.query('SELECT name,color FROM categories WHERE id=$1', [category_id||null]);
    const cat = catRows[0] || null;
    const updated = { id: +req.params.id, master_id: masterId, name, brand: brand||'', store: store||'', category_id: category_id||null, category_name: cat?cat.name:null, category_color: cat?cat.color:null };
    broadcast('INV_EDITED', updated);
    res.json(updated);
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 在庫を残したままリストに追加（少ない・なし共通）
router.post('/:id/add-to-list', async (req, res) => {
  const { added_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: ivRows } = await client.query(
      `SELECT i.id, i.master_id, m.name, m.brand, m.note, m.store, m.category_id,
              c.name AS category_name, c.color AS category_color
       FROM inventory i JOIN masters m ON i.master_id=m.id
       LEFT JOIN categories c ON m.category_id=c.id
       WHERE i.id=$1`,
      [req.params.id]
    );
    if (!ivRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: '在庫が見つかりません' }); }
    const inv = ivRows[0];
    // 既にリストにあれば追加しない
    const { rows: ex } = await client.query(
      'SELECT id FROM shop_list WHERE master_id=$1 AND checked=false', [inv.master_id]
    );
    let newItem = null;
    if (!ex.length) {
      const { rows: added } = await client.query(
        'INSERT INTO shop_list(master_id,added_by,freq) VALUES($1,$2,$3) RETURNING id',
        [inv.master_id, added_by||'システム', 'once']
      );
      newItem = {
        id: added[0].id, master_id: inv.master_id, checked: false,
        added_by: added_by||'システム', freq: 'once',
        name: inv.name, brand: inv.brand||'', note: inv.note||'', store: inv.store||'',
        category_id: inv.category_id, category_name: inv.category_name, category_color: inv.category_color
      };
    }
    await client.query('COMMIT');
    // 在庫はそのまま残す（削除しない）
    if (newItem) broadcast('SHOP_ADDED', newItem);
    res.json({ ok: true, added: !!newItem, item: newItem });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ステージ更新
router.patch('/:id/stage', async (req, res) => {
  const { stage } = req.body;
  if (!['full','many','few','none'].includes(stage))
    return res.status(400).json({ error: '無効なステージ' });
  try {
    await pool.query('UPDATE inventory SET stage=$1, updated_at=NOW() WHERE id=$2', [stage, req.params.id]);
    broadcast('INV_UPDATED', { id: +req.params.id, stage });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 在庫ゼロ→リスト追加（1トランザクション・二重防止）
router.post('/:id/zero-to-list', async (req, res) => {
  const { added_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: invRows } = await client.query(
      `SELECT i.id, i.master_id, m.name, m.brand, m.note, m.store, m.category_id,
              c.name AS category_name, c.color AS category_color
       FROM inventory i JOIN masters m ON i.master_id=m.id
       LEFT JOIN categories c ON m.category_id=c.id
       WHERE i.id=$1`,
      [req.params.id]
    );
    if (!invRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: '在庫が見つかりません' }); }
    const inv = invRows[0];
    const { rows: ex } = await client.query('SELECT id FROM shop_list WHERE master_id=$1 AND checked=false', [inv.master_id]);
    let newItem = null;
    if (!ex.length) {
      const { rows: added } = await client.query(
        'INSERT INTO shop_list(master_id,added_by,freq) VALUES($1,$2,$3) RETURNING id',
        [inv.master_id, added_by||'システム', 'once']
      );
      newItem = {
        id: added[0].id, master_id: inv.master_id, checked: false,
        added_by: added_by||'システム', freq: 'once',
        name: inv.name, brand: inv.brand||'', note: inv.note||'', store: inv.store||'',
        category_id: inv.category_id, category_name: inv.category_name, category_color: inv.category_color
      };
    }
    await client.query('DELETE FROM inventory WHERE id=$1', [inv.id]);
    await client.query('COMMIT');
    broadcast('INV_DELETED', { id: +req.params.id });
    if (newItem) broadcast('SHOP_ADDED', newItem);
    res.json({ ok: true, added: !!newItem, item: newItem });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 削除
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory WHERE id=$1', [req.params.id]);
    broadcast('INV_DELETED', { id: +req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
