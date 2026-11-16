// Docs: docs/03 - Features/Home Rows.md
// Purpose: the best title of the month in each section (Series, Movies, Anime, TV Shows), for Home's section tiles.
import type { Params } from './catalog';
import type { Title } from '@/sdk/types';
import { SHOW_TYPES } from './tvshows';

export type Section = 'series' | 'movies' | 'anime' | 'tvshows';
export interface MonthQuery { kind: 'movie' | 'tv'; params: Params }

/** The window counted as "this month": the last 31 days, so the first of a month isn't empty. */
export const MONTH_DAYS = 31;
const minus = (today: string, n: number) => new Date(Date.parse(today) + -n * 86_400_000).toISOString().slice(0, 10);

/**
 * What each section asks TMDB for: films out in the last month, series and anime with an episode aired in it, TV
 * programmes on air in the profile's language. A few votes are asked of films and series, so a month's best is rated by
 * more than its makers. Docs: TMDB/Discover Movie, TMDB/Discover TV.
 */
export function monthQuery(section: Section, today: string, lang?: string): MonthQuery {
  const from = minus(today, MONTH_DAYS);
  const aired = { 'air_date.gte': from, 'air_date.lte': today, sort_by: 'popularity.desc' };
  switch (section) {
    case 'movies':
      return { kind: 'movie', params: { 'primary_release_date.gte': from, 'primary_release_date.lte': today, 'vote_count.gte': 10, sort_by: 'popularity.desc' } };
    case 'series':
      // Not animation, news, reality or talk: those are Anime and TV Shows.
      return { kind: 'tv', params: { ...aired, 'vote_count.gte': 20, without_genres: '16|10763|10764|10767' } };
    case 'anime':
      return { kind: 'tv', params: { ...aired, with_genres: 16, with_original_language: 'ja' } };
    case 'tvshows':
      return { kind: 'tv', params: { ...aired, with_type: SHOW_TYPES, with_original_language: lang } };
  }
}

/** The reviews' grade, 0 to 1: few votes pull it toward 6.5, as `byRating` does, so one 10/10 vote doesn't win. */
export const grade = (t: Pick<Title, 'scores'>) => (t.scores.tmdb * t.scores.tmdbVotes + 6.5 * 20) / (t.scores.tmdbVotes + 20) / 10;

/** How much the reviews count against the profile's likely liking (the algorithm), out of 1. */
export const REVIEWS_WEIGHT = 0.55;

/** The month's best: by reviews and by how likely this profile is to like it. Only titles with a picture to show. */
export function monthBest(titles: Title[], affinity: Map<string, number>): Title | undefined {
  const score = (t: Title) => REVIEWS_WEIGHT * grade(t) + (1 - REVIEWS_WEIGHT) * (affinity.get(t.key) ?? 0);
  return titles.filter((t) => t.backdrop).map((t, i) => ({ t, i, s: score(t) })).sort((a, b) => b.s - a.s || a.i - b.i)[0]?.t;
}
