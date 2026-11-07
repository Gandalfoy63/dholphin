// Docs: docs/02 - Tech/Discovery Sources.md
// Purpose: lists of titles from AniList, Jikan (MyAnimeList), TVmaze and Trakt, read into candidates TMDB can match.

import type { Title } from '@/sdk/types';

/** Anime: animation first made in Japanese, Chinese or Korean. */
export const isAnime = (t: Pick<Title, 'genres' | 'language'>, original = t.language) => t.genres.includes('Animation') && ['ja', 'zh', 'ko'].includes(original);

/** A title another source lists, with what it knows to find it on TMDB: an ID when it has one, else name and year. */
export interface Candidate { name: string; alt?: string; year?: number | null; kind: 'movie' | 'tv'; tmdb?: number; imdb?: string; tvdb?: number; anime?: boolean }

/** AniList's lists: trending, or the season's most popular. Docs: AniList/GraphQL. */
export function anilistQuery(list: 'trending' | 'season', now = new Date()): { query: string; variables: Record<string, unknown> } {
  const m = now.getMonth(), season = ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'][m]!;
  const year = m === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const query = `query ($sort: [MediaSort], $season: MediaSeason, $year: Int) { Page(perPage: 30) { media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $year) { id format seasonYear startDate { year } title { english romaji native } } } }`;
  return { query, variables: list === 'trending' ? { sort: ['TRENDING_DESC'] } : { sort: ['POPULARITY_DESC'], season, year } };
}

const FILM = new Set(['MOVIE', 'Movie']);
const SKIP = new Set(['MUSIC', 'Music', 'PV', 'CM']);

export function anilistCandidates(json: unknown): Candidate[] {
  const media = (json as { data?: { Page?: { media?: { format?: string; seasonYear?: number; startDate?: { year?: number }; title?: { english?: string; romaji?: string; native?: string } }[] } } }).data?.Page?.media ?? [];
  return media.filter((m) => !SKIP.has(m.format ?? '')).map((m) => ({
    name: m.title?.english || m.title?.romaji || '', alt: m.title?.romaji || m.title?.native, year: m.seasonYear ?? m.startDate?.year ?? null,
    kind: FILM.has(m.format ?? '') ? 'movie' as const : 'tv' as const, anime: true,
  })).filter((c) => c.name);
}

/** Jikan answers for `/top/anime` and `/seasons/now`. Docs: Jikan/Top, Jikan/Seasons. */
export function jikanCandidates(json: unknown): Candidate[] {
  const data = (json as { data?: { title?: string; title_english?: string | null; type?: string; year?: number | null; aired?: { prop?: { from?: { year?: number | null } } } }[] }).data ?? [];
  const seen = new Set<string>();
  return data.filter((a) => !SKIP.has(a.type ?? '')).map((a) => ({
    name: a.title_english || a.title || '', alt: a.title, year: a.year ?? a.aired?.prop?.from?.year ?? null,
    kind: FILM.has(a.type ?? '') ? 'movie' as const : 'tv' as const, anime: true,
  })).filter((c) => c.name && !seen.has(c.name) && !!seen.add(c.name));
}

/** TVmaze's web schedule: one entry per episode, so one candidate per show. Docs: TVmaze/API (schedule, externals). */
export function tvmazeCandidates(json: unknown): Candidate[] {
  const list = (json as { _embedded?: { show?: { id?: number; name?: string; premiered?: string | null; externals?: { imdb?: string | null; thetvdb?: number | null } } } }[]) ?? [];
  const seen = new Set<number>();
  return (Array.isArray(list) ? list : []).flatMap((e) => {
    const s = e._embedded?.show;
    if (!s?.id || !s.name || seen.has(s.id)) return [];
    seen.add(s.id);
    return [{ name: s.name, year: s.premiered ? Number(s.premiered.slice(0, 4)) : null, kind: 'tv' as const, imdb: s.externals?.imdb ?? undefined, tvdb: s.externals?.thetvdb ?? undefined }];
  });
}

/** Trakt lists: trending and anticipated wrap each title (`{ movie }`, `{ show }`), popular doesn't. They carry TMDB IDs. Docs: Trakt/Movies, Trakt/Shows. */
export function traktCandidates(json: unknown, kind: 'movie' | 'tv'): Candidate[] {
  const list = Array.isArray(json) ? json as Record<string, unknown>[] : [];
  return list.map((x) => (x.movie ?? x.show ?? x) as { title?: string; year?: number; ids?: { tmdb?: number; imdb?: string; tvdb?: number } })
    .filter((t) => t.title).map((t) => ({ name: t.title!, year: t.year ?? null, kind, tmdb: t.ids?.tmdb ?? undefined, imdb: t.ids?.imdb ?? undefined, tvdb: t.ids?.tvdb ?? undefined }));
}
