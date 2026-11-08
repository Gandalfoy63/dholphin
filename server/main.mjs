// Docs: docs/04 - Architecture/Server.md
// Purpose: Dholphin's server: the household's data and keys, the web app, a panel to manage it, a relay to Jellyfin and Seerr.
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { checkPassword, deviceByRelay, deviceByToken, hashPassword, limiter, newDevice, openState, pairing, removeDevice } from './state.mjs';
import { upstream } from './upstream.mjs';

const HERE = import.meta.dirname;
const DATA = process.env.DATA ?? join(HERE, '..', 'data');
const DIST = process.env.DIST ?? join(HERE, '..', 'web', 'dist');
const PORT = Number(process.env.PORT ?? 8080);
// Behind Traefik, the visitor's address and the public scheme and host come in X-Forwarded-* headers.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const VERSION = (() => { try { return readFileSync(join(HERE, '..', 'VERSION'), 'utf8').trim(); } catch { return 'dev'; } })();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

export const state = openState(DATA);
const up = upstream(join(DATA, 'cache'), state.settings);
const pairs = pairing();
const loginLimit = limiter(10), pairLimit = limiter(10);
if (process.env.DHOLPHIN_PASSWORD && !state.settings.data.password) {
  state.settings.data.password = await hashPassword(process.env.DHOLPHIN_PASSWORD);
  state.settings.save();
}
if (!state.settings.data.password) console.log(`Dholphin first setup code: ${state.setupCode}  (open /panel to set the household password)`);

// ---------- small helpers ----------
const ipOf = (req) => (TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
const originOf = (req) => {
  const proto = TRUST_PROXY ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] || 'http' : 'http';
  const host = (TRUST_PROXY ? String(req.headers['x-forwarded-host'] ?? '').split(',')[0] : '') || req.headers.host;
  return `${proto}://${host}`;
};
const secure = (req) => originOf(req).startsWith('https:');
function send(res, status, body, type = 'application/json', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(data);
}
async function readBody(req, max = 2_000_000) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}
const cookieToken = (req) => /(?:^|;\s*)dh_s=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
// A bearer that isn't a device's token (a TMDB read token being checked) falls back to the cookie.
const who = (req) => deviceByToken(state, bearer(req)) ?? deviceByToken(state, cookieToken(req));
const sessionCookie = (req, token) => `dh_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure(req) ? '; Secure' : ''}`;

// ---------- the relay to Jellyfin and Seerr ----------
/** A private address (LAN, this machine, a .local name, a name without dots) can't be reached from outside: relay it. */
export function isPrivate(url) {
  let h;
  try { h = new URL(url).hostname; } catch { return true; }
  return h === 'localhost' || !h.includes('.') || /\.(local|lan|home|internal)$/i.test(h) || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^\[?(::1|f[cd][0-9a-f]{2}:)/i.test(h);
}
/** Whether this service goes through the relay: always, never, or (auto) when its address is private. */
const relayed = (url) => !!url && (state.settings.data.relay === 'on' || (state.settings.data.relay !== 'off' && isPrivate(url)));
const relayBase = (req, device, service) => `${originOf(req)}/api/r/${device.relay}/${service}`;

async function relay(req, res, service, rest) {
  const s = state.settings.data, target = service === 'jellyfin' ? s.jellyfin : s.seerr;
  if (!target) return send(res, 404, { message: `No ${service} address on the server` });
  const u = new URL(target.replace(/\/$/, '') + rest);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!['host', 'cookie', 'connection', 'content-length', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'origin', 'referer'].includes(k)) headers[k] = v;
  if (service === 'seerr' && s.seerrKey) headers['x-api-key'] = s.seerrKey;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const r = await fetch(u, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? 'half' : undefined, redirect: 'manual' });
    const out = {};
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection', 'set-cookie', 'content-length'].includes(k) && !k.startsWith('access-control-')) out[k] = v; });
    if (r.headers.get('content-length') && !r.headers.get('content-encoding')) out['content-length'] = r.headers.get('content-length');
    res.writeHead(r.status, out);
    if (r.body) Readable.fromWeb(r.body).pipe(res);
    else res.end();
  } catch (e) {
    send(res, 502, { message: `The server could not reach ${service}: ${e.message}` });
  }
}

// ---------- the household's data, as the app keeps it ----------
/** Keys the server answers itself: the film data keys and the Jellyfin and Seerr settings live in settings.json. */
function storeGet(key, req, device) {
  const s = state.settings.data;
  if (key === 'keys') return Object.fromEntries(['tmdb', 'omdb', 'trakt', 'google'].map((k) => [k, s.keys[k] ? 'server' : '']));
  if (key === 'prov:jellyfin:server') return s.jellyfin ? (relayed(s.jellyfin) ? relayBase(req, device, 'jellyfin') : s.jellyfin) : undefined;
  if (key === 'prov:jellyfin:seerrUrl') return s.seerr ? (relayed(s.seerr) ? relayBase(req, device, 'seerr') : s.seerr) : undefined;
  // Through the relay, Seerr's key is added by the server: the app holds a placeholder.
  if (key === 'prov:jellyfin:seerrKey') return s.seerrKey ? (relayed(s.seerr) ? 'relay' : s.seerrKey) : undefined;
  return state.store.data[key];
}
const SYNTHETIC = ['keys', 'prov:jellyfin:server', 'prov:jellyfin:seerrUrl', 'prov:jellyfin:seerrKey'];
function storeSet(key, value) {
  const s = state.settings.data;
  if (key === 'keys') {
    for (const k of ['tmdb', 'omdb', 'trakt', 'google']) {
      const v = value?.[k];
      if (v === '') delete s.keys[k];
      else if (typeof v === 'string' && v !== 'server') s.keys[k] = v.trim();
    }
    return state.settings.save();
  }
  // The app writes back what it was given: a relay address or a placeholder isn't a new setting.
  if (key === 'prov:jellyfin:server') { if (typeof value === 'string' && !value.includes('/api/r/')) s.jellyfin = value; return state.settings.save(); }
  if (key === 'prov:jellyfin:seerrUrl') { if (typeof value === 'string' && !value.includes('/api/r/')) s.seerr = value; return state.settings.save(); }
  if (key === 'prov:jellyfin:seerrKey') { if (typeof value === 'string' && value !== 'relay') s.seerrKey = value; return state.settings.save(); }
  state.store.data[key] = value;
  state.store.save();
}
function storeDel(key) {
  if (SYNTHETIC.includes(key)) return;
  delete state.store.data[key];
  state.store.save();
}

/** The app's config: every film data service through the server, keys as placeholders, the data in /api/store. */
function appConfig(req) {
  const s = state.settings.data, o = originOf(req);
  return {
    mode: 'server', server: { version: VERSION, panel: `${o}/panel`, origin: o },
    // APP_ENDPOINTS (JSON) adds or changes the other services' addresses: the tests point them at stand-ins.
    endpoints: { ...JSON.parse(process.env.APP_ENDPOINTS ?? '{}'), tmdb: `${o}/api/tmdb/3`, images: `${o}/api/img`, omdb: `${o}/api/omdb/`, trakt: `${o}/api/trakt`, knowledge: `${o}/api/kg` },
    keys: Object.fromEntries(['tmdb', 'omdb', 'trakt', 'google'].map((k) => [k, s.keys[k] ? 'server' : ''])),
    store: `${o}/api/store`,
  };
}

// ---------- the panel's view of everything ----------
function adminState() {
  const s = state.settings.data, profiles = state.store.data.profiles ?? [];
  return {
    version: VERSION, keys: Object.fromEntries(['tmdb', 'omdb', 'trakt', 'google'].map((k) => [k, !!s.keys[k]])),
    jellyfin: s.jellyfin, seerr: s.seerr, seerrKey: !!s.seerrKey, relay: s.relay, webApp: s.webApp,
    relayNow: { jellyfin: relayed(s.jellyfin), seerr: relayed(s.seerr) },
    profiles: profiles.map((p) => ({ id: p.id, name: p.name, color: p.color, kids: !!p.kids, jellyfin: !!state.store.data[`prov:jellyfin:link:${p.id}`] })),
    devices: state.devices.data.map((d) => ({ id: d.id, name: d.name, kind: d.kind, createdAt: d.createdAt, lastSeen: d.lastSeen })),
  };
}
const COLORS = ['#B4432F', '#2C6E91', '#3F8F5F', '#7A4FA3', '#A36A1F', '#37474F'];
async function jellyfinSignIn(profileId, user, password) {
  const s = state.settings.data;
  if (!s.jellyfin) throw new Error('Set the Jellyfin address first');
  let base = state.store.data['prov:jellyfin:device'];
  if (!base) { base = Math.random().toString(36).slice(2, 10); state.store.data['prov:jellyfin:device'] = base; }
  const deviceId = `${base}-${profileId}`, q = (v) => `"${encodeURIComponent(v)}"`;
  const r = await fetch(`${s.jellyfin.replace(/\/$/, '')}/Users/AuthenticateByName`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', Authorization: `MediaBrowser Client=${q('Dholphin')}, Device=${q('Dholphin server')}, DeviceId=${q(deviceId)}, Version=${q(VERSION)}` },
    body: JSON.stringify({ Username: user, Pw: password ?? '' }),
  });
  if (r.status === 401) throw new Error('Wrong user name or password');
  if (!r.ok) throw new Error(`Jellyfin answered ${r.status}`);
  const j = await r.json();
  state.store.data[`prov:jellyfin:link:${profileId}`] = { token: j.AccessToken, userId: j.User.Id, deviceId };
  state.store.save();
}

// ---------- the routes ----------
/**
 * A linked TV's app runs at another origin (Android: appassets.androidplatform.net) and sends its token in a header.
 * Other origins may call the server, but never with the cookie: it is SameSite Lax, so a browser doesn't send it
 * from another site, and no Allow-Credentials is given. A token can only come from the app that holds it.
 */
function cors(req, res) {
  const o = req.headers.origin;
  if (!o || o === originOf(req)) return;
  res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Emby-Authorization, X-Emby-Token, X-MediaBrowser-Token, X-Api-Key, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
  const json = (status, body, extra) => send(res, status, body, 'application/json', extra);
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Max-Age': '600' }); return res.end(); }

  // Open to all: the state of the server, first setup, signing in, pairing, pictures, the relay (by its secret).
  if (p === '/api/status') return json(200, { app: 'dholphin', version: VERSION, setup: !state.settings.data.password, webApp: state.settings.data.webApp, signedIn: !!who(req) });
  if (p === '/api/setup' && req.method === 'POST') {
    const b = await readBody(req, 10_000);
    if (state.settings.data.password) return json(409, { message: 'A password is already set' });
    if (!loginLimit(ipOf(req)) || String(b.code ?? '').toUpperCase() !== state.setupCode) return json(403, { message: 'Wrong setup code. It is in the server log.' });
    if (String(b.password ?? '').length < 8) return json(400, { message: 'Use at least 8 characters' });
    state.settings.data.password = await hashPassword(b.password);
    state.settings.save();
    const { token } = newDevice(state, b.name ?? 'Browser', 'browser');
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token) });
  }
  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req, 10_000);
    if (!loginLimit(ipOf(req))) return json(429, { message: 'Too many tries. Wait a few minutes.' });
    if (!(await checkPassword(b.password, state.settings.data.password))) return json(401, { message: 'Wrong password' });
    const { token } = newDevice(state, b.name ?? 'Browser', 'browser');
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token) });
  }
  if (p === '/api/pair' && req.method === 'POST') {
    const b = await readBody(req, 10_000);
    if (!pairLimit(ipOf(req)) || !pairs.use(b.code)) return json(403, { message: 'Wrong or expired code. Make a new one in the panel.' });
    const { token } = newDevice(state, b.name ?? 'TV', 'device');
    return json(200, { token, server: { version: VERSION, origin: originOf(req) } });
  }
  let m;
  if ((m = /^\/api\/img\/([^/]+)\/([^/]+)$/.exec(p))) {
    const img = await up.image(m[1], m[2]);
    if (!img) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[extname(img.path).toLowerCase()] ?? 'image/jpeg', 'Content-Length': img.size, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return img.stream().pipe(res);
  }
  if ((m = /^\/api\/r\/([^/]+)\/(jellyfin|seerr)(\/.*)?$/.exec(p))) {
    if (!deviceByRelay(state, m[1])) return json(401, { message: 'Unknown device' });
    return relay(req, res, m[2], (m[3] ?? '/') + url.search);
  }
  if (p === '/panel' || p === '/panel/') return sendFile(res, join(HERE, 'panel.html'), req);

  // Everything else needs a signed-in browser or a linked device.
  const device = who(req);
  if (p.startsWith('/api/') || p === '/config.json') {
    if (!device) return json(401, { message: 'Sign in first' });
    if (p === '/config.json') return json(200, appConfig(req));
    if (p === '/api/logout' && req.method === 'POST') {
      removeDevice(state, device.id);
      return json(200, { ok: true }, { 'Set-Cookie': 'dh_s=; Path=/; Max-Age=0' });
    }
    // The household's data.
    if (p === '/api/store' && req.method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const keys = [...new Set([...Object.keys(state.store.data), ...SYNTHETIC])].filter((k) => k.startsWith(prefix));
      return json(200, Object.fromEntries(keys.map((k) => [k, storeGet(k, req, device)]).filter(([, v]) => v !== undefined)));
    }
    if ((m = /^\/api\/store\/(.+)$/.exec(p))) {
      const key = m[1];
      if (req.method === 'GET') return json(200, { value: storeGet(key, req, device) ?? null });
      if (req.method === 'PUT') { storeSet(key, (await readBody(req)).value); return json(200, { ok: true }); }
      if (req.method === 'DELETE') { storeDel(key); return json(200, { ok: true }); }
    }
    // The film data services, keys added here.
    if ((m = /^\/api\/(tmdb\/3|omdb|trakt|kg)(\/.*)?$/.exec(p))) {
      const name = m[1] === 'tmdb/3' ? 'tmdb' : m[1];
      // A key the app sent itself (a check of one just typed) is used for that call; the placeholder never is.
      const sent = url.searchParams.get({ tmdb: 'api_key', omdb: 'apikey', kg: 'key' }[name] ?? '') ?? (name === 'tmdb' && !deviceByToken(state, bearer(req)) ? bearer(req) : null);
      const r = await up.call(name, m[2] && m[2] !== '/' ? m[2] : '', url.search, {}, sent && sent !== 'server' ? sent : null);
      return send(res, r.status, r.body, r.type);
    }
    // The panel's own calls.
    if (p === '/api/admin/state') return json(200, adminState());
    if (p === '/api/admin/settings' && req.method === 'POST') {
      const b = await readBody(req, 50_000), s = state.settings.data;
      for (const k of ['tmdb', 'omdb', 'trakt', 'google']) if (typeof b.keys?.[k] === 'string') { if (b.keys[k].trim()) s.keys[k] = b.keys[k].trim(); else if (b.clear?.includes(k)) delete s.keys[k]; }
      if (typeof b.jellyfin === 'string') s.jellyfin = b.jellyfin.trim().replace(/\/$/, '');
      if (typeof b.seerr === 'string') s.seerr = b.seerr.trim().replace(/\/$/, '');
      if (typeof b.seerrKey === 'string' && b.seerrKey.trim()) s.seerrKey = b.seerrKey.trim();
      if (['auto', 'on', 'off'].includes(b.relay)) s.relay = b.relay;
      if (typeof b.webApp === 'boolean') s.webApp = b.webApp;
      state.settings.save();
      return json(200, adminState());
    }
    if (p === '/api/admin/password' && req.method === 'POST') {
      const b = await readBody(req, 10_000);
      if (!(await checkPassword(b.old, state.settings.data.password))) return json(403, { message: 'The current password is wrong' });
      if (String(b.password ?? '').length < 8) return json(400, { message: 'Use at least 8 characters' });
      state.settings.data.password = await hashPassword(b.password);
      state.settings.save();
      return json(200, { ok: true });
    }
    if (p === '/api/admin/pair' && req.method === 'POST') return json(200, { code: pairs.create(), origin: originOf(req) });
    if ((m = /^\/api\/admin\/devices\/([\w]+)$/.exec(p)) && req.method === 'DELETE') { removeDevice(state, m[1]); return json(200, adminState()); }
    if (p === '/api/admin/profiles' && req.method === 'POST') {
      const b = await readBody(req, 20_000), list = state.store.data.profiles ?? [];
      if (b.action === 'add' && String(b.name ?? '').trim() && list.length < 8) {
        const base = list[0];
        list.push({ id: Math.random().toString(36).slice(2, 10), name: String(b.name).trim().slice(0, 14), color: COLORS[list.length % COLORS.length], language: base?.language ?? 'en-US', region: base?.region ?? 'US', maturity: base?.maturity ?? '18+' });
        state.store.data.setupDone = true;
      } else if (b.action === 'rename') {
        const pr = list.find((x) => x.id === b.id);
        if (pr && String(b.name ?? '').trim()) pr.name = String(b.name).trim().slice(0, 14);
      } else if (b.action === 'delete' && list.length > 1) {
        state.store.data.profiles = list.filter((x) => x.id !== b.id);
        for (const k of Object.keys(state.store.data)) if (k.startsWith(`p:${b.id}:`) || k === `prov:jellyfin:link:${b.id}`) delete state.store.data[k];
      }
      if (b.action !== 'delete') state.store.data.profiles = list;
      state.store.save();
      return json(200, adminState());
    }
    if (p === '/api/admin/jellyfin' && req.method === 'POST') {
      const b = await readBody(req, 10_000);
      try { await jellyfinSignIn(b.profileId, b.user, b.password); return json(200, adminState()); } catch (e) { return json(400, { message: e.message }); }
    }
    if (p === '/api/admin/cache' && req.method === 'POST') {
      rmSync(join(DATA, 'cache'), { recursive: true, force: true });
      return json(200, { ok: true });
    }
    return json(404, { message: 'Not here' });
  }

  // The web app: when it is on, for signed-in browsers; its files themselves hold nothing private.
  if (!state.settings.data.webApp && (p === '/' || p === '/index.html')) return sendFile(res, join(HERE, 'off.html'), req);
  if ((p === '/' || p === '/index.html') && !device) return sendFile(res, join(HERE, 'login.html'), req);
  return sendFile(res, normalize(join(DIST, p === '/' ? 'index.html' : p)), req, DIST);
}

const gz = new Map();
function sendFile(res, file, req, root = HERE) {
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  const st = statSync(file), type = TYPES[extname(file)] ?? 'application/octet-stream';
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (/text|javascript|json|svg|wasm/.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
    let z = gz.get(file);
    if (!z || z.etag !== etag) gz.set(file, (z = { etag, body: gzipSync(readFileSync(file)) }));
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': z.body.length, Vary: 'Accept-Encoding' });
    return res.end(z.body);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  createReadStream(file).pipe(res);
}

export const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.status ?? 500, { message: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  });
});
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`Dholphin server ${VERSION} on port ${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { state.flush(); process.exit(0); });
}
