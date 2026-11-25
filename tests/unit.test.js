// Pruebas unitarias y de configuración (node:test, sin dependencias externas)
// Ejecutar: npm run test:unit
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var feed = require('../api/feed');

var ROOT = path.join(__dirname, '..');
var PUBLIC = path.join(ROOT, 'public');

test('U01 escapeHtml neutraliza etiquetas HTML (prevención de XSS)', function () {
  assert.strictEqual(
    feed.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.strictEqual(feed.escapeHtml(null), '');
});

test('U02 toSortedArray convierte el objeto de Firebase y ordena del más reciente al más antiguo', function () {
  var result = feed.toSortedArray({
    a: { id: '2026-11-01T10:00:00.000Z', title: 'viejo' },
    b: { id: '2026-11-20T10:00:00.000Z', title: 'nuevo' },
    c: null
  });
  assert.deepStrictEqual(result.map(function (p) { return p.title; }), ['nuevo', 'viejo']);
  assert.deepStrictEqual(feed.toSortedArray(null), []);
});

test('U03 renderPage genera una tarjeta por publicación con el texto escapado', function () {
  var html = feed.renderPage([{ id: '2026-11-20T10:00:00.000Z', title: '<b>Hola</b>', location: 'UTEQ', image: '/src/images/sf-boat.jpg' }], 'ahora');
  assert.match(html, /<html lang="es">/);
  assert.strictEqual((html.match(/shared-moment-card/g) || []).length, 1);
  assert.match(html, /&lt;b&gt;Hola&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Hola<\/b>/);
});

function fakeResponse() {
  return {
    headers: {}, statusCode: 0, body: '',
    setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; },
    end: function (b) { this.body = b; }
  };
}

test('U04 handler SSR responde 200 con HTML cuando Firebase responde', async function () {
  var originalFetch = global.fetch;
  global.fetch = async function () {
    return { ok: true, json: async function () { return { k1: { id: '2026-11-20T10:00:00.000Z', title: 'T', location: 'L' } }; } };
  };
  try {
    var res = fakeResponse();
    await feed({}, res);
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.headers['cache-control'], /s-maxage=10/);
    assert.match(res.body, /1 publicaciones/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('U05 handler SSR responde 502 con mensaje de error si Firebase falla', async function () {
  var originalFetch = global.fetch;
  global.fetch = async function () { return { ok: false, status: 503 }; };
  try {
    var res = fakeResponse();
    await feed({}, res);
    assert.strictEqual(res.statusCode, 502);
    assert.match(res.body, /Firebase respondió 503/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('U06 manifest.json cumple los requisitos de instalación de una PWA', function () {
  var manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'));
  ['name', 'short_name', 'start_url', 'display', 'theme_color', 'background_color'].forEach(function (k) {
    assert.ok(manifest[k], 'falta ' + k);
  });
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].indexOf(manifest.display) > -1);
  var sizes = manifest.icons.map(function (i) { return i.sizes; });
  assert.ok(sizes.indexOf('192x192') > -1 && sizes.indexOf('512x512') > -1, 'faltan iconos 192 y 512');
  manifest.icons.forEach(function (icon) {
    assert.ok(fs.existsSync(path.join(PUBLIC, icon.src)), 'no existe ' + icon.src);
  });
});

test('U07 todos los archivos locales del App Shell existen en public/', function () {
  var sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  var shell = JSON.parse(sw.match(/var APP_SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  shell.filter(function (p) { return p.indexOf('http') !== 0; }).forEach(function (p) {
    var file = p === '/' ? '/index.html' : p;
    assert.ok(fs.existsSync(path.join(PUBLIC, file)), 'no existe ' + p);
  });
});

test('U08 vercel.json publica public/, enruta /feed-ssr y desactiva la caché HTTP de sw.js', function () {
  var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.strictEqual(cfg.outputDirectory, 'public');
  assert.ok(cfg.rewrites.some(function (r) { return r.source === '/feed-ssr' && r.destination === '/api/feed'; }));
  var swHeaders = cfg.headers.find(function (h) { return h.source === '/sw.js'; }).headers;
  assert.ok(swHeaders.some(function (h) { return h.key === 'Cache-Control' && h.value === 'no-cache'; }));
});
