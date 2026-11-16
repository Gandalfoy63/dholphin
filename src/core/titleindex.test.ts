// Docs: docs/03 - Features/Library.md
// Purpose: tests the title index: what a record keeps, reading every page, cutting long lists by year, and the read's states.
import { describe, expect, it } from 'vitest';
import { memoryStore } from './store';
import { crawl, MAX_PAGES, recFromTmdb, recToTitle, TitleIndex } from './titleindex';
import type { Provider } from '@/sdk/types';

const row = (id: number, year: number) => ({ id, title: `Film ${id}`, name: `Film ${id}`, release_date: `${year}-05-01`, vote_average: 7.4, vote_count: 900, poster_path: `/p${id}.jpg`, genre_ids: [18] });

describe('records', () => {
  it('keep only what the Library needs, and come back as a title with the same key as TMDB lists', () => {
    const r = recFromTmdb(row(5, 1999), 'movie')!;
    expect(r).toEqual([5, 0, 'Film 5', 1999, 74, 900, '/p5.jpg', [18]]);
    expect(recToTitle(r)).toMatchObject({ key: 'tmdb:movie:5', kind: 'movie', name: 'Film 5', year: 1999, poster: '/p5.jpg', scores: { tmdb: 7.4, tmdbVotes: 900 } });
    expect(recToTitle(recFromTmdb({ id: 9, name: 'Show', first_air_date: '2020-01-01' }, 'tv')!).key).toBe('tmdb:tv:9');
  });
});

describe('crawl', () => {
  it('reads every page of films and series, a few at a time', async () => {
    const asked: string[] = [];
    const recs = await crawl(async (kind, q) => {
      asked.push(`${kind}:${q.page}`);
      return { total_pages: 3, results: [{ ...row(Number(q.page) + (kind === 'tv' ? 100 : 0), 2001), ...(kind === 'tv' ? { name: 'S' } : {}) }] };
    }, {}, 2026, () => undefined);
    expect(recs).toHaveLength(6);
    expect(asked.sort()).toEqual(['movie:1', 'movie:2', 'movie:3', 'tv:1', 'tv:2', 'tv:3']);
  });
  it('cuts a list longer than TMDB allows by year until each part fits', async () => {
    const windows: string[] = [];
    await crawl(async (_kind, q) => {
      const from = Number(String(q['primary_release_date.gte'] ?? q['first_air_date.gte'] ?? '1870').slice(0, 4));
      const to = Number(String(q['primary_release_date.lte'] ?? q['first_air_date.lte'] ?? '2028').slice(0, 4));
      if (q.page === 1) windows.push(`${from}-${to}`);
      // 40 pages a year: too many for one list over more than 12 years.
      const pages = (to - from + 1) * 40;
      return { total_pages: pages > MAX_PAGES ? pages : 1, results: [] };
    }, {}, 2026, () => undefined);
    expect(windows[0]).toBe('1870-2028');
    expect(windows.slice(1).every((w) => { const [a, b] = w.split('-').map(Number); return b - a + 1 <= 13 || windows.includes(`${a}-${(a + b) >> 1}`); })).toBe(true);
  });
});

describe('TitleIndex', () => {
  const netflix = { id: 'netflix', name: 'Netflix', watchProviderId: 8, status: async () => ({ connected: true }) } as unknown as Provider;
  const deps = (fail = false) => ({
    store: memoryStore(), providers: () => [netflix], profile: () => ({ id: 'a' }) as never,
    scope: () => ({ region: 'FR', language: 'fr-FR', maturity: '18+' }), blocked: () => [],
    discoverRaw: async () => {
      if (fail) throw new Error('TMDB answered 500');
      return { total_pages: 1, results: [row(1, 2000), row(2, 2010)] };
    },
  });
  it('reads a service in the background, keeps it, and says where it stands', async () => {
    const ix = new TitleIndex(deps());
    expect((await ix.statuses())[0]).toMatchObject({ state: 'waiting', count: 0 });
    await ix.refresh();
    expect((await ix.statuses())[0]).toMatchObject({ state: 'done', count: 4 });
    expect(await ix.items(netflix)).toHaveLength(4);
  });
  it('says when a read failed', async () => {
    const ix = new TitleIndex(deps(true));
    await ix.refresh();
    expect((await ix.statuses())[0]).toMatchObject({ state: 'error', error: 'TMDB answered 500' });
  });
  it('keeps only the services there are: one disconnected loses its catalogue', async () => {
    let on = true;
    const p = { ...netflix, status: async () => ({ connected: on }) } as unknown as Provider;
    const d = { ...deps(), providers: () => [p] };
    const ix = new TitleIndex(d);
    await ix.refresh();
    expect(await d.store.keys('index:netflix')).toHaveLength(1);
    on = false;
    await ix.refresh();
    expect(await d.store.keys('index:netflix')).toHaveLength(0);
    expect(await ix.statuses()).toEqual([]);
  });
  it('serves Search too unless told the Library only', async () => {
    const ix = new TitleIndex(deps());
    expect(await ix.forSearch()).toBe(true);
    await ix.setForSearch(false);
    await ix.refresh();
    expect(await ix.forSearch()).toBe(false);
  });
  it('finds titles by the start of each word, accents aside', async () => {
    const ix = new TitleIndex({ ...deps(), discoverRaw: async () => ({ total_pages: 1, results: [{ ...row(1, 2000), title: 'Amélie Poulain', name: 'Amélie Poulain' }, row(2, 2001)] }) });
    await ix.refresh();
    expect((await ix.find('ameli poul')).map((t) => t.name)).toEqual(['Amélie Poulain', 'Amélie Poulain']);
    expect(await ix.find('zzz')).toEqual([]);
  });
});
