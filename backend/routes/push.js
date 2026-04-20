const express  = require('express');
const router   = express.Router();
const webpush  = require('web-push');
const { pool } = require('../db');

function setupVapid() {
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const mail = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
  if (pub && priv) { webpush.setVapidDetails(mail, pub, priv); return true; }
  return false;
}

router.get('/vapid-public-key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY||'' }));

router.post('/subscribe', async (req, res) => {
  if (!setupVapid()) return res.status(500).json({ error: 'VAPID未設定' });
  const { subscription, user } = req.body;
  try {
    await pool.query(
      `INSERT INTO push_subscriptions(endpoint,p256dh,auth,user_name) VALUES($1,$2,$3,$4)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh=$2,auth=$3,user_name=$4,updated_at=NOW()`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, user]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/unsubscribe', async (req, res) => {
  try { await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1',[req.body.endpoint]); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

async function sendBatchNotification(title, body) {
  if (!setupVapid()) return;
  try {
    const { rows } = await pool.query('SELECT * FROM push_subscriptions');
    const payload  = JSON.stringify({ title, body });
    await Promise.allSettled(rows.map(row =>
      webpush.sendNotification(
        { endpoint:row.endpoint, keys:{ p256dh:row.p256dh, auth:row.auth } },
        payload
      ).catch(async e => {
        if (e.statusCode===410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1',[row.endpoint]);
        throw e;
      })
    ));
  } catch(e) { console.error('通知送信エラー:',e.message); }
}

module.exports = { router, sendBatchNotification };
