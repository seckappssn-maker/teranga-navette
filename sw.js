// Teranga Navette - ouverture sans internet
const CACHE = 'teranga-navette-v1';
const BASE = [
  './',
  './index.html',
  './config.json',
  './apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(BASE.map(u => c.add(u).catch(() => {})))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('teranga-navette-') && k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

function fromNetwork(req, ms) {
  return new Promise((ok, ko) => {
    const t = setTimeout(ko, ms);
    fetch(req).then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); ko(e); });
  });
}

// Internet d'abord (version a jour), sinon la copie du telephone
function networkFirst(req, key, fallback) {
  return fromNetwork(req, 6000).then(r => {
    if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(key, { ignoreSearch: true })
    .then(r => r || (fallback ? caches.match(fallback) : Response.error())));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Les donnees (Supabase) et les notifications ne passent jamais par le cache
  if (/supabase\.(co|in)$|ntfy\.sh$/.test(url.hostname)) return;

  const sameSite = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, req, './index.html'));
    return;
  }
  if (sameSite && url.pathname.endsWith('/config.json')) {
    e.respondWith(networkFirst(req, './config.json'));
    return;
  }

  // Images, polices, bibliotheque : la copie d'abord, mise a jour en arriere-plan
  const cdn = /jsdelivr\.net|unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (!sameSite && !cdn) return;
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

// Notifications : une nouvelle commande arrive même si l'app est fermée.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Teranga Navette', {
    body: d.body || '', tag: d.tag || 'commande', renotify: true,
    icon: './apple-touch-icon.png', badge: './apple-touch-icon.png', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const scope = self.registration.scope;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(scope) && !/(menu|shop|reserver)\.html/.test(w.url)) { await w.focus(); return; }
    await self.clients.openWindow(scope);
  })());
});
