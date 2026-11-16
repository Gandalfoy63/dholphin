// Docs: docs/03 - Features/Library.md
// Purpose: the Library's one list: its filters, its order, its letters, every service's titles from the title index merged once.
import { recToTitle, type Rec } from './titleindex';
import type { Title } from '@/sdk/types';

export type LibKind = 'all' | 'movie' | 'series';
export type LibEra = 'any' | '2020' | '2010' | '2000' | '1990' | '1980' | 'older';
export type LibSort = 'az' | 'za' | 'best' | 'worst' | 'new' | 'old';
export interface LibFilters { kind: LibKind; era: LibEra; stars: 0 | 6 | 7 | 8; sort: LibSort; /** Services turned off, by provider ID. */ off: string[] }

/** A to Z, every service, any period and rating: the Library as it opens the first time. */
export const DEFAULT_FILTERS: LibFilters = { kind: 'all', era: 'any', stars: 0, sort: 'az', off: [] };

/** Keeps what is known of a saved set, the defaults for the rest (a value from an older version is dropped). */
export function readFilters(saved: unknown): LibFilters {
  const s = (saved ?? {}) as Partial<LibFilters>;
  const one = <T>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
  return {
    kind: one(s.kind, ['all', 'movie', 'series'] as const, DEFAULT_FILTERS.kind),
    era: one(s.era, ['any', '2020', '2010', '2000', '1990', '1980', 'older'] as const, DEFAULT_FILTERS.era),
    stars: one(s.stars, [0, 6, 7, 8] as const, DEFAULT_FILTERS.stars),
    sort: one(s.sort, ['az', 'za', 'best', 'worst', 'new', 'old'] as const, DEFAULT_FILTERS.sort),
    off: Array.isArray(s.off) ? s.off.filter((x): x is string => typeof x === 'string') : [],
  };
}

/** A period's first and last year; `older` is before 1980. */
export function eraYears(era: LibEra): [number, number] | null {
  if (era === 'any') return null;
  if (era === 'older') return [1800, 1979];
  return [Number(era), Number(era) + 9];
}

/** Whether a title fits the filters. */
export function fits(t: Title, f: LibFilters): boolean {
  if (f.kind !== 'all' && t.kind !== f.kind) return false;
  const years = eraYears(f.era);
  if (years && (!t.year || t.year < years[0] || t.year > years[1])) return false;
  if (f.stars && !(rated(t) && t.scores.tmdb >= f.stars)) return false;
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true, ignorePunctuation: true });
const byName = (a: Title, b: Title) => collator.compare(a.name, b.name) || (a.year ?? 0) - (b.year ?? 0);
/**
 * Ratings from fewer votes than this count as none: a 10 from one vote would lead Best rated. A service's own rating
 * (Jellyfin's, with no vote count) counts.
 */
export const MIN_VOTES = 20;
const rated = (t: Title) => t.scores.tmdb > 0 && (t.scores.tmdbVotes === 0 || t.scores.tmdbVotes >= MIN_VOTES);
/** No rating goes last in either direction. */
const rating = (t: Title, missing: number) => (rated(t) ? t.scores.tmdb : missing);

/** The order of the list. */
export function comparer(sort: LibSort): (a: Title, b: Title) => number {
  switch (sort) {
    case 'az': return byName;
    case 'za': return (a, b) => byName(b, a);
    case 'best': return (a, b) => rating(b, -1) - rating(a, -1) || byName(a, b);
    case 'worst': return (a, b) => rating(a, 99) - rating(b, 99) || byName(a, b);
    case 'new': return (a, b) => (b.year ?? 0) - (a.year ?? 0) || byName(a, b);
    case 'old': return (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byName(a, b);
  }
}

export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
/** The letter a name files under: its first letter without accents, `#` for a digit or a sign. */
export function letterOf(name: string): string {
  const c = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}
/** The same title from two services counts once: by its TMDB ID and kind, else by its key. */
export const identity = (t: Title) => (t.tmdbId ? `${t.kind}:${t.tmdbId}` : t.key);

/** One service's records from the title index, with its TMDB watch provider ID when it has one. */
export interface IndexSource { recs: Rec[]; watchId?: number }

/**
 * The Library's list: every service's titles, the same title on two services once (with both services noted), home
 * videos only with Movies and series, filtered and ordered. All in memory: a list of thousands sorts in milliseconds.
 */
export function buildList(sources: IndexSource[], f: LibFilters): Title[] {
  const all = new Map<string, Title>();
  for (const s of sources) {
    for (const r of s.recs) {
      if (r[1] === 2 && f.kind !== 'all') continue;
      const t = recToTitle(r, s.watchId ? [s.watchId] : []);
      const id = identity(t), had = all.get(id);
      if (had) {
        if (s.watchId && !had.watchProviders.includes(s.watchId)) had.watchProviders.push(s.watchId);
        // A service's own copy (Jellyfin's key) is kept: it plays from there.
        if (r[8] && !had.key.startsWith('tmdb:')) continue;
        if (r[8]) all.set(id, { ...t, watchProviders: had.watchProviders });
        continue;
      }
      all.set(id, t);
    }
  }
  return [...all.values()].filter((t) => fits(t, f)).sort(comparer(f.sort));
}

/** The letters the list has titles under, and where each starts. */
export function letterStarts(list: Title[]): Map<string, number> {
  const out = new Map<string, number>();
  list.forEach((t, i) => {
    const l = letterOf(t.name);
    if (!out.has(l)) out.set(l, i);
  });
  return out;
}
