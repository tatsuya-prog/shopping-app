require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const http        = require('http');
const { WebSocketServer } = require('ws');

const { initDB, pool }              = require('./db');
const { setWSS, broadcast }         = require('./ws');
const itemsRouter                   = require('./routes/items');
const inventoryRouter               = require('./routes/inventory');
const { router: recurringRouter, runCheck } = require('./routes/recurring');
const historyRouter                 = require('./routes/history');
const mealRouter                    = require('./routes/meal');
const { router: pushRouter, sendBatchNotification } = require('./routes/push');

const app    = express();
const server = http.createServer(app);

app.use(compression());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) cb(null, true);
    else cb(new Error('CORS blocked: ' + origin));
  }
}));
app.use(express.json());

// キャッシュヘッダー
app.use('/api/history/masters', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=300');
  next();
});

// ── Routes ──
app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/items',     itemsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/history',   historyRouter);
app.use('/api/meal',      mealRouter);
app.use('/api/push',      pushRouter);


// ── WebSocket ──
const wss = new WebSocketServer({ server });
setWSS(wss);

wss.on('connection', (ws) => {
  console.log('WS connected');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', console.error);
  ws.on('close', () => console.log('WS disconnected'));
});

const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(pingInterval));

// ── 定期購入スケジューラ（1時間ごと）──
async function scheduledRecurringCheck() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const added = await runCheck(client);
    await client.query('COMMIT');
    if (added > 0) {
      broadcast('RECURRING_TRIGGERED', { added });
      // 通知キューに積む
      await pool.query(
        'INSERT INTO push_queue(title,body) VALUES($1,$2)',
        ['🔄 定期購入', `${added}件の商品が買い物リストに追加されました`]
      );
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('定期チェックエラー:', e.message);
  } finally {
    client.release();
  }
}

// ── まとめ通知スケジューラ（7分ごと）──
// キューに溜まった通知をまとめて1回で送る
let notifyQueue = [];
broadcast._queueNotification = (title, body) => {
  notifyQueue.push({ title, body });
};

async function sendQueuedNotifications() {
  try {
    const { rows } = await pool.query('SELECT * FROM push_queue ORDER BY created_at ASC');
    if (!rows.length) return;
    // まとめて1件の通知に
    const title = '🛒 買い物メモ';
    const body = rows.map(r => r.body).join('\n');
    await sendBatchNotification(title, body);
    await pool.query('DELETE FROM push_queue');
  } catch (e) {
    console.error('通知送信エラー:', e.message);
  }
}

// WSイベント発生時に通知キューに積む
const origBroadcast = broadcast;
function broadcastWithNotify(type, payload) {
  origBroadcast(type, payload);
  // リスト追加時だけキューに積む
  if (type === 'SHOP_ADDED') {
    pool.query(
      'INSERT INTO push_queue(title,body) VALUES($1,$2)',
      ['🛒 買い物メモ', `${payload.added_by}が「${payload.name}」を追加しました`]
    ).catch(() => {});
  }
}
// wsにbroadcastWithNotifyを登録
require('./ws').setBroadcastHook(broadcastWithNotify);

// ── Start ──
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server port ${PORT}`);
    scheduledRecurringCheck();
    setInterval(scheduledRecurringCheck, 60 * 60 * 1000);
    setInterval(sendQueuedNotifications, 7 * 60 * 1000); // 7分ごとにまとめ通知
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
