const CACHE_NAME = 'chef-ia-v10';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './Icone.png',
  './Icone-192.png',
  './Icone-192-maskable.png',
  './Icone-512-maskable.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Strategie "reseau d'abord" : on tente toujours de recuperer la version la plus
// recente sur le reseau et on met le cache a jour au passage. Le cache ne sert
// que si le reseau echoue (mode hors-ligne). Cela evite qu'une page mise en cache
// une fois reste figee indefiniment si CACHE_NAME n'est pas change a chaque
// deploiement (ex: onglet Recettes reste invisible pour les utilisateurs deja passes).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
