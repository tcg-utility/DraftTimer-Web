import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve('out');
const basePath = '/DraftTimer-Web';
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith(basePath)) {
    response.writeHead(302, { Location: `${basePath}/` }); response.end(); return;
  }
  pathname = pathname.slice(basePath.length) || '/';
  let file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) file = path.join(root, '404.html');
  response.writeHead(existsSync(file) ? 200 : 404, {
    'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  if (existsSync(file)) createReadStream(file).pipe(response); else response.end('Not found');
}).listen(4173, '127.0.0.1', () => console.log('Static preview: http://127.0.0.1:4173/DraftTimer-Web/'));
