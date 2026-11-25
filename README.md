# UTEQGram — Aplicación Web Progresiva

PWA para que la comunidad de la Universidad Tecnológica de Querétaro (UTEQ) comparta momentos
(título + ubicación) en un feed común. Funciona sin conexión, se puede instalar en el dispositivo y
sincroniza en segundo plano las publicaciones creadas sin internet.

**Aplicación publicada:** https://uteqgram-delta.vercel.app  
**Repositorio:** https://github.com/OrlaRC/uteqgram  
**Documento técnico:** [`docs/Documento_Tecnico_UTEQGram.docx`](docs/Documento_Tecnico_UTEQGram.docx)

## Pantallas

| Ruta | Pantalla | Tipo de renderizado |
|------|----------|---------------------|
| `/` | Home / Feed + formulario "Crear publicación" | Cliente (JavaScript + DOM) |
| `/feed-ssr` | Feed generado en el servidor | Servidor (Vercel Function `api/feed.js`) |
| `/help` | Ayuda | Estática |
| `/offline.html` | Página de respaldo sin conexión | Estática, servida por el Service Worker |

## Datos

| Tipo | Tecnología | Uso |
|------|-----------|-----|
| Remotos | Firebase Realtime Database (REST) | Fuente oficial de las publicaciones (`/post.json`) |
| Locales | IndexedDB (`posts-store`: `posts`, `sync-posts`) | Copia del feed y cola de posts pendientes |
| Locales | localStorage (`uteqgram-draft`, `uteqgram-last-sync`) | Borrador del formulario y fecha de la última descarga |
| Offline | Cache Storage (`static-v11`, `dynamic-v11`) + Background Sync | App Shell, páginas visitadas y envío diferido |

## Estructura

```
api/feed.js              Vercel Function: renderizado del feed en el servidor
public/                  Sitio estático publicado
  index.html             Home / Feed
  help/index.html        Ayuda
  offline.html           Respaldo sin conexión
  manifest.json          Manifiesto de la PWA
  sw.js                  Service Worker (caché, IndexedDB, Background Sync, notificaciones)
  src/js/app.js          Registro del SW, instalación, notificaciones, estado de conexión
  src/js/feed.js         Vista del feed del lado del cliente, formulario, localStorage
  src/js/utility.js      Funciones de acceso a IndexedDB
  src/js/idb.js          Librería idb (promesas sobre IndexedDB)
server.js                Servidor de desarrollo local (sirve public/ y /feed-ssr)
tests/                   Pruebas unitarias y end-to-end
docs/                    Documento técnico, capturas y evidencia de pruebas
vercel.json              Configuración de despliegue
```

## Ejecutar en local

Requisitos: Node.js 18 o superior.

```bash
npm install
npm run dev          # http://localhost:8080  (incluye /feed-ssr)
```

`npm start` sirve solo los archivos estáticos con `http-server` (sin la vista SSR).

## Pruebas

```bash
npm run test:unit    # 8 pruebas unitarias y de configuración (node:test)
npm run test:e2e     # 13 pruebas end-to-end en Google Chrome (puppeteer-core)
BASE_URL=https://uteqgram-delta.vercel.app npm run test:e2e   # contra producción
```

Las pruebas E2E usan el Chrome instalado (`CHROME_PATH` para otra ruta), crean un post de prueba en
Firebase y lo eliminan al terminar. Las capturas se guardan en `docs/capturas/`.

## Despliegue (Vercel)

```bash
npm install -g vercel
vercel login
vercel --prod
```

Configuración: Framework Preset *Other*, Build Command vacío, Output Directory `public`.
`vercel.json` enruta `/feed-ssr` a la función `api/feed.js` y desactiva la caché HTTP de `sw.js`.

## Autor

Orlando Rubio Cabrera — Ingeniería en Desarrollo y Gestión de Software, UTEQ.
