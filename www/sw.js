// Offline cache for the web/PWA build. Bump VERSION when files change.
const VERSION = 'quillpad-v2';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/state.js', 'js/doc.js', 'js/history.js', 'js/brush.js', 'js/quickshape.js', 'js/color.js',
  'js/filters.js', 'js/editor.js', 'js/input.js', 'js/ui.js', 'js/icons.js', 'js/gallery.js', 'js/storage.js',
  'js/psd.js', 'js/share.js', 'js/timelapse.js', 'js/animation.js', 'js/gif.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// network first (so updates arrive), falling back to the cache when offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
