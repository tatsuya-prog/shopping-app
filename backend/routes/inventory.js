const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { broadcast } = require('../ws');

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

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory WHERE id=$1', [req.params.id]);
    broadcast('INV_DELETED', { id: +req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
