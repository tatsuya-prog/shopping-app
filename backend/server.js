require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const http        = require('http');
const { WebSocketServer } = require('ws');

const { initDB, pool }                          = require('./db');
const { setWSS, setNotifyHook, broadcast, queueNotification } = require('./ws');
const itemsRouter                               = require('./routes/items');
const inventoryRouter                           = require('./routes/inventory');
const { router: recurringRouter, runCheck }     = require('./routes/recurring');
const historyRouter                             = require('./routes/history');
const mealRouter                                = require('./routes/meal');
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

wss.on('connection', ws => {
  console.log('WS connected');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', console.error);
  ws.on('close', () => console.log('WS disconnected'));
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 30000);

// ── 通知フック：SHOP_ADDED時にキューへ積む（broadcastとは分離）──
setNotifyHook(async (type, payload) => {
  if (type === 'SHOP_ADDED') {
    pool.query(
      'INSERT INTO push_queue(title,body) VALUES($1,$2)',
      ['🛒 買い物メモ', `${payload.added_by}が「${payload.name}」を追加しました`]
    ).catch(() => {});
  }
});

// ── 定期購入スケジューラ（1時間ごと）──
async function scheduledRecurringCheck() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const added = await runCheck(client);
    await client.query('COMMIT');
    if (added > 0) {
      broadcast('RECURRING_TRIGGERED', { added });
      pool.query(
        'INSERT INTO push_queue(title,body) VALUES($1,$2)',
        ['🔄 定期購入', `${added}件の商品がリストに追加されました`]
      ).catch(() => {});
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('定期チェックエラー:', e.message);
  } finally { client.release(); }
}

// ── まとめ通知（7分ごと）──
async function sendQueuedNotifications() {
  try {
    const { rows } = await pool.query('SELECT * FROM push_queue ORDER BY created_at ASC LIMIT 20');
    if (!rows.length) return;
    await sendBatchNotification('🛒 買い物メモ', rows.map(r => r.body).join('\n'));
    await pool.query('DELETE FROM push_queue');
  } catch (e) {
    console.error('まとめ通知エラー:', e.message);
  }
}

// ── Start ──
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server port ${PORT}`);
    scheduledRecurringCheck();
    setInterval(scheduledRecurringCheck, 60 * 60 * 1000);
    setInterval(sendQueuedNotifications, 7 * 60 * 1000);
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
