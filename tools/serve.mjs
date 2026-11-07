// Docs: docs/02 - Tech/Testing.md
// Purpose: serves the built app with real services on the network. Keys from .env go to anyone who can open the page.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, '..'), DIST = join(ROOT, 'web/dist');
const env = Object.fromEntries((existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8') : '').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const config = JSON.stringify({ keys: { tmdb: env.TMDB_API_KEY ?? '', omdb: env.OMDB_API_KEY ?? '' } });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const gzips = new Map();
const port = Number(process.env.PORT ?? 8765), bind = process.env.BIND ?? '0.0.0.0';
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(config);
  }
  const file = normalize(join(DIST, p === '/' ? 'index.html' : p));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  // Files under assets/ carry a hash of their content in the name: kept a year. The rest is checked each time,
  // and answered "not modified" when unchanged. Text is compressed when the browser accepts it.
  const st = statSync(file), etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', ETag: etag, 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  let body = readFileSync(file);
  if (/\.(html|js|css|svg|wasm|json)$/.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    body = gzips.get(etag + file) ?? gzipSync(body);
    gzips.set(etag + file, body);
    Object.assign(headers, { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  }
  res.writeHead(200, headers);
  res.end(body);
}).listen(port, bind, () => console.log(`Dholphin on http://${bind}:${port}`));
