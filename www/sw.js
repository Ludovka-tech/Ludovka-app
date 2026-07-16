// Ľudovka service worker — caches the whole app shell so it works fully offline
// once it has been opened at least once. Bump CACHE_NAME whenever any of the
// files below change, so returning visitors pick up the update.
const CACHE_NAME = 'ludovka-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './seed-songs.js',
  './xlsx.min.js',
  './ornament.svg',
  './manifest.json',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(name){ return name !== CACHE_NAME; })
             .map(function(name){ return caches.delete(name); })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

// Cache-first for everything in the app shell (this app has no server/API —
// all data lives in IndexedDB on-device), falling back to network, and to the
// cached index.html for any navigation that isn't otherwise cached.
self.addEventListener('fetch', function(event){
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function(cached){
      if (cached) return cached;

      return fetch(event.request).then(function(response){
        if (response && response.ok && response.type === 'basic'){
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function(){
        if (event.request.mode === 'navigate'){
          return caches.match('./index.html');
        }
      });
    })
  );
});
