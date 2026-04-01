let wss = null;

function setWSS(server) { wss = server; }

// 変更の種類と最小限のペイロードだけ送る（通信量削減）
function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

module.exports = { setWSS, broadcast };
