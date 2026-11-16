// Docs: docs/03 - Features/Home Rows.md
// Purpose: tests the month's best per section: its TMDB query and how reviews and the profile's taste weigh.
import { describe, expect, it } from 'vitest';
import type { Title } from '@/sdk/types';
import { monthBest, monthQuery } from './monthbest';

const t = (key: string, tmdb: number, tmdbVotes: number, backdrop: string | null = '/b.jpg') =>
  ({ key, tmdbId: 1, kind: 'movie', name: key, overview: '', genres: [], language: 'en', watchProviders: [], popularity: 1, backdrop, scores: { tmdb, tmdbVotes } }) as unknown as Title;

describe('monthQuery', () => {
  it('asks for the last 31 days', () => {
    const q = monthQuery('movies', '2026-11-15');
    expect(q).toMatchObject({ kind: 'movie', params: { 'primary_release_date.gte': '2026-10-15', 'primary_release_date.lte': '2026-11-15' } });
  });
  it('keeps anime and TV programmes out of Series, and each in its own', () => {
    expect(monthQuery('series', '2026-11-15').params.without_genres).toBe('16|10763|10764|10767');
    expect(monthQuery('anime', '2026-11-15').params).toMatchObject({ with_genres: 16, with_original_language: 'ja', 'air_date.gte': '2026-10-15' });
    expect(monthQuery('tvshows', '2026-11-15', 'fr').params).toMatchObject({ with_original_language: 'fr' });
  });
});

describe('monthBest', () => {
  it('goes by reviews when the profile has no leaning', () => {
    expect(monthBest([t('ok', 6.8, 900), t('great', 8.6, 1200)], new Map())?.key).toBe('great');
  });
  it('does not let one 10/10 vote win', () => {
    expect(monthBest([t('lone', 10, 1), t('loved', 8.2, 5000)], new Map())?.key).toBe('loved');
  });
  it('lets a strong liking beat a slightly better grade', () => {
    expect(monthBest([t('critics', 8.0, 3000), t('mine', 7.6, 3000)], new Map([['critics', 0.2], ['mine', 0.9]]))?.key).toBe('mine');
  });
  it('needs a picture to show', () => {
    expect(monthBest([t('bare', 9, 9000, null), t('shown', 7, 100)], new Map())?.key).toBe('shown');
    expect(monthBest([], new Map())).toBeUndefined();
  });
});
