// Docs: docs/04 - Architecture/Server.md
// Purpose: the web app from a Dholphin server behind a proxy that says nothing (nginx's defaults) under a path: it finds its data and Jellyfin.
// Run: E2E=tests/e2e/behind-proxy.mjs tools/test_e2e.sh
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createDoubles } from '../doubles/server.mjs';

const ROOT = join(import.meta.dirname, '../..');
const OUT = process.env.OUT ?? '/tmp/dholphin-e2e';
mkdirSync(OUT, { recursive: true });
let passed = 0;
const check = (name, ok, more = '') => {
  assert.ok(ok, `${name} ${more}`);
  passed++;
  console.log(`  ok  ${name}`);
};

// The stand-in Jellyfin, on the "home network".
const doubles = createDoubles();
await new Promise((r) => doubles.listen(8799, '127.0.0.1', r));
// The Dholphin server, on its own port, as in its container.
const dh = spawn(process.execPath, [join(ROOT, 'server/main.mjs')], {
  env: { ...process.env, PORT: '8796', DATA: mkdtempSync(join(tmpdir(), 'dholphin-proxy-')), DHOLPHIN_PASSWORD: 'household-pass', NODE_ENV: 'production' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
// A proxy with nginx's defaults: `location /dholphin/ { proxy_pass http://dholphin:8080/; }`. The prefix is cut, Host
// becomes the proxy's name for the server, and no X-Forwarded-* header is added.
const proxy = createServer((req, res) => {
  if (!req.url.startsWith('/dholphin/')) { res.writeHead(404); return res.end(); }
  const headers = { ...req.headers, host: 'dholphin:8080' };
  const up = request({ host: '127.0.0.1', port: 8796, method: req.method, path: req.url.slice('/dholphin'.length), headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});
await new Promise((r) => proxy.listen(8797, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8797/dholphin/';
for (let i = 0; i < 50; i++) {
  if (await fetch(`${BASE}api/status`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  const urls = [];
  p.on('request', (r) => urls.push(r.url()));
  await p.goto(BASE);
  await p.fill('#pw', 'household-pass');
  await p.click('#go');
  await p.waitForLoadState('networkidle');
  check('The sign-in page works under the path', !(await p.locator('#pw').count()));

  // The household: a profile linked to Jellyfin, which the server only reaches on its network (relayed).
  const api = (path, data, method = 'PUT') => p.request.fetch(BASE + path, { method, data });
  await api('api/admin/settings', { jellyfin: 'http://127.0.0.1:8799/api/jf', keys: { tmdb: 'k' } }, 'POST');
  await api('api/store/profiles', { value: [{ id: 'pa', name: 'Ann', color: '#2C6E91', language: 'en-US', region: 'US', maturity: '18+' }] });
  await api('api/store/setupDone', { value: true });
  await api('api/store/prov:jellyfin:link:pa', { value: { token: 'test-token', userId: 'u1', deviceId: 'd1' } });
  const said = await (await p.request.get(`${BASE}config.json`)).json();
  check('The server alone can only guess its address from what the proxy sent', said.server.origin === 'http://dholphin:8080', said.server.origin);

  urls.length = 0;
  await p.goto(BASE);
  // One profile: the app opens it, and its Home reads Jellyfin's library.
  await p.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/api/r/')), null, { timeout: 20000 });
  await p.waitForFunction(() => document.body.innerText.includes('Ann'), null, { timeout: 15000 });
  check('The app finds the household: its profile, not a new setup', !/Set up Dholphin|How does this device run/i.test(await p.locator('body').innerText()));
  await p.screenshot({ path: join(OUT, 'behind-proxy.png') });
  check('Jellyfin goes through the relay at the address the app reached', urls.some((u) => u.startsWith(`${BASE}api/r/`) && u.includes('/jellyfin/')));
  const wrong = urls.filter((u) => u.includes('dholphin:8080'));
  check('Nothing is asked of the address the server guessed', wrong.length === 0, wrong.slice(0, 3).join(' '));
  const relayed = await p.evaluate(async (b) => (await fetch(performance.getEntriesByType('resource').find((e) => e.name.startsWith(`${b}api/r/`)).name)).status, BASE);
  check('The relay answers there', relayed === 200, String(relayed));
  console.log(`behind-proxy: ${passed} checks passed`);
} finally {
  await browser.close();
  proxy.close();
  doubles.close();
  dh.kill();
}
