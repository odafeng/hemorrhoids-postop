const CACHE_NAME = 'postop-tracker-v8';
const CACHE_PREFIX = 'postop-tracker-';
const STATIC_ASSETS = [
  '/icon.svg',
  '/favicon.svg',
  '/icon-192.png',
  '/badge-96.png',
  '/manifest.json',
];

// Install — pre-cache only truly static assets (NOT index.html)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches + notify clients about update
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // A cache from a PREVIOUS version means this activation is an upgrade,
      // not a first install. The page no longer auto-reloads on
      // controllerchange, so a first-install notification would surface a
      // bogus "系統已更新" banner to someone who just opened the app for the
      // first time.
      const stale = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
      const isUpgrade = stale.length > 0;
      return Promise.all(stale.map((key) => caches.delete(key))).then(() => isUpgrade);
    }).then((isUpgrade) => {
      if (!isUpgrade) return;
      // Notify open clients so <UpdateBanner> can offer a reload. We do NOT
      // reload for them: a deploy mid-visit would discard whatever the patient
      // had typed into the symptom report.
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
      });
    })
  );
  self.clients.claim();
});

// Allow page to trigger immediate activation of a waiting worker
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Fetch — network-first for HTML/JS/CSS, cache-first for icons
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Cache API only supports http(s); skip chrome-extension, moz-extension, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Network-first for Supabase API calls
  if (url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(request))
    );
    return;
  }

  // Safe cache.put — swallow errors (e.g. unsupported schemes, quota, aborted)
  const safePut = (req, res) => {
    try {
      caches.open(CACHE_NAME)
        .then((cache) => cache.put(req, res))
        .catch(() => {});
    } catch {
      // Caching is best-effort; a failed put must never break the response.
    }
  };

  // Network-first for navigation (HTML) and hashed assets (JS/CSS)
  if (request.mode === 'navigate' || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) safePut(request, response.clone());
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for truly static assets (icons, manifest)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) safePut(request, response.clone());
        return response;
      });
    })
  );
});

// =====================================================
// Push Notification — receive server push (future use)
// =====================================================
self.addEventListener('push', (event) => {
  const defaults = {
    title: '術後追蹤提醒 🏥',
    body: '您今日尚未填寫症狀回報，請花 30 秒完成填寫。',
    // PNG, not SVG: Android Chrome cannot decode an SVG notification icon and
    // silently falls back to a generic bell, so the daily reminder loses all
    // brand recognition. iOS ignores this field and uses the home-screen icon.
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: 'daily-reminder',
    data: { action: 'open-report' },
  };

  let payload = defaults;
  if (event.data) {
    try {
      const data = event.data.json();
      payload = { ...defaults, ...data };
    } catch {
      payload.body = event.data.text() || defaults.body;
    }
  }

  // iOS Web Push (16.4+) doesn't reliably support `actions`; if showNotification
  // rejects, Apple's push gateway will retry the delivery, causing duplicate
  // notifications to stack. Wrap in try/catch and fall back to a minimal option
  // set so the outer promise ALWAYS resolves and Apple sees the push as ACKed.
  const fullOpts = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    vibrate: payload.vibrate || [200, 100, 200],
    data: payload.data,
    actions: [
      { action: 'report', title: '立即填寫' },
      { action: 'dismiss', title: '稍後' },
    ],
  };
  const minimalOpts = {
    body: payload.body,
    icon: payload.icon,
    tag: payload.tag,
    data: payload.data,
  };

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(payload.title, fullOpts);
    } catch (e) {
      console.warn('[SW push] full showNotification failed, falling back:', e);
      try {
        await self.registration.showNotification(payload.title, minimalOpts);
      } catch (e2) {
        console.error('[SW push] minimal showNotification also failed:', e2);
      }
    }
  })());
});

// =====================================================
// Notification Click — navigate to symptom report
// =====================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Dismiss action — do nothing
  if (event.action === 'dismiss') return;

  // Open or focus the app, navigate to report page
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If app is already open, focus it and navigate
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', tab: 'report' });
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow('/?tab=report');
    })
  );
});
