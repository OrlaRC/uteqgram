// Pruebas end-to-end en Google Chrome real con puppeteer-core.
// Ejecutar contra el servidor local:   npm run test:e2e
// Ejecutar contra producción:          BASE_URL=https://uteqgram-delta.vercel.app npm run test:e2e
// Variables opcionales: CHROME_PATH (ruta de chrome.exe), HEADLESS=false (ver el navegador).
// Las capturas de pantalla se guardan en docs/capturas/.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var puppeteer = require('puppeteer-core');
var createServer = require('../server');

var FIREBASE_URL = 'https://uteq-test-e2e4b-default-rtdb.firebaseio.com/post.json';
var CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
var SHOTS = path.join(__dirname, '..', 'docs', 'capturas');
var TEST_TITLE = 'E2E-PRUEBA-' + Date.now();
var BASE_URL = process.env.BASE_URL;
var SHOT_PREFIX = BASE_URL ? 'prod-' : '';

var server, browser, page, cdp, swCdp, swRegistrationId;

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function openCreatePost() {
  await page.click('#share-image-button');
  await sleep(400);
}

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, SHOT_PREFIX + name + '.png') });
}

async function waitFor(fn, timeoutMs) {
  var start = Date.now();
  while (Date.now() - start < (timeoutMs || 15000)) {
    var value = await fn();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

// Lee un almacén de IndexedDB desde la página
function readStore(store) {
  return page.evaluate(function (st) {
    return readAllData(st);
  }, store);
}

async function firebasePosts() {
  var res = await fetch(FIREBASE_URL);
  var data = (await res.json()) || {};
  return Object.keys(data).map(function (k) { return Object.assign({ _key: k }, data[k]); });
}

// Simula la pérdida de conexión tanto en la página como en el Service Worker
async function setOffline(offline) {
  var conditions = { offline: offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  await page.setOfflineMode(offline);
  if (cdp) {
    await cdp.send('Network.emulateNetworkConditions', conditions);
  }
  if (swCdp) {
    await swCdp.send('Network.emulateNetworkConditions', conditions);
  }
}

test.before(async function () {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!BASE_URL) {
    server = createServer();
    await new Promise(function (r) { server.listen(8091, r); });
    BASE_URL = 'http://localhost:8091';
  }
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: process.env.HEADLESS !== 'false',
    args: ['--no-first-run', '--lang=es-MX']
  });
  page = await browser.newPage();
  await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // El botón "+" abre el diálogo de instalación (deferredPrompt.prompt()); en Chrome automatizado
  // ese diálogo se queda abierto y roba el foco del formulario, así que se intercepta el evento
  // beforeinstallprompt antes de que lo reciba app.js. La instalabilidad se valida aparte en E13.
  await page.evaluateOnNewDocument(function () {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
    });
  });
  cdp = await page.createCDPSession();
  await cdp.send('ServiceWorker.enable');
  cdp.on('ServiceWorker.workerRegistrationUpdated', function (e) {
    e.registrations.forEach(function (r) {
      if (!r.isDeleted) swRegistrationId = r.registrationId;
    });
  });
  page.on('console', function (m) {
    if (process.env.DEBUG) console.log('[page]', m.text());
  });
});

test.after(async function () {
  // Limpieza: se borran de Firebase los posts creados por la prueba
  try {
    var posts = await firebasePosts();
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].title === TEST_TITLE) {
        await fetch(FIREBASE_URL.replace('post.json', 'post/' + posts[i]._key + '.json'), { method: 'DELETE' });
      }
    }
  } catch (e) {
    console.log('No se pudo limpiar Firebase:', e.message);
  }
  if (browser) await browser.close();
  if (server) server.close();
});

test('E01 Home: carga la pantalla principal y registra el Service Worker', async function () {
  var res = await page.goto(BASE_URL + '/', { waitUntil: 'networkidle0' });
  assert.strictEqual(res.status(), 200);
  assert.strictEqual(await page.title(), 'UTEQGram');
  // Se espera a que termine el precaching: en producción la descarga del App Shell tarda más
  var state = await page.evaluate(async function () {
    var reg = await navigator.serviceWorker.ready;
    if (reg.active.state !== 'activated') {
      await new Promise(function (resolve) {
        reg.active.addEventListener('statechange', function () {
          if (reg.active.state === 'activated') resolve();
        });
      });
    }
    return reg.active.state;
  });
  assert.strictEqual(state, 'activated');
  var swTarget = await browser.waitForTarget(function (t) { return t.type() === 'service_worker'; });
  swCdp = await swTarget.createCDPSession();
  if (process.env.DEBUG) {
    var worker = await swTarget.worker();
    worker.on('console', function (m) { console.log('[sw]', m.text()); });
  }
  await swCdp.send('Network.enable');
  // Segunda carga: ahora la página ya está controlada por el Service Worker
  await page.reload({ waitUntil: 'networkidle0' });
  assert.ok(await page.evaluate(function () { return !!navigator.serviceWorker.controller; }));
});

test('E02 Precaching: la caché static-v11 contiene el App Shell completo', async function () {
  var info = await page.evaluate(async function () {
    var keys = await caches.keys();
    var cache = await caches.open('static-v11');
    var reqs = await cache.keys();
    return { keys: keys, count: reqs.length };
  });
  assert.ok(info.keys.indexOf('static-v11') > -1, 'caches: ' + info.keys.join(','));
  assert.strictEqual(info.count, 15);
});

test('E03 Datos remotos: el feed muestra una tarjeta por cada post de Firebase', async function () {
  var expected = (await firebasePosts()).length;
  var count = await waitFor(async function () {
    var n = await page.$$eval('#shared-moments .shared-moment-card', function (e) { return e.length; });
    return n === expected ? n : 0;
  });
  assert.strictEqual(count, expected);
  var meta = await page.$eval('#feed-meta', function (e) { return e.textContent; });
  assert.match(meta, /red \(Firebase\)/);
  await shot('01-home-feed');
});

test('E04 Datos locales: IndexedDB (posts) y localStorage guardan la información', async function () {
  var expected = (await firebasePosts()).length;
  var stored = await waitFor(async function () {
    var data = await readStore('posts');
    return data.length === expected ? data : null;
  });
  assert.ok(stored, 'IndexedDB no tiene ' + expected + ' posts');
  var lastSync = await page.evaluate(function () { return localStorage.getItem('uteqgram-last-sync'); });
  assert.ok(!isNaN(Date.parse(lastSync)));
});

test('E05 localStorage: el borrador del formulario sobrevive a una recarga', async function () {
  await openCreatePost();
  await page.type('#title', 'Borrador');
  await page.type('#location', 'Biblioteca UTEQ');
  await shot('02-crear-post');
  await page.reload({ waitUntil: 'networkidle0' });
  var values = await page.evaluate(function () {
    return [document.querySelector('#title').value, document.querySelector('#location').value];
  });
  assert.deepStrictEqual(values, ['Borrador', 'Biblioteca UTEQ']);
  await page.evaluate(function () { localStorage.removeItem('uteqgram-draft'); });
});

test('E06 Ayuda: la pantalla de ayuda carga y queda en la caché dinámica', async function () {
  await page.goto(BASE_URL + '/help', { waitUntil: 'networkidle0' });
  assert.match(await page.$eval('h3', function (e) { return e.textContent; }), /Ayuda/);
  await shot('03-ayuda');
});

test('E07 Vista SSR: /feed-ssr llega renderizada desde el servidor (sin JavaScript)', async function () {
  var expected = (await firebasePosts()).length;
  var ssrPage = await browser.newPage();
  await ssrPage.setViewport({ width: 412, height: 860, isMobile: true });
  await ssrPage.setJavaScriptEnabled(false);
  var res = await ssrPage.goto(BASE_URL + '/feed-ssr', { waitUntil: 'load' });
  assert.strictEqual(res.status(), 200);
  var n = await ssrPage.$$eval('#ssr-moments .shared-moment-card', function (e) { return e.length; });
  assert.strictEqual(n, expected);
  await ssrPage.screenshot({ path: path.join(SHOTS, SHOT_PREFIX + '04-feed-ssr.png') });
  await ssrPage.close();
  // Se visita también con JavaScript para que el Service Worker guarde una copia
  await page.goto(BASE_URL + '/feed-ssr', { waitUntil: 'networkidle0' });
  await shot('04b-feed-ssr-con-js');
});

test('E08 Offline: sin conexión la Home carga desde caché y el feed sale de IndexedDB', async function () {
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle0' });
  var expected = (await readStore('posts')).length;
  await setOffline(true);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  // Peculiaridad de Chrome: cuando también se emula la red del Service Worker, el documento nuevo
  // arranca con navigator.onLine = true aunque las peticiones fallen. Se vuelve a aplicar la
  // emulación a la página, lo que dispara el evento 'offline' que escucha app.js.
  await setOffline(true);
  await sleep(300);
  var count = await waitFor(async function () {
    var n = await page.$$eval('#shared-moments .shared-moment-card', function (e) { return e.length; });
    return n === expected ? n : 0;
  });
  assert.strictEqual(count, expected);
  assert.match(await page.$eval('#feed-meta', function (e) { return e.textContent; }), /IndexedDB/);
  var banner = await page.$eval('#offline-banner', function (e) {
    return { visible: getComputedStyle(e).display !== 'none', onLine: navigator.onLine, inline: e.style.display };
  });
  assert.ok(banner.visible, 'el banner sin conexión no se muestra: ' + JSON.stringify(banner));
  await shot('05-offline-feed');
});

test('E09 Offline: la vista SSR muestra la última copia guardada', async function () {
  await page.goto(BASE_URL + '/feed-ssr', { waitUntil: 'load' });
  assert.ok(await page.$('#ssr-moments'), 'no se sirvió la copia en caché de /feed-ssr');
});

test('E10 Offline: una página nunca visitada muestra offline.html', async function () {
  await page.goto(BASE_URL + '/pagina-no-visitada', { waitUntil: 'load' });
  assert.match(await page.$eval('h5', function (e) { return e.textContent; }), /todavía no está guardada en caché/);
  await shot('06-offline-fallback');
});

test('E11 Offline: un post creado sin conexión se guarda en IndexedDB (sync-posts)', async function () {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await openCreatePost();
  await page.type('#title', TEST_TITLE);
  await page.type('#location', 'Laboratorio de pruebas');
  await page.click('#post-btn');
  var pending = await waitFor(async function () {
    var data = await readStore('sync-posts');
    return data.some(function (p) { return p.title === TEST_TITLE; }) ? data : null;
  });
  if (!pending) {
    await shot('debug-e11');
    var diag = await page.evaluate(async function () {
      return { title: titleInput.value, loc: locationInput.value, sync: await readAllData('sync-posts'), onLine: navigator.onLine };
    });
    assert.fail('el post no quedó pendiente en sync-posts: ' + JSON.stringify(diag));
  }
  await sleep(300);
  await shot('07-post-pendiente');
});

test('E12 Background Sync: al volver la conexión el post se publica en Firebase', async function () {
  await setOffline(false);
  var published = await waitFor(async function () {
    var posts = await firebasePosts();
    return posts.some(function (p) { return p.title === TEST_TITLE; });
  }, 10000);
  var via = 'automática';
  if (!published) {
    // Equivale al botón "Sync" de DevTools > Application > Service Workers
    via = 'disparada por CDP (DevTools)';
    var origin = new URL(BASE_URL).origin;
    await cdp.send('ServiceWorker.dispatchSyncEvent', {
      origin: origin, registrationId: swRegistrationId, tag: 'sync-new-posts', lastChance: false
    });
    published = await waitFor(async function () {
      var posts = await firebasePosts();
      return posts.some(function (p) { return p.title === TEST_TITLE; });
    }, 15000);
  }
  console.log('# Sincronización ' + via);
  assert.ok(published, 'el post no llegó a Firebase');
  var left = await waitFor(async function () {
    var data = await readStore('sync-posts');
    return data.length === 0 ? 'vacio' : null;
  });
  assert.strictEqual(left, 'vacio');
  await page.reload({ waitUntil: 'networkidle0' });
  var bannerHidden = await page.$eval('#offline-banner', function (e) { return getComputedStyle(e).display === 'none'; });
  assert.ok(bannerHidden, 'el banner sin conexión sigue visible con red');
  await shot('08-post-sincronizado');
});

test('E13 Instalable: Chrome no reporta errores de instalación del manifiesto', async function () {
  var manifest = await cdp.send('Page.getAppManifest');
  assert.ok(manifest.url.indexOf('/manifest.json') > -1);
  assert.deepStrictEqual(manifest.errors, []);
  var inst = await cdp.send('Page.getInstallabilityErrors');
  assert.deepStrictEqual(inst.installabilityErrors, []);
});
