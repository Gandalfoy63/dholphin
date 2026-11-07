// Docs: docs/04 - Architecture/Title Registry.md
// Purpose: tests for the title registry and the lists from other sources.
import { describe, expect, it } from 'vitest';
import type { Title } from '@/sdk/types';
import { Registry } from './registry';
import { anilistCandidates, anilistQuery, jikanCandidates, traktCandidates, tvmazeCandidates } from './sources';
import { memoryStore } from './store';

const title = (key: string, name: string, extra: Partial<Title> = {}): Title => ({ key, tmdbId: Number(key.split(':').pop()) || 0, kind: 'series', name, year: 2020, overview: '', genres: [], keywords: [], people: [], creators: [], language: 'ja', popularity: 1, scores: { tmdb: 7, tmdbVotes: 1 }, watchProviders: [], ...extra });

describe('registry', () => {
  it('keeps who gave a title first, and adds the others as secondary', async () => {
    const store = memoryStore(), r = new Registry(store);
    r.note([title('tmdb:tv:1', 'Frieren')], 'TMDB');
    r.note([title('tmdb:tv:1', 'Frieren')], 'AniList');
    r.note([title('tmdb:tv:1', 'Frieren')], 'AniList');
    expect(r.sources(title('tmdb:tv:1', 'Frieren'))).toEqual(['TMDB', 'AniList']);
    await r.flush();
    const again = new Registry(store);
    await again.load();
    expect(again.json().titles['tmdb:tv:1']).toMatchObject({ first: 'TMDB', secondary: ['AniList'], name: 'Frieren' });
  });

  it('gives back the first version of a title another source lists under another key', () => {
    const r = new Registry(memoryStore());
    const first = title('tmdb:tv:1', 'Frieren', { poster: '/a.jpg' });
    r.note([first], 'TMDB');
    const [got] = r.note([title('jellyfin:abc', 'FRIEREN', { year: 2021 })], 'Jellyfin');
    expect(got!.key).toBe('tmdb:tv:1');
    expect(r.note([title('jellyfin:x', 'Frieren', { year: 1990 })], 'Jellyfin')[0]!.key).toBe('jellyfin:x');
  });

  it('lets a version with a TMDB ID replace one without, keeping who came first', () => {
    const r = new Registry(memoryStore());
    r.note([title('jellyfin:abc', 'Frieren')], 'Jellyfin');
    r.note([title('tmdb:tv:9', 'Frieren')], 'TMDB');
    expect(r.json().titles['tmdb:tv:9']).toMatchObject({ first: 'Jellyfin', secondary: ['TMDB'] });
    expect(r.json().titles['jellyfin:abc']).toBeUndefined();
  });
});

describe('other sources', () => {
  it('reads AniList, films apart from series, music videos left out', () => {
    expect(anilistQuery('season', new Date(2026, 10, 7)).variables).toMatchObject({ season: 'FALL', year: 2026 });
    expect(anilistQuery('season', new Date(2026, 11, 20)).variables).toMatchObject({ season: 'WINTER', year: 2027 });
    const c = anilistCandidates({ data: { Page: { media: [{ format: 'TV', seasonYear: 2023, title: { english: 'Frieren: Beyond Journey’s End', romaji: 'Sousou no Frieren' } }, { format: 'MOVIE', startDate: { year: 2016 }, title: { romaji: 'Kimi no Na wa.' } }, { format: 'MUSIC', title: { romaji: 'x' } }] } } });
    expect(c).toEqual([{ name: 'Frieren: Beyond Journey’s End', alt: 'Sousou no Frieren', year: 2023, kind: 'tv', anime: true }, { name: 'Kimi no Na wa.', alt: 'Kimi no Na wa.', year: 2016, kind: 'movie', anime: true }]);
  });

  it('reads Jikan, TVmaze and Trakt', () => {
    expect(jikanCandidates({ data: [{ title: 'Sousou no Frieren', title_english: 'Frieren', type: 'TV', year: 2023 }, { title: 'Sousou no Frieren', title_english: 'Frieren', type: 'TV' }] })).toHaveLength(1);
    const sched = [{ _embedded: { show: { id: 1, name: 'A', premiered: '2024-01-02', externals: { imdb: 'tt1', thetvdb: 5 } } } }, { _embedded: { show: { id: 1, name: 'A' } } }];
    expect(tvmazeCandidates(sched)).toEqual([{ name: 'A', year: 2024, kind: 'tv', imdb: 'tt1', tvdb: 5 }]);
    expect(traktCandidates([{ watchers: 3, movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631, imdb: 'tt1160419' } } }], 'movie')[0]).toMatchObject({ name: 'Dune', tmdb: 438631 });
  });
});
