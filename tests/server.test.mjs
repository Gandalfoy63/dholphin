// Docs: docs/04 - Architecture/Server.md
// Purpose: tests the server: first setup, signing in, the household's data, keys kept on the server, the cache, the relay, pairing.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATA = mkdtempSync(join(tmpdir(), 'dholphin-server-'));
process.env.DATA = DATA;
process.env.NODE_ENV = 'test';
const realFetch = globalThis.fetch;
const upstreamCalls = [];
let base = '', server, state, isPrivate;

beforeAll(async () => {
  // Calls to the outside are answered here: TMDB, and a Jellyfin and a Seerr on the "home network".
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (url.startsWith(base)) return realFetch(u, init);
    upstreamCalls.push({ url, headers: init.headers ?? {} });
    if (url.startsWith('https://api.themoviedb.org/3/movie/1')) return new Response(JSON.stringify({ id: 1, title: 'One' }), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('http://192.168.1.20:5055/api/v1/status')) return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404 });
  };
  ({ server, state, isPrivate } = await import('../server/main.mjs'));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
});

const call = (path, { method = 'GET', body, cookie, token } = {}) => realFetch(base + path, {
  method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
let cookie = '';

describe('server', () => {
  it('starts asking for a password, and only with the setup code from its log', async () => {
    expect((await (await call('/api/status')).json()).setup).toBe(true);
    expect((await call('/api/setup', { method: 'POST', body: { code: 'WRONG', password: 'longenough' } })).status).toBe(403);
    expect((await call('/api/setup', { method: 'POST', body: { code: state.setupCode, password: 'short' } })).status).toBe(400);
    const r = await call('/api/setup', { method: 'POST', body: { code: state.setupCode, password: 'household-pass' } });
    expect(r.status).toBe(200);
    cookie = r.headers.get('set-cookie').split(';')[0];
    expect(cookie).toMatch(/^dh_s=/);
    expect((await call('/api/setup', { method: 'POST', body: { code: state.setupCode, password: 'another-pass' } })).status).toBe(409);
  });
  it('keeps everything behind the password', async () => {
    expect((await call('/config.json')).status).toBe(401);
    expect((await call('/api/store')).status).toBe(401);
    expect((await call('/api/login', { method: 'POST', body: { password: 'nope' } })).status).toBe(401);
    expect((await call('/api/login', { method: 'POST', body: { password: 'household-pass' } })).status).toBe(200);
  });
  it('keeps the household data, and the keys only on the server', async () => {
    await call('/api/store/profiles', { method: 'PUT', cookie, body: { value: [{ id: 'a', name: 'Ab' }] } });
    await call('/api/store/keys', { method: 'PUT', cookie, body: { value: { tmdb: 'real-tmdb-key', omdb: '' } } });
    const all = await (await call('/api/store?prefix=', { cookie })).json();
    expect(all.profiles).toEqual([{ id: 'a', name: 'Ab' }]);
    expect(all.keys.tmdb).toBe('server');
    expect(state.settings.data.keys.tmdb).toBe('real-tmdb-key');
    // Writing the placeholder back doesn't replace the real key.
    await call('/api/store/keys', { method: 'PUT', cookie, body: { value: { tmdb: 'server' } } });
    expect(state.settings.data.keys.tmdb).toBe('real-tmdb-key');
    const cfg = await (await call('/config.json', { cookie })).json();
    expect([cfg.mode, cfg.keys.tmdb, cfg.endpoints.tmdb.endsWith('/api/tmdb/3')]).toEqual(['server', 'server', true]);
  });
  it('adds the key on the way to TMDB, drops the app\'s, and keeps the answer', async () => {
    upstreamCalls.length = 0;
    const a = await call('/api/tmdb/3/movie/1?api_key=server&language=fr-FR', { cookie });
    expect((await a.json()).title).toBe('One');
    expect(upstreamCalls).toHaveLength(1);
    const u = new URL(upstreamCalls[0].url);
    expect([u.searchParams.get('api_key'), u.searchParams.get('language')]).toEqual(['real-tmdb-key', 'fr-FR']);
    await call('/api/tmdb/3/movie/1?api_key=server&language=fr-FR', { cookie });
    expect(upstreamCalls).toHaveLength(1);
  });
  it('checks a key the app sends with that key, not the server\'s, and keeps nothing from it', async () => {
    upstreamCalls.length = 0;
    await call('/api/tmdb/3/movie/1?api_key=typed-key', { cookie });
    await call('/api/tmdb/3/movie/1?api_key=typed-key', { cookie });
    expect(upstreamCalls.map((c) => new URL(c.url).searchParams.get('api_key'))).toEqual(['typed-key', 'typed-key']);
    // A TMDB read token sent as a bearer is a key to check, not a device: the cookie still signs in.
    upstreamCalls.length = 0;
    const longToken = 'x'.repeat(80);
    const r = await realFetch(`${base}/api/tmdb/3/movie/1`, { headers: { Cookie: cookie, Authorization: `Bearer ${longToken}` } });
    expect(r.status).toBe(200);
    expect(upstreamCalls[0].headers.Authorization).toBe(`Bearer ${longToken}`);
  });
  it('relays a local Seerr through a secret path, with its key added by the server', async () => {
    await call('/api/admin/settings', { method: 'POST', cookie, body: { seerr: 'http://192.168.1.20:5055', seerrKey: 'seerr-secret', relay: 'auto' } });
    const store = await (await call('/api/store?prefix=prov:jellyfin:', { cookie })).json();
    expect(store['prov:jellyfin:seerrUrl']).toMatch(/\/api\/r\/[\w-]+\/seerr$/);
    expect(store['prov:jellyfin:seerrKey']).toBe('relay');
    upstreamCalls.length = 0;
    const path = new URL(store['prov:jellyfin:seerrUrl']).pathname;
    const r = await call(`${path}/api/v1/status`);
    expect(r.status).toBe(200);
    expect(upstreamCalls[0].headers['x-api-key']).toBe('seerr-secret');
    expect((await call('/api/r/not-a-device/seerr/api/v1/status')).status).toBe(401);
  });
  it('links a TV with a one-time code', async () => {
    const { code } = await (await call('/api/admin/pair', { method: 'POST', cookie, body: {} })).json();
    const r = await (await call('/api/pair', { method: 'POST', body: { code, name: 'Living room' } })).json();
    expect((await call('/api/store/profiles', { token: r.token })).status).toBe(200);
    expect((await call('/api/pair', { method: 'POST', body: { code, name: 'Again' } })).status).toBe(403);
  });
  it('tells local addresses from public ones, and serves no file outside the app', async () => {
    expect(['http://192.168.1.2:8096', 'http://jellyfin:8096', 'http://nas.local', 'http://10.0.0.5'].every(isPrivate)).toBe(true);
    expect(['https://jellyfin.example.com', 'https://media.my-home.fr'].some(isPrivate)).toBe(false);
    expect((await call('/../server/main.mjs', { cookie })).status).toBe(404);
    expect((await call('/%2e%2e/server/main.mjs', { cookie })).status).toBe(404);
  });
});
