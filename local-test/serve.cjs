// Minimal static server for preview.html: node local-test/serve.cjs [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'};
http.createServer((req, res) => {
  let file;
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    file = path.resolve(root, '.' + pathname);
  } catch {
    res.writeHead(400); res.end(); return;
  }
  const relative = path.relative(root, file);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) ||
      !fs.statSync(file, {throwIfNoEntry: false})?.isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.argv[2] || 8765), '127.0.0.1', () => console.log('serving ' + root));
