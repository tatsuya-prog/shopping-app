let wss      = null;
let notifyFn = null;

function setWSS(server)       { wss      = server; }
function setNotifyHook(fn)    { notifyFn = fn;     }

function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function queueNotification(type, payload) {
  if (notifyFn) notifyFn(type, payload);
}

module.exports = { setWSS, setNotifyHook, broadcast, queueNotification };
