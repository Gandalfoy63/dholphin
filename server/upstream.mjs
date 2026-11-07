// Docs: docs/04 - Architecture/Server.md
// Purpose: the film data services through the server: their keys added here, their answers and pictures kept on disk.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HOUR = 3_600_000, DAY = 24 * HOUR;

/**
 * Each service the app reaches through the server, at `/api/<name>/...`. The server adds the key the app no longer
 * holds (it gets a placeholder), and drops any key the app sent. Only these hosts are reached: this is no open proxy.
 */
const env = process.env;
export const UPSTREAMS = {
  // Each address may be changed with UPSTREAM_<NAME> (the tests point them at stand-ins).
  tmdb: { base: env.UPSTREAM_TMDB ?? 'https://api.themoviedb.org/3', key: 'tmdb', add: (u, k, h) => (k.length > 60 ? (h.Authorization = `Bearer ${k}`) : u.searchParams.set('api_key', k)), drop: ['api_key'] },
  omdb: { base: env.UPSTREAM_OMDB ?? 'https://www.omdbapi.com', key: 'omdb', add: (u, k) => u.searchParams.set('apikey', k), drop: ['apikey'] },
  trakt: { base: env.UPSTREAM_TRAKT ?? 'https://api.trakt.tv', key: 'trakt', add: (u, k, h) => { h['trakt-api-key'] = k; h['trakt-api-version'] = '2'; }, drop: [] },
  kg: { base: env.UPSTREAM_KG ?? 'https://kgsearch.googleapis.com/v1/entities:search', key: 'google', add: (u, k) => u.searchParams.set('key', k), drop: ['key'] },
};

/** How long an answer is kept: lists change, a title's details and scores less so. */
function maxAge(name, path) {
  if (name === 'tmdb' && /^\/(trending|discover|search|person\/popular|movie\/(now_playing|upcoming|popular))/.test(path)) return 6 * HOUR;
  if (name === 'tmdb') return 3 * DAY;
  if (name === 'omdb') return 7 * DAY;
  return DAY;
}

/** The disk cache: one file per answer, under cache/<service>/<hash>. A failed call serves the old answer if there is one. */
export function upstream(cacheDir, settings, fetcher = fetch) {
  const file = (name, key) => {
    const h = createHash('sha1').update(key).digest('hex');
    return join(cacheDir, name, h.slice(0, 2), `${h}.json`);
  };
  /**
   * `clientKey`: a key the app sent itself, when it checks one typed during setup or in Settings. It is used for that
   * one call instead of the server's, without the cache, so the check tests the key typed rather than the one kept.
   */
  async function call(name, rest, search, headers = {}, clientKey = null) {
    const up = UPSTREAMS[name];
    const key = clientKey || settings.data.keys?.[up.key];
    if (!key) return { status: 503, body: JSON.stringify({ status_message: `No ${up.key} key on the server. Add it in the panel.` }), type: 'application/json' };
    const u = new URL(up.base + rest);
    for (const [k, v] of new URLSearchParams(search)) if (!up.drop.includes(k)) u.searchParams.append(k, v);
    u.searchParams.sort();
    const cacheKey = u.toString() + (headers.accept ?? '');
    const f = file(name, cacheKey);
    const hit = !clientKey && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    if (hit && Date.now() - hit.at < maxAge(name, rest)) return hit;
    const h = { Accept: 'application/json' };
    up.add(u, key, h);
    try {
      const r = await fetcher(u, { headers: h, signal: AbortSignal.timeout(10_000) });
      const out = { at: Date.now(), status: r.status, body: await r.text(), type: r.headers.get('content-type') ?? 'application/json' };
      // Only good answers are kept; a refused key or a missing title isn't remembered.
      if (r.ok && !clientKey) {
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(`${f}.tmp`, JSON.stringify(out));
        renameSync(`${f}.tmp`, f);
      }
      return out;
    } catch (e) {
      if (hit) return hit;
      return { status: 502, body: JSON.stringify({ status_message: `The server could not reach ${name}: ${e.message}` }), type: 'application/json' };
    }
  }

  /** TMDB's pictures, kept for good: they never change at a given path. `size/file` only, nothing else. */
  async function image(size, name, fetchImg = fetcher) {
    if (!/^(w\d{2,4}|h\d{2,4}|original)$/.test(size) || !/^[\w-]+\.(jpg|jpeg|png|svg|webp)$/i.test(name)) return null;
    const f = join(cacheDir, 'img', size, name);
    if (!existsSync(f)) {
      const r = await fetchImg(`${env.UPSTREAM_IMAGES ?? 'https://image.tmdb.org/t/p'}/${size}/${name}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!r?.ok) return null;
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, Buffer.from(await r.arrayBuffer()));
      renameSync(`${f}.tmp`, f);
    }
    return { path: f, size: statSync(f).size, stream: () => createReadStream(f) };
  }
  return { call, image };
}
