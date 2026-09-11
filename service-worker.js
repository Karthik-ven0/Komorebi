/* Komorebi PWA Service Worker — v2 */
'use strict';

const CACHE_NAME = 'komorebi-v2';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './maomao-pet.js',
  './maomao.webp',
  './silence.wav',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

// Precache essential assets on install and skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => console.warn('[SW] Precache failed:', err))
  );
  self.skipWaiting();
});

// Purge obsolete caches on activate and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// Support manual skip-waiting and clear-cache triggers from app
self.addEventListener('message', (event) => {
  if (event.data && (event.data === 'SKIP_WAITING' || event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (event.data && (event.data === 'CLEAR_CACHE' || event.data.type === 'CLEAR_CACHE')) {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});

// Intelligent fetch router with origin isolation
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept external APIs (e.g., Spotify API or Accounts) or non-http protocols
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== location.origin) {
    // Only cache Google Fonts cross-origin if requested, pass through all others
    if (!url.hostname.includes('googleapis.com') && !url.hostname.includes('gstatic.com')) {
      return;
    }
  }

  // 1. HTML Navigation: Network-First (online fetches fresh code, falls back to cache when offline)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return caches.match('./index.html').then((fallback) => fallback || Response.error());
          });
        })
    );
    return;
  }

  // 2. Scripts and Manifest: Network-First with cache fallback
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Static Media (images, audio, icons, fonts): Cache-First with Network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return networkRes;
      });
    })
  );
});

// Background notifications
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if (event.action === 'break') {
            client.postMessage({ type: 'START_BREAK' });
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
