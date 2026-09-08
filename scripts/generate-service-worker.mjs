import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve('out');
const precacheExtensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.png', '.svg', '.ico', '.woff', '.woff2']);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat();
}

const files = (await walk(outputDirectory))
  .filter((file) => path.basename(file) !== 'sw.js' && precacheExtensions.has(path.extname(file)))
  .sort();
const assets = files.map((file) => `./${path.relative(outputDirectory, file).replaceAll('\\', '/')}`);
const hash = createHash('sha256');
for (const file of files) {
  hash.update(path.relative(outputDirectory, file));
  hash.update(await readFile(file));
}
const version = hash.digest('hex').slice(0, 12);

const source = `const CACHE_NAME = 'draft-timer-${version}';
const CACHE_PREFIX = 'draft-timer-';
const PRECACHE = ${JSON.stringify(assets, null, 2)};
const scopedUrl = (asset) => new URL(asset, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map(scopedUrl))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached && event.request.mode !== 'navigate') return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return cached ?? caches.match(scopedUrl('./index.html')) ?? caches.match(scopedUrl('./'));
    }
  })());
});
`;

await writeFile(path.join(outputDirectory, 'sw.js'), source);
console.log(`Generated service worker ${version} with ${assets.length} precached assets.`);
