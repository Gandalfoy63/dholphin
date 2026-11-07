// Docs: docs/02 - Tech/Testing.md
// Purpose: unit tests over the real WASM core: catalogue, library, categories, age limits.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { netflixIdFromWikidata, netflixUrl } from '../../providers/netflix';
import { itemToTitle } from '../../providers/jellyfin';
import type { Title } from '../sdk/types';
import { allowedFor, Catalog, DEFAULT_ENDPOINTS } from './catalog';
import { byRating, CATEGORIES, category } from './categories';
import { Engine, signalsForCore } from './engine';
import { Library } from './library';
import { cached, memoryStore } from './store';
import { call, useCore } from './wasm';

beforeAll(async () => {
  const { instance } = await WebAssembly.instantiate(readFileSync('web/public/dholphin_core.wasm'), {});
  useCore(instance);
  vi.stubGlobal('location', { href: 'http://x/' });
});
const title = (key: string, genres: string[] = ['Drama'], extra: Partial<Title> = {}): Title => ({ key, tmdbId: Number(key.split(':').pop()) || 1, kind: 'movie', name: key, overview: '', genres, keywords: [], people: [], creators: [], language: 'en', popularity: 1, scores: { tmdb: 7, tmdbVotes: 100 }, watchProviders: [], ...extra });

describe('wasm core', () => {
  it('answers and survives repeated large calls', () => {
    expect(call<string>('version')).toMatch(/^\d+\.\d+\.\d+$/);
    const big = Array.from({ length: 2000 }, (_, i) => title(`t:${i}`, ['Drama', `g${i % 9}`]));
    for (let n = 0; n < 5; n++) expect(call<unknown[]>('rank', { taste: { features: {}, liked: {}, disliked: [] }, candidates: big.map((t) => ({ title: t, available: 1 })), options: { limit: 20, lambda: 0.75, exploreEvery: 8, exclude: [] } })).toHaveLength(20);
  });
  it('reports errors as errors', () => {
    expect(() => call('nope')).toThrow(/unknown op/);
  });
  it('ranks the taste of a profile end to end', async () => {
    const store = memoryStore();
    const lib = new Library(store, 'p');
    const cat = new Catalog(store, DEFAULT_ENDPOINTS, vi.fn());
    const th = title('tmdb:movie:1', ['Thriller']);
    cat.add([th]);
    await lib.rate(th, 'love');
    const e = new Engine(cat, lib);
    (cat as unknown as { details: (t: Title) => Promise<Title> }).details = async (t) => t;
    await e.refreshTaste();
    expect(e.topGenres()).toEqual(['Thriller']);
    const out = e.rank([title('a:1', ['Comedy']), title('b:2', ['Thriller'])], 2);
    expect(out[0]!.title.key).toBe('b:2');
    expect(out[0]!.reason).toContain('Thriller');
  });
  it('orders a row by how likely the profile likes each title, moved by the actors it rated', async () => {
    const store = memoryStore();
    const lib = new Library(store, 'p');
    const cat = new Catalog(store, DEFAULT_ENDPOINTS, vi.fn());
    (cat as unknown as { details: (t: Title) => Promise<Title> }).details = async (t) => t;
    await lib.rate(title('tmdb:movie:1', ['Thriller']), 'love');
    const e = new Engine(cat, lib);
    lib.changed = () => e.stale();
    const comedy = title('c:1', ['Comedy']), thriller = title('t:2', ['Thriller']), drama = title('d:3', ['Drama']);
    const order = async () => (await e.byAffinity([comedy, drama, thriller].map((t) => ({ title: t })))).map((i) => i.title.key);
    expect((await order())[0]).toBe('t:2');
    const before = await e.affinity([comedy, thriller]);
    expect(before.get('t:2')!).toBeGreaterThan(before.get('c:1')!);
    // An actor said Not for me to pulls their titles down; one loved lifts theirs.
    await lib.ratePerson({ id: 7, name: 'X', photo: null, keys: ['t:2'] }, 'dislike');
    await lib.ratePerson({ id: 8, name: 'Y', photo: null, keys: ['c:1'] }, 'love');
    const after = await e.affinity([comedy, thriller]);
    expect(after.get('t:2')!).toBeCloseTo(before.get('t:2')! - 0.15, 5);
    expect(after.get('c:1')!).toBeCloseTo(before.get('c:1')! + 0.08, 5);
    expect([...after.values()].every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it('marks a title as seen, keeps it out of the lists for 15 days, and takes it back', async () => {
    const lib = new Library(memoryStore(), 'p');
    const t = title('tmdb:movie:9');
    await lib.markSeen(t);
    const h = (await lib.history())[0]!;
    expect([h.key, h.seen, h.progress]).toEqual(['tmdb:movie:9', true, 1]);
    expect((await lib.signals()).some((s) => s.key === t.key && s.kind === 'finished')).toBe(true);
    expect((await lib.resting()).has(t.key)).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 86_400_000);
    expect((await lib.resting()).has(t.key)).toBe(false);
    vi.useRealTimers();
    await lib.unmarkSeen(t.key);
    expect(await lib.history()).toEqual([]);
    expect((await lib.signals()).some((s) => s.kind === 'finished')).toBe(false);
  });
  it('turns signal times into ages', () => {
    expect(signalsForCore([{ key: 'k', kind: 'like', at: 0 }], 86_400_000)[0]!.ageDays).toBe(1);
  });
});

describe('catalogue', () => {
  const answer = (j: unknown, ok = true, status = 200) => ({ ok, status, json: async () => j }) as Response;
  it('sends short keys in the URL and long tokens in a header', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => answer({ results: [] }));
    const c = new Catalog(memoryStore(), DEFAULT_ENDPOINTS, f as never);
    c.tmdbKey = 'abc';
    await c.list('/x');
    expect(String(f.mock.calls[0]![0])).toContain('api_key=abc');
    c.tmdbKey = 'y'.repeat(100);
    await c.list('/z');
    expect(String(f.mock.calls[1]![0])).not.toContain('api_key');
    expect((f.mock.calls[1]![1]!.headers as Record<string, string>).Authorization).toContain('Bearer');
  });
  it('caches, and asks once', async () => {
    const f = vi.fn(async () => answer({ results: [{ id: 1, title: 'A', media_type: 'movie', poster_path: '/a.jpg' }] }));
    const c = new Catalog(memoryStore(), DEFAULT_ENDPOINTS, f as never);
    c.tmdbKey = 'k';
    expect(await c.trending()).toHaveLength(1);
    await c.trending();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('says what to do when the key is refused', async () => {
    const c = new Catalog(memoryStore(), DEFAULT_ENDPOINTS, (async () => answer({}, false, 401)) as never);
    c.tmdbKey = 'bad';
    await expect(c.trending()).rejects.toThrow(/refused/);
    expect(await c.checkTmdb('bad')).toBe(false);
  });
  it('asks for a key when it has none', async () => {
    await expect(new Catalog(memoryStore(), DEFAULT_ENDPOINTS).trending()).rejects.toThrow(/TMDB key/);
  });
  it('old data beats an error', async () => {
    const s = memoryStore();
    await s.set('k', { at: 0, v: 'old' });
    expect(await cached(s, 'k', 1000, async () => { throw new Error('down'); })).toBe('old');
  });
  it('applies age limits to lists and to movie queries', async () => {
    expect(allowedFor('All', { genres: ['Horror'] })).toBe(false);
    expect(allowedFor('All', { genres: ['Animation', 'Family'] })).toBe(true);
    expect(allowedFor('18+', { genres: ['Horror'] })).toBe(true);
    const f = vi.fn(async (_u: unknown) => answer({ results: [{ id: 1, title: 'Scary', media_type: 'movie', genre_ids: [27], poster_path: '/s.jpg' }, { id: 2, title: 'Nice', media_type: 'movie', genre_ids: [16], poster_path: '/n.jpg' }, { id: 3, title: 'No art', media_type: 'movie', genre_ids: [16] }] }));
    const c = new Catalog(memoryStore(), DEFAULT_ENDPOINTS, f as never);
    c.tmdbKey = 'k';
    c.use({ id: 'p', name: 'Mia', color: '#000', kids: true, language: 'en-US', region: 'US', maturity: '18+' });
    expect((await c.discover('movie', {})).map((t) => t.name)).toEqual(['Nice']);
    expect(String(f.mock.calls[0]![0])).toContain('certification.lte=PG');
  });
  it('never asks discover for regional dates, only regional availability', async () => {
    const f = vi.fn(async (_u: unknown) => answer({ results: [] }));
    const c = new Catalog(memoryStore(), DEFAULT_ENDPOINTS, f as never);
    c.tmdbKey = 'k';
    c.region = 'FR';
    await c.discover('movie', {});
    const u = new URL(String(f.mock.calls[0]![0]));
    expect(u.searchParams.has('region')).toBe(false);
    expect(u.searchParams.get('watch_region')).toBe('FR');
  });
  it('leaves absolute image addresses alone', () => {
    const c = new Catalog(memoryStore(), DEFAULT_ENDPOINTS);
    expect(c.image('/a.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/a.jpg');
    expect(c.image('http://srv/i.jpg')).toBe('http://srv/i.jpg');
    expect(c.image(null)).toBeNull();
  });
});

describe('library', () => {
  const lib = () => new Library(memoryStore(), 'p');
  it('keeps profiles apart', async () => {
    const s = memoryStore();
    await new Library(s, 'a').toggleList(title('x'));
    expect(await new Library(s, 'b').list()).toEqual([]);
  });
  it('toggles the list and records a signal', async () => {
    const l = lib();
    expect(await l.toggleList(title('x'))).toBe(true);
    expect((await l.signals())[0]!.kind).toBe('list');
    expect(await l.toggleList(title('x'))).toBe(false);
    expect(await l.inList('x')).toBe(false);
  });
  it('separates Continue Watching from finished titles', async () => {
    const l = lib();
    await l.watched(title('half'), { progress: 0.5 });
    await l.watched(title('done'), { progress: 0.95 });
    expect((await l.continueWatching()).map((h) => h.key)).toEqual(['half']);
    expect((await l.history()).map((h) => h.key)).toEqual(['done', 'half']);
    await l.hideFromContinue('half');
    expect(await l.continueWatching()).toEqual([]);
    expect(await l.history()).toHaveLength(2);
  });
  it('a later watch replaces the earlier one, and signals follow progress', async () => {
    const l = lib();
    await l.watched(title('x'), { progress: 0.05 });
    expect((await l.signals())[0]!.kind).toBe('abandoned');
    await l.watched(title('x'), { progress: 1 });
    expect(await l.history()).toHaveLength(1);
    expect((await l.signals())[0]!.kind).toBe('finished');
  });
  it('a new rating replaces the old one', async () => {
    const l = lib();
    await l.rate(title('x'), 'like');
    await l.rate(title('x'), 'dislike');
    expect((await l.signals()).map((s) => s.kind)).toEqual(['dislike']);
    await l.rate(title('x'), null);
    expect(await l.signals()).toEqual([]);
  });
  it('exports history as CSV with quotes escaped', async () => {
    const l = lib();
    await l.watched(title('x', [], { name: 'A "quoted" title' }), { progress: 0.5 });
    expect(await l.historyCsv()).toContain('"A ""quoted"" title"');
  });
  it('removes everything with the profile', async () => {
    const s = memoryStore();
    const l = new Library(s, 'p');
    await l.toggleList(title('x'));
    await l.remove();
    expect(await s.keys('p:p:')).toEqual([]);
  });
});

describe('ids and requests', () => {
  it('makes IDs without crypto.randomUUID, which plain LAN addresses lack', async () => {
    const { newId } = await import('./id');
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect(newId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newId(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(newId()).not.toBe(newId());
    vi.unstubAllGlobals();
    vi.stubGlobal('location', { href: 'http://x/' });
  });
  it('asking for more seasons adds to what was asked', async () => {
    const l = new Library(memoryStore(), 'p');
    await l.addRequest(title('s'), 'Requested', [3, 1]);
    await l.addRequest(title('s'), 'Requested', [2, 1]);
    const r = await l.requests();
    expect(r).toHaveLength(1);
    expect(r[0]!.seasons).toEqual([1, 2, 3]);
  });
});

describe('languages', () => {
  it('every row is translated into every language, keeping its variables', async () => {
    const { DICTIONARY } = await import('@/ui/i18n');
    for (const [en, row] of Object.entries(DICTIONARY)) {
      const vars = (en.match(/\{\w+\}/g) ?? []).sort().join();
      for (const text of row) {
        expect(text.length, en).toBeGreaterThan(0);
        expect((text.match(/\{\w+\}/g) ?? []).sort().join(), `${en} -> ${text}`).toBe(vars);
      }
    }
  });
  it('translates, fills variables, and leaves unknown text alone', async () => {
    vi.stubGlobal('document', { documentElement: {} });
    const { reasonText, setLocale, t } = await import('@/ui/i18n');
    setLocale('fr-FR');
    expect(t('Home')).toBe('Accueil');
    expect(t('Because you liked {name}', { name: 'Dark' })).toBe('Parce que vous avez aimé Dark');
    expect(reasonText('Because you liked Dark')).toBe('Parce que vous avez aimé Dark');
    expect(t('Server said no')).toBe('Server said no');
    setLocale('en-US');
    expect(t('Home')).toBe('Home');
    setLocale('xx-XX');
    expect(t('Home')).toBe('Home');
  });
  it('every category name is in the dictionary', async () => {
    const { DICTIONARY } = await import('@/ui/i18n');
    for (const c of CATEGORIES) expect(DICTIONARY[c.name], c.name).toBeDefined();
  });
});

describe('categories', () => {
  it('are unique and each is usable', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) if (!c.special) expect(c.queries('2026-11-01').length).toBeGreaterThan(0);
  });
  it('New Arrivals looks back and Upcoming looks forward', () => {
    const n = category('new')!.queries('2026-11-01')[0]!.params, u = category('upcoming')!.queries('2026-11-01')[0]!.params;
    expect(n['primary_release_date.lte']).toBe('2026-11-01');
    expect(n['primary_release_date.gte']).toBe('2026-09-02');
    expect(u['primary_release_date.gte']).toBe('2026-11-02');
  });
  it('New Arrivals follow the profile language, both movies and series', () => {
    expect(category('new')!.queries('2026-11-01', 'fr').map((q) => q.params.with_original_language)).toEqual(['fr', 'fr']);
    expect(category('new')!.queries('2026-11-01')[0]!.params.with_original_language).toBeUndefined();
  });
  it('rating order lets few votes count for less', () => {
    const it = (key: string, tmdb: number, tmdbVotes: number) => ({ title: { key, scores: { tmdb, tmdbVotes } } });
    expect(byRating([it('a', 7, 500), it('b', 10, 1), it('c', 8.2, 300), it('d', 6, 900)]).map((x) => x.title.key)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('providers', () => {
  it('Netflix: player for a known film, title page for a series, its search otherwise', () => {
    const b = 'https://www.netflix.com';
    expect(netflixUrl(b, { kind: 'movie', name: 'A' }, '1')).toBe(`${b}/watch/1`);
    expect(netflixUrl(b, { kind: 'series', name: 'A' }, '1')).toBe(`${b}/title/1`);
    expect(netflixUrl(b, { kind: 'movie', name: 'A B' }, null)).toBe(`${b}/search?q=A%20B`);
  });
  it('Wikidata: refuses a bad ID without asking, and reads only digits', async () => {
    const f = vi.fn();
    expect(await netflixIdFromWikidata('tt1" } drop', 'http://w/', f as never)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    const a = (v: string) => (async () => ({ ok: true, json: async () => ({ results: { bindings: [{ n: { value: v } }] } }) })) as never;
    expect(await netflixIdFromWikidata('tt1', 'http://w/', a('123'))).toBe('123');
    expect(await netflixIdFromWikidata('tt1', 'http://w/', a('12/../x'))).toBeNull();
  });
  it('Jellyfin: a TMDB ID merges with the catalogue, otherwise it keeps its own key', () => {
    const item = { Id: 'i', Name: 'N', Type: 'Series', ProviderIds: { Tmdb: '5', Imdb: 'tt5' }, UserData: {} };
    expect(itemToTitle(item as never, () => null).key).toBe('tmdb:tv:5');
    expect(itemToTitle({ Id: 'i', Name: 'N', Type: 'Movie' } as never, () => null).key).toBe('jellyfin:i');
  });
});
