// Servidor de desarrollo local: sirve la carpeta public/ igual que Vercel y ejecuta la
// función api/feed.js en la ruta /feed-ssr (equivalente a la regla "rewrites" de vercel.json).
// Uso: npm run dev  ->  http://localhost:8080
var http = require('http');
var fs = require('fs');
var path = require('path');
var feedHandler = require('./api/feed');

var PORT = Number(process.env.PORT) || 8080;
var PUBLIC_DIR = path.join(__dirname, 'public');
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function createServer() {
  return http.createServer(function (req, res) {
    var urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath === '/feed-ssr' || urlPath === '/api/feed') {
      return feedHandler(req, res);
    }

    var filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (filePath.indexOf(PUBLIC_DIR) !== 0) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }
    // Igual que Vercel: /help sirve /help/index.html sin redirección
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    fs.readFile(filePath, function (err, content) {
      if (err) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('404 - No encontrado');
      }
      var headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' };
      headers['Cache-Control'] = path.basename(filePath) === 'sw.js' ? 'no-cache' : 'public, max-age=0, must-revalidate';
      res.writeHead(200, headers);
      res.end(content);
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, function () {
    console.log('UTEQGram en http://localhost:' + PORT);
  });
}

module.exports = createServer;
