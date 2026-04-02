const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,brand,store,bought_by,bought_at FROM history ORDER BY created_at DESC LIMIT 60'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// サジェスト用マスタ
router.get('/masters', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,name,brand,note,store FROM masters ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
