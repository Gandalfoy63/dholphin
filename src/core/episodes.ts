// Docs: docs/03 - Features/Episodes.md
// Purpose: a series' seasons and episodes, from the provider that plays it and from TMDB, merged once each.
import type { Episode, Season, SeasonInfo } from '@/sdk/types';

/** A season in the menu: the provider's when it has it (so its episodes play), with TMDB's count. */
export interface SeasonRow { number: number; name: string; provider?: Season; count?: number }
/** An episode in the menu: `playable` when the provider has it. `alt`: TMDB's picture, should the provider's fail to load. */
export interface EpisodeRow extends Episode { playable: boolean; alt?: string | null }

/** Seasons by number, once each: the provider's name first, TMDB's count. Specials (season 0) go last. */
export function mergeSeasons(provider: Season[], tmdb: SeasonInfo[]): SeasonRow[] {
  const out = new Map<number, SeasonRow>();
  for (const s of tmdb) if (!out.has(s.number)) out.set(s.number, { number: s.number, name: s.name, count: s.episodes || undefined });
  for (const s of provider) {
    const had = out.get(s.number);
    out.set(s.number, { ...had, number: s.number, name: s.name || had?.name || '', provider: had?.provider ?? s });
  }
  return [...out.values()].sort((a, b) => (a.number || 1e6) - (b.number || 1e6));
}

/**
 * Episodes by number, once each: the provider's (it plays them, it knows where you stopped), with what TMDB adds:
 * picture, summary, length, air date. A provider listing one episode twice (two versions of a file) shows it once.
 */
export function mergeEpisodes(provider: Episode[], tmdb: Episode[]): EpisodeRow[] {
  const out = new Map<number, EpisodeRow>();
  for (const e of tmdb) if (!out.has(e.number)) out.set(e.number, { ...e, playable: false });
  const mine = new Set<number>();
  for (const e of provider) {
    if (mine.has(e.number)) continue;
    mine.add(e.number);
    const t = out.get(e.number);
    out.set(e.number, { ...t, ...e, name: e.name || t?.name || '', overview: e.overview || t?.overview, still: e.still ?? t?.still ?? null, alt: e.still && t?.still ? t.still : null, runtime: e.runtime ?? t?.runtime ?? null, airDate: e.airDate ?? t?.airDate ?? null, playable: true });
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/** TMDB's season answer → episodes. Docs: TMDB/TV Season. */
export function tmdbSeason(json: unknown, tmdbId: number, season: number, img: (p?: string | null) => string | null): Episode[] {
  const eps = (json as { episodes?: { episode_number?: number; name?: string; overview?: string; still_path?: string | null; runtime?: number | null; air_date?: string | null }[] }).episodes ?? [];
  return eps.filter((e) => e.episode_number != null).map((e) => ({
    id: `tmdb:${tmdbId}:${season}:${e.episode_number}`, season, number: e.episode_number!, name: e.name ?? '', overview: e.overview || undefined,
    still: img(e.still_path), runtime: e.runtime ?? null, airDate: e.air_date ?? null,
  }));
}
