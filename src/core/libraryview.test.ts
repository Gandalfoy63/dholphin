// Docs: docs/03 - Features/Library.md
// Purpose: tests the Library's list: saved filters, TMDB's parameters, the order, letters, and the merge of services.
import { describe, expect, it } from 'vitest';
import type { Title } from '@/sdk/types';
import { buildList, comparer, DEFAULT_FILTERS, fits, letterOf, letterStarts, readFilters, type LibFilters } from './libraryview';
import type { Rec } from './titleindex';

let n = 0;
const t = (name: string, o: Partial<Title> & { score?: number } = {}) =>
  ({ key: `k${++n}`, tmdbId: o.tmdbId ?? n, kind: o.kind ?? 'movie', name, year: o.year ?? 2000, scores: { tmdb: o.score ?? 7, tmdbVotes: 100 } }) as unknown as Title;
const f = (o: Partial<LibFilters> = {}): LibFilters => ({ ...DEFAULT_FILTERS, ...o });
const names = (l: Title[]) => l.map((x) => x.name);

describe('filters', () => {
  it('opens A to Z with everything, and keeps what was saved', () => {
    expect(readFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(readFilters({ sort: 'best', era: '1990', stars: 7, off: ['netflix'], kind: 'series' })).toEqual({ sort: 'best', era: '1990', stars: 7, off: ['netflix'], kind: 'series' });
  });
  it('drops a value it does not know', () => {
    expect(readFilters({ sort: 'random', stars: 5 })).toEqual(DEFAULT_FILTERS);
  });
  it('filters a list held in memory the same way', () => {
    expect(fits(t('A', { year: 1995, score: 7.5 }), f({ era: '1990', stars: 7 }))).toBe(true);
    expect(fits(t('B', { year: 2005 }), f({ era: '1990' }))).toBe(false);
    expect(fits(t('C', { score: 0 }), f({ stars: 6 }))).toBe(false);
    expect(fits({ ...t('Few votes', { score: 9 }), scores: { tmdb: 9, tmdbVotes: 3 } } as Title, f({ stars: 8 }))).toBe(false);
    expect(fits(t('D', { kind: 'series' }), f({ kind: 'movie' }))).toBe(false);
  });
});

describe('order and letters', () => {
  it('sorts names as people read them: accents and case aside, numbers in order', () => {
    expect(names([t('épisode'), t('Zorro'), t('alpha'), t('Film 10'), t('Film 9')].sort(comparer('az')))).toEqual(['alpha', 'épisode', 'Film 9', 'Film 10', 'Zorro']);
  });
  it('puts titles without a rating last, either way', () => {
    const l = [t('none', { score: 0 }), t('low', { score: 4 }), t('high', { score: 9 })];
    expect(names([...l].sort(comparer('best')))).toEqual(['high', 'low', 'none']);
    expect(names([...l].sort(comparer('worst')))).toEqual(['low', 'high', 'none']);
  });
  it('files a name under its letter', () => {
    expect([letterOf('Élite'), letterOf('"Weird"'), letterOf('1917'), letterOf('zoo')]).toEqual(['E', 'W', '#', 'Z']);
  });
});

describe('buildList', () => {
  const rec = (id: number, name: string, kind: 0 | 1 | 2 = 0, key?: string): Rec => [id, kind, name, 2001, 72, 400, `/p${id}.jpg`, [], ...(key ? [key] : [])] as Rec;
  it('merges every service, a title on two once, with both services noted, in order', () => {
    const l = buildList([{ recs: [rec(1, 'Zodiac'), rec(2, 'Alien')], watchId: 8 }, { recs: [rec(2, 'Alien', 0, 'jellyfin:a'), rec(3, 'Brave')] }], f());
    expect(names(l)).toEqual(['Alien', 'Brave', 'Zodiac']);
    expect(l[0]).toMatchObject({ key: 'jellyfin:a', watchProviders: [8] });
  });
  it('keeps home videos for Movies and series only', () => {
    const src = [{ recs: [rec(0, 'Holiday 2019', 2, 'jellyfin:h'), rec(4, 'Film')] }];
    expect(names(buildList(src, f()))).toEqual(['Film', 'Holiday 2019']);
    expect(names(buildList(src, f({ kind: 'movie' })))).toEqual(['Film']);
  });
  it('knows where each letter starts', () => {
    const l = buildList([{ recs: [rec(1, 'Alien'), rec(2, 'Amélie'), rec(3, 'Brave'), rec(4, '1917')] }], f());
    expect([...letterStarts(l)]).toEqual([['#', 0], ['A', 1], ['B', 3]]);
  });
});
