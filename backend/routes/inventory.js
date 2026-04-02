const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { broadcast } = require('../ws');

// 在庫一覧
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.id, i.master_id, i.stage,
             m.name, m.brand, m.store
      FROM inventory i JOIN masters m ON i.master_id=m.id
      ORDER BY m.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 在庫直接追加（購入リストを経由しない）
router.post('/direct', async (req, res) => {
  const { name, brand, note, store } = req.body;
  if (!name) return res.status(400).json({ error: 'name は必須' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mr = await client.query(
      `INSERT INTO masters(name,brand,note,store) VALUES($1,$2,$3,$4)
       ON CONFLICT(name) DO UPDATE SET brand=EXCLUDED.brand, note=EXCLUDED.note, store=EXCLUDED.store
       RETURNING id`,
      [name, brand||null, note||null, store||null]
    );
    const masterId = mr.rows[0].id;
    const ir = await client.query(
      `INSERT INTO inventory(master_id,stage) VALUES($1,'full')
       ON CONFLICT(master_id) DO UPDATE SET stage='full', updated_at=NOW()
       RETURNING id`,
      [masterId]
    );
    await client.query('COMMIT');
    const inv = { id: ir.rows[0].id, master_id: masterId, stage: 'full', name, brand: brand||'', store: store||'' };
    broadcast('INV_ADDED', inv);
    res.status(201).json(inv);
  } catch (e) {
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

// 在庫ゼロ → リスト追加 & 在庫削除（1トランザクション・二重防止）
router.post('/:id/zero-to-list', async (req, res) => {
  const { added_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: invRows } = await client.query(
      `SELECT i.id, i.master_id, m.name, m.brand, m.note, m.store
       FROM inventory i JOIN masters m ON i.master_id=m.id WHERE i.id=$1`,
      [req.params.id]
    );
    if (!invRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '在庫が見つかりません' });
    }
    const inv = invRows[0];

    // 未チェックで既にリストにあるか確認
    const { rows: ex } = await client.query(
      'SELECT id FROM shop_list WHERE master_id=$1 AND checked=false',
      [inv.master_id]
    );

    let newItem = null;
    if (!ex.length) {
      const { rows: added } = await client.query(
        'INSERT INTO shop_list(master_id,added_by,freq) VALUES($1,$2,$3) RETURNING id',
        [inv.master_id, added_by || 'システム', 'once']
      );
      newItem = {
        id: added[0].id, master_id: inv.master_id,
        checked: false, added_by: added_by || 'システム', freq: 'once',
        name: inv.name, brand: inv.brand || '', note: inv.note || '', store: inv.store || ''
      };
    }

    // 在庫削除
    await client.query('DELETE FROM inventory WHERE id=$1', [inv.id]);
    await client.query('COMMIT');

    broadcast('INV_DELETED', { id: +req.params.id });
    if (newItem) broadcast('SHOP_ADDED', newItem);
    res.json({ ok: true, added: !!newItem, item: newItem });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('zero-to-list error:', e.message);
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// 在庫削除
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory WHERE id=$1', [req.params.id]);
    broadcast('INV_DELETED', { id: +req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
