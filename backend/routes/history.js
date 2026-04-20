const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { who, store, name, limit=60 } = req.query;
    let where = [], params = [];
    if (who)   { params.push(who);        where.push(`bought_by=$${params.length}`); }
    if (store) { params.push(`%${store}%`); where.push(`store ILIKE $${params.length}`); }
    if (name)  { params.push(`%${name}%`);  where.push(`name ILIKE $${params.length}`); }
    const ws = where.length ? 'WHERE '+where.join(' AND ') : '';
    params.push(+limit);
    const { rows } = await pool.query(
      `SELECT id,name,brand,store,bought_by,bought_at FROM history ${ws} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/masters', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,name,brand,note,store,category_id FROM masters ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics', async (req, res) => {
  try {
    const { rows: top }     = await pool.query(`SELECT name,COUNT(*) as count,MAX(bought_at) as last_bought FROM history GROUP BY name ORDER BY count DESC LIMIT 10`);
    const { rows: byWho }   = await pool.query(`SELECT bought_by,COUNT(*) as count FROM history GROUP BY bought_by ORDER BY count DESC`);
    const { rows: byStore } = await pool.query(`SELECT store,COUNT(*) as count FROM history WHERE store!='' GROUP BY store ORDER BY count DESC LIMIT 5`);
    const { rows: byMonth } = await pool.query(`SELECT TO_CHAR(created_at,'YYYY/MM') as month,COUNT(*) as count FROM history WHERE created_at>=NOW()-INTERVAL '6 months' GROUP BY month ORDER BY month`);
    res.json({ top, byWho, byStore, byMonth });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await pool.query('DELETE FROM history WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

router.delete('/', async (req, res) => {
  try { await pool.query('DELETE FROM history'); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

module.exports = router;
