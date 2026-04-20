const CACHE  = 'shopping-v5';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png'];

self.addEventListener('install',  e => { e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('onrender.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok && res.status===200) caches.open(CACHE).then(c=>c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const d = e.data.json();
    e.waitUntil(self.registration.showNotification(d.title||'買い物メモ', {
      body:d.body||'', icon:'./icon-192.png', badge:'./icon-192.png',
      vibrate:[200,100,200], tag:'shopping-update', renotify:true
    }));
  } catch {}
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(list => {
    for (const c of list) if (c.url.includes('shopping-app') && 'focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
