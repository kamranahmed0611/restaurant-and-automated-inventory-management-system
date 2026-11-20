// Muchachos POS — Service Worker
// Offline-first caching strategy for the POS terminal

const CACHE_NAME = 'muchachos-pos-v1';

// Core app shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/kds',
  '/admin',
  '/login',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Install: Pre-cache the app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Muchachos POS Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      // Use addAll with individual catches so one failure doesn't block install
      return Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache ${url}:`, err);
          })
        )
      );
    })
  );
  // Activate immediately without waiting for old SW to stop
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// Fetch: Network-first for API/data, Cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST orders, etc.)
  if (request.method !== 'GET') return;

  // Skip Supabase API calls — these must always hit the network
  if (url.hostname.includes('supabase')) return;

  // Skip Next.js HMR and webpack dev server in development
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;
  if (url.pathname.includes('.hot-update.')) return;

  // Skip Chrome DevTools requests
  if (url.pathname.startsWith('/.well-known/')) return;

  // Strategy: Network-first with cache fallback for navigation (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful page responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline: serve from cache
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // Fallback to root page (SPA-like behavior)
            return caches.match('/');
          });
        })
    );
    return;
  }

  // Strategy: Cache-first for static assets (JS, CSS, images, fonts)
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Strategy: Network-first for Next.js data fetches and API routes
  if (
    url.pathname.startsWith('/_next/data/') ||
    url.pathname.startsWith('/api/')
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Default: Network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Listen for messages from the app (e.g., to trigger cache updates)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache cleared on request');
    });
  }
});
