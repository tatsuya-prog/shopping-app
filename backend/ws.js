let wss = null;
let hook = null;

function setWSS(server) { wss = server; }
function setBroadcastHook(fn) { hook = fn; }

function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
  // 通知フック（追加時のみキューに積む）
  if (hook && type === 'SHOP_ADDED') hook(type, payload);
}

module.exports = { setWSS, setBroadcastHook, broadcast };
