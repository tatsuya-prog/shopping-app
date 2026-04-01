require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const compression= require('compression');
const http       = require('http');
const { WebSocketServer } = require('ws');

const { initDB, pool }   = require('./db');
const { setWSS, broadcast } = require('./ws');
const itemsRouter     = require('./routes/items');
const inventoryRouter = require('./routes/inventory');
const { router: recurringRouter, runCheck } = require('./routes/recurring');
const historyRouter   = require('./routes/history');

const app    = express();
const server = http.createServer(app);

// ── gzip圧縮（通信量削減の要）──
app.use(compression());

// ── CORS ──
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

// ── キャッシュヘッダー（静的データは5分キャッシュ）──
app.use('/api/history/masters', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=300');
  next();
});

// ── Routes ──
// UptimeRobot 用 health エンドポイント（スリープ対策）
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/items',     itemsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/history',   historyRouter);

// ── WebSocket ──
const wss = new WebSocketServer({ server });
setWSS(wss);

wss.on('connection', (ws, req) => {
  console.log('WS connected');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', console.error);
  ws.on('close', () => console.log('WS disconnected'));
});

// ping-pong keepalive（30秒ごと）
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
      console.log(`🔄 定期購入 ${added}件 追加`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('定期チェックエラー:', e.message);
  } finally {
    client.release();
  }
}

// ── Start ──
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server port ${PORT}`);
    scheduledRecurringCheck(); // 起動時に1回
    setInterval(scheduledRecurringCheck, 60 * 60 * 1000);
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
