const CACHE_NAME = 'chef-ia-v11';
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
    caches.open(CACHE_NAME).then((cache) =>
      // cache.addAll() est tout-ou-rien : si UN SEUL fichier de la liste
      // echoue (404, typo, fichier pas encore commite...), toute l'installation
      // du service worker echoue et il n'est jamais active. On met chaque
      // fichier en cache independamment pour qu'un fichier manquant ne bloque
      // plus jamais les mises a jour pour tout le monde.
      Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] precache impossible pour', url, err);
          })
        )
      )
    )
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
// que si le reseau echoue (mode hors-ligne).
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
