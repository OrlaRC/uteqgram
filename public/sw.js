importScripts('/src/js/idb.js');
importScripts('/src/js/utility.js');

var CACHE_STATIC = 'static-v11';
var CACHE_DYNAMIC = 'dynamic-v11';
var APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/src/js/app.js',
  '/src/js/feed.js',
  '/src/js/idb.js',
  '/src/js/utility.js',
  '/src/js/material.min.js',
  '/src/css/app.css',
  '/src/css/feed.css',
  '/src/css/material.indigo-pink.min.css',
  '/src/images/main-image-lg.jpg',
  'https://fonts.googleapis.com/css?family=Roboto:400,700',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

// Se dispara cuando el navegador instala el service worker
self.addEventListener('install', function (event) {
  console.log('[Service Worker] Instalando...', event);
  // Precaching: se guarda el App Shell antes de terminar la instalación
  event.waitUntil(
    caches.open(CACHE_STATIC).then(function (cache) {
      console.log('[Service Worker] Precacheando App Shell');
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Se dispara cuando el service worker se activa y toma el control
self.addEventListener('activate', function (event) {
  console.log('[Service Worker] Activando...', event);
  // Se borran los cachés de versiones anteriores
  event.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(keyList.map(function (key) {
        if (key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
          console.log('[Service Worker] Borrando caché viejo:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

// Comprueba si la URL pedida es uno de los archivos del App Shell
function isInArray(string, array) {
  var cachePath;
  if (string.indexOf(self.origin) === 0) {
    // Petición a nuestro propio servidor: se quita "http://127.0.0.1:8080"
    cachePath = string.substring(self.origin.length);
  } else {
    // Petición a otro dominio (p. ej. Google Fonts): se deja la URL completa
    cachePath = string;
  }
  return array.indexOf(cachePath) > -1;
}

// Se dispara con cada petición que hace la página (HTML, CSS, JS, imágenes...)
self.addEventListener('fetch', function (event) {
  var url = 'https://uteq-test-e2e4b-default-rtdb.firebaseio.com/post.json';

  // Solo se gestionan peticiones GET; los POST (envío de posts) van directo a la red
  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.url.indexOf(url) > -1) {
    // Siempre va a la red y guarda los posts en IndexedDB
    event.respondWith(
      fetch(event.request)
        .then(function (res) {
          var clonedRes = res.clone();
          clearAllData('posts')
            .then(function () {
              return clonedRes.json();
            })
            .then(function (data) {
              for (var key in data) {
                writeData('posts', data[key]);
              }
            });
          return res;
        })
    );
  } else if (event.request.url.indexOf('/feed-ssr') > -1) {
    // Network first: la vista generada en el servidor siempre se pide a la red para
    // tener los datos al día; si no hay conexión se muestra la última copia guardada.
    event.respondWith(
      fetch(event.request)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_DYNAMIC).then(function (cache) {
            cache.put(event.request.url, copy);
          });
          return res;
        })
        .catch(function () {
          return caches.match(event.request.url).then(function (cached) {
            return cached || caches.match('/offline.html');
          });
        })
    );
  } else if (isInArray(event.request.url, APP_SHELL)) {
    // Cache only: los archivos del App Shell se sirven directamente de la caché
    event.respondWith(
      caches.match(event.request)
    );
  } else {
    // Cache, falling back to network: primero caché, si no está va a la red
    event.respondWith(
      caches.match(event.request)
        .then(function (response) {
          if (response) {
            return response;
          } else {
            return fetch(event.request)
              .then(function (res) {
                return caches.open(CACHE_DYNAMIC)
                  .then(function (cache) {
                    cache.put(event.request.url, res.clone());
                    return res;
                  });
              })
              .catch(function (err) {
                // Sin conexión y sin caché: si se pedía una página se muestra offline.html
                var accept = event.request.headers.get('accept') || '';
                if (accept.indexOf('text/html') > -1) {
                  return caches.open(CACHE_STATIC)
                    .then(function (cache) {
                      return cache.match('/offline.html');
                    });
                }
                return Response.error();
              });
          }
        })
    );
  }
});

// Se dispara cuando vuelve la conexión y hay una sincronización pendiente
self.addEventListener('sync', function (event) {
  console.log('[Service Worker] Background syncing', event);
  if (event.tag === 'sync-new-posts') {
    console.log('[Service Worker] Syncing new Posts');
    event.waitUntil(
      readAllData('sync-posts')
        .then(function (data) {
          // map crea una variable 'dt' distinta para cada post, así cada respuesta
          // borra su propio post (con 'var dt of data' se borraba solo el último).
          // Promise.all hace que waitUntil espere a que terminen todos los envíos.
          return Promise.all(data.map(function (dt) {
            return fetch('https://uteq-test-e2e4b-default-rtdb.firebaseio.com/post.json', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                id: dt.id,
                title: dt.title,
                location: dt.location,
                image: '/src/images/sf-boat.jpg'
              })
            })
              .then(function (res) {
                console.log('Sent data', res);
                if (!res.ok) {
                  throw new Error('Firebase respondió ' + res.status);
                }
                return deleteItemFromData('sync-posts', dt.id);
              })
              .catch(function (err) {
                // Se vuelve a lanzar el error para que la sincronización falle y
                // Chrome la reintente más tarde (si se atrapa aquí, Chrome cree
                // que salió bien y el post se queda atorado en IndexedDB).
                console.log('Error while sending data', err);
                throw err;
              });
          }));
        })
        .then(function (results) {
          // Si el usuario aceptó las notificaciones, se le avisa que sus posts ya se publicaron
          if (results.length > 0 && self.Notification && Notification.permission === 'granted') {
            self.registration.showNotification('Publicaciones sincronizadas', {
              body: results.length + ' publicación(es) pendiente(s) se enviaron a UTEQGram.',
              icon: '/src/images/icons/app-icon-96x96.png',
              badge: '/src/images/icons/app-icon-96x96.png',
              tag: 'posts-synced',
              data: { url: '/' }
            });
          }
          // Avisa a las páginas abiertas para que vuelvan a cargar el feed
          return self.clients.matchAll().then(function (clients) {
            clients.forEach(function (client) {
              client.postMessage('posts-synced');
            });
          });
        })
    );
  }
});

// Se dispara cuando el usuario toca una notificación: enfoca la app o la abre
self.addEventListener('notificationclick', function (event) {
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if ('focus' in clients[i]) {
          return clients[i].focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
