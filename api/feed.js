// Vercel Function: genera la vista "Feed (servidor)" con renderizado del lado del servidor (SSR).
// El servidor consulta Firebase Realtime Database, arma el HTML completo y lo envía al navegador,
// que solo tiene que mostrarlo (no necesita ejecutar JavaScript para ver los posts).
// Se expone en /feed-ssr mediante la regla "rewrites" de vercel.json.

var FIREBASE_URL = 'https://uteq-test-e2e4b-default-rtdb.firebaseio.com/post.json';

// Evita que el texto capturado por los usuarios se interprete como HTML (prevención de XSS)
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convierte el objeto { clave: post } de Firebase en un arreglo ordenado del más reciente al más antiguo
function toSortedArray(data) {
  var posts = [];
  for (var key in data || {}) {
    if (data[key] && typeof data[key] === 'object') {
      posts.push(data[key]);
    }
  }
  // Los id son fechas ISO; los que no son fecha (posts de prueba) quedan al final
  posts.sort(function (a, b) {
    return (Date.parse(b.id) || 0) - (Date.parse(a.id) || 0);
  });
  return posts;
}

function formatDate(id) {
  var date = new Date(id);
  if (isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
}

function renderCard(post) {
  var image = /^\/[\w\-\/.]+$/.test(post.image || '') ? post.image : '/src/images/sf-boat.jpg';
  return '' +
    '<div class="shared-moment-card mdl-card mdl-shadow--2dp">' +
      '<div class="mdl-card__title" style="background-image:url(' + image + ');background-size:cover;height:180px;">' +
        '<h2 class="mdl-card__title-text" style="color:white;">' + escapeHtml(post.title) + '</h2>' +
      '</div>' +
      '<div class="mdl-card__supporting-text" style="text-align:center;">' +
        escapeHtml(post.location) +
        '<br><small>' + escapeHtml(formatDate(post.id)) + '</small>' +
      '</div>' +
    '</div>';
}

function renderPage(posts, renderedAt, errorMessage) {
  var content;
  if (errorMessage) {
    content = '<p class="text-center">No fue posible consultar la base de datos: ' + escapeHtml(errorMessage) + '</p>';
  } else if (posts.length === 0) {
    content = '<p class="text-center">Todavía no hay publicaciones.</p>';
  } else {
    content = posts.map(renderCard).join('');
  }

  return '<!doctype html>' +
'<html lang="es">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <title>UTEQGram · Feed (servidor)</title>' +
'  <link rel="icon" href="data:,">' +
'  <link href="https://fonts.googleapis.com/css?family=Roboto:400,700" rel="stylesheet">' +
'  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">' +
'  <link rel="stylesheet" href="/src/css/material.indigo-pink.min.css">' +
'  <link rel="stylesheet" href="/src/css/app.css">' +
'  <link rel="stylesheet" href="/src/css/feed.css">' +
'  <link rel="manifest" href="/manifest.json">' +
'  <meta name="theme-color" content="#3f51b5">' +
'</head>' +
'<body>' +
'<div id="app">' +
'  <div class="mdl-layout mdl-js-layout mdl-layout--fixed-header">' +
'    <header class="mdl-layout__header">' +
'      <div class="mdl-layout__header-row">' +
'        <span class="mdl-layout-title">UTEQGram</span>' +
'        <div class="mdl-layout-spacer"></div>' +
'        <nav class="mdl-navigation mdl-layout--large-screen-only">' +
'          <a class="mdl-navigation__link" href="/">Feed</a>' +
'          <a class="mdl-navigation__link" href="/feed-ssr">Feed (servidor)</a>' +
'          <a class="mdl-navigation__link" href="/help">Ayuda</a>' +
'        </nav>' +
'      </div>' +
'    </header>' +
'    <div class="mdl-layout__drawer">' +
'      <span class="mdl-layout-title">UTEQGram</span>' +
'      <nav class="mdl-navigation">' +
'        <a class="mdl-navigation__link" href="/">Feed</a>' +
'        <a class="mdl-navigation__link" href="/feed-ssr">Feed (servidor)</a>' +
'        <a class="mdl-navigation__link" href="/help">Ayuda</a>' +
'      </nav>' +
'    </div>' +
'    <main class="mdl-layout__content mat-typography">' +
'      <div class="page-content">' +
'        <h5 class="text-center mdl-color-text--primary">Feed generado en el servidor</h5>' +
'        <p class="text-center ssr-meta" id="ssr-meta">' + posts.length + ' publicaciones · renderizado el ' +
           escapeHtml(renderedAt) + ' (hora del centro de México)</p>' +
'        <div id="ssr-moments">' + content + '</div>' +
'      </div>' +
'    </main>' +
'  </div>' +
'</div>' +
'<script defer src="/src/js/material.min.js"></script>' +
'</body>' +
'</html>';
}

module.exports = async function handler(req, res) {
  var renderedAt = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  try {
    var response = await fetch(FIREBASE_URL);
    if (!response.ok) {
      throw new Error('Firebase respondió ' + response.status);
    }
    var posts = toSortedArray(await response.json());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // La CDN de Vercel guarda la página 10 s y la renueva en segundo plano
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=59');
    res.statusCode = 200;
    res.end(renderPage(posts, renderedAt));
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(renderPage([], renderedAt, err.message));
  }
};

// Se exportan para las pruebas unitarias (tests/unit.test.js)
module.exports.escapeHtml = escapeHtml;
module.exports.toSortedArray = toSortedArray;
module.exports.renderPage = renderPage;
