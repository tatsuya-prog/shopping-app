let wss = null;
let notifyFn = null;

function setWSS(server) { wss = server; }

// 通知フックを登録（broadcastの外から呼ぶ）
function setNotifyHook(fn) { notifyFn = fn; }

function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// 通知キューに積む（broadcastとは完全に分離）
function queueNotification(type, payload) {
  if (notifyFn) notifyFn(type, payload);
}

module.exports = { setWSS, setNotifyHook, broadcast, queueNotification };
