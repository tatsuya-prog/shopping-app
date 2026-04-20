const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { broadcast } = require('../ws');

// カテゴリー一覧
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY sort_order, id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// カテゴリー追加
router.post('/', async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name は必須' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories(name,color,sort_order) VALUES($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM categories)) RETURNING *',
      [name, color || '#888888']
    );
    broadcast('CAT_ADDED', rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// カテゴリー削除
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
    broadcast('CAT_DELETED', { id: +req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
