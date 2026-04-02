const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { pool } = require('../db');

// VAPID設定
function setupVapid() {
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const mail = process.env.VAPID_EMAIL || 'mailto:admin@example.com';
  if (pub && priv) {
    webpush.setVapidDetails(mail, pub, priv);
    return true;
  }
  return false;
}

// 購読情報を保存
router.post('/subscribe', async (req, res) => {
  if (!setupVapid()) return res.status(500).json({ error: 'VAPID未設定' });
  const { subscription, user } = req.body;
  if (!subscription || !user) return res.status(400).json({ error: '必須パラメータ不足' });
  try {
    await pool.query(`
      INSERT INTO push_subscriptions(endpoint, p256dh, auth, user_name)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh=$2, auth=$3, user_name=$4, updated_at=NOW()
    `, [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      user
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 購読解除
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// VAPID公開鍵を返す（フロントエンドが購読登録に使う）
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// まとめ通知送信（内部から呼ぶ）
async function sendBatchNotification(title, body) {
  if (!setupVapid()) return;
  try {
    const { rows } = await pool.query('SELECT * FROM push_subscriptions');
    const payload = JSON.stringify({ title, body });
    const results = await Promise.allSettled(
      rows.map(row =>
        webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload
        ).catch(async e => {
          // 410=購読切れ → 削除
          if (e.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [row.endpoint]);
          }
          throw e;
        })
      )
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`📬 通知送信: ${sent}/${rows.length}件`);
  } catch (e) {
    console.error('通知送信エラー:', e.message);
  }
}

module.exports = { router, sendBatchNotification };
