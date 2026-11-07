// Docs: docs/03 - Features/Home Rows.md
// Purpose: which rows Home shows, as a list. Add an entry and the row exists. Below them, the endless feed.
import { app } from '@/ui/app';
import { getLocale, reasonText, t } from '@/ui/i18n';
import type { Item, RowDef } from '@/ui/rows';
import type { Title } from '@/sdk/types';
import type { ExternalList } from './catalog';
import { key as nameKey } from './dubbing';
import { isAnime } from './sources';
import { endlessFeed, fromQueries, profileLang, type KindFilter, type Kinds } from './bands';
import { byRating } from './categories';
import { SHOW_NETWORKS, SHOW_TYPES } from './tvshows';

export type { KindFilter, Kinds } from './bands';

/** The fixed rows, then the first batch of the feed. `more` gives the next batch, for as long as the page scrolls. */
export function homeRows(filter: KindFilter, kinds: Kinds = 'all'): { rows: RowDef[]; more: () => RowDef[] } {
  const more = endlessFeed(filter, kinds);
  const rows: RowDef[] = [
    {
      id: 'continue', heading: t('Continue Watching'), keepAll: true,
      load: () => continueItems(filter),
    },
    {
      id: 'top', heading: t('Top Picks for you'), poster: true, fixed: true,
      load: async () => {
        await app.engine.refreshPool();
        // Left out: what you watched, and titles with someone you said Not for me to.
        const people = Object.values(await app.library.people()).filter((x) => x.rating === 'dislike').flatMap((x) => x.keys);
        const seen = [...(await app.library.resting()), ...people];
        return app.engine.topPicks(40, seen).filter((s) => filter(s.title)).map((s) => ({ title: s.title, why: reasonText(s.reason) }));
      },
    },
    {
      id: 'top10', heading: t('Top 10 in {region}', { region: regionName() }), poster: true, ranked: true, keepAll: true,
      load: async () => (await app.catalog.topInRegion()).filter(filter).slice(0, 10).map((title, i) => ({ title, n: i + 1, why: t('Trending in {region}', { region: regionName() }) })),
    },
    {
      // Big posters, in the profile's language, best rated first. Too few in it: other languages follow, also by rating.
      id: 'new', heading: t('New Arrivals'), poster: true, big: true,
      load: async () => {
        const mine = byRating(await fromQueries('new', filter));
        if (mine.length >= 10) return mine;
        const have = new Set(mine.map((i) => i.title.key));
        return [...mine, ...byRating(await fromQueries('new', filter, () => true, [1, 2], 'all', null)).filter((i) => !have.has(i.title.key))];
      },
    },
    ...app.providers.filter((p) => p.watchProviderId).map((p): RowDef => ({
      id: `on-${p.id}`, heading: p.name, logo: p.logos[0],
      load: async () => {
        const lists = await Promise.all((['movie', 'tv'] as const).flatMap((k) => [1, 2].map((page) => app.catalog.discover(k, { with_watch_providers: p.watchProviderId, sort_by: 'popularity.desc', page }))));
        const titles = lists.flat().map((x) => ({ ...x, watchProviders: [...new Set([...x.watchProviders, p.watchProviderId!])] }));
        await app.primeOffers(titles);
        return titles.filter(filter).sort((a, b) => b.popularity - a.popularity).map((title) => ({ title }));
      },
    })),
    {
      id: 'trending', heading: t('Trending Now'),
      load: async () => (await Promise.all([1, 2].map((page) => app.catalog.list('/trending/all/week', { page })))).flat().filter(filter).map((title) => ({ title, why: t('Trending now') })),
    },
    ...app.providers.filter((p) => p.rows).map((p): RowDef => ({
      id: `rows-${p.id}`, heading: p.name, logo: p.logos[0], keepAll: true,
      load: async () => app.catalog.add((await p.rows!(app.profile)).flatMap((r) => r.titles), p.name).filter(filter).map((title) => ({ title })),
    })),
    { id: 'upcoming', heading: t('Upcoming'), poster: true, fixed: true, load: () => fromQueries('upcoming', filter, () => true, [1]) },
    // More anime, new episodes and what people watch, from other sources. Each title shows once, as it first came.
    // Anime rows only for a profile that has picked, liked or watched an anime; the Anime page has them all.
    ...EXTERNAL.filter((x) => !x.trakt || app.catalog.traktKey).map(({ id, heading, anime }): RowDef => ({
      id, heading: t(heading), poster: !!anime,
      load: async () => (anime && !(await likesAnime()) ? [] : (await app.catalog.external(id)).filter(filter).map((title) => ({ title }))),
    })),
    { id: 'requested', heading: t('You Requested'), keepAll: true, load: async () => (await app.library.requests()).map((r): Item => ({ title: r.title, state: r.state })).filter((i) => filter(i.title)) },
    { id: 'list', heading: t('My List'), keepAll: true, load: async () => (await app.library.list()).map((e) => ({ title: e.title })).filter((i) => filter(i.title)) },
    because(filter),
    withActor(filter),
    ...more(),
  ];
  return { rows, more };
}

/** Rows from other sources. Trakt's only with its key. */
const EXTERNAL: { id: ExternalList; heading: string; trakt?: boolean; anime?: boolean }[] = [
  { id: 'anilist-trending', heading: 'Trending anime', anime: true }, { id: 'anilist-season', heading: "This season's anime", anime: true },
  { id: 'mal-airing', heading: 'Top airing anime', anime: true }, { id: 'tvmaze-today', heading: 'New episodes today' },
  { id: 'trakt-trending', heading: 'Trending on Trakt', trakt: true }, { id: 'trakt-anticipated', heading: 'Most anticipated', trakt: true },
];

/**
 * Continue Watching: your own history, newest first, then what providers can resume. Each title once: the same
 * title under two keys (TMDB's and the server's own) or twice in the history counts once, as the same kind and name
 * with years at most one apart.
 */
export async function continueItems(filter: KindFilter): Promise<Item[]> {
  const own = await app.library.continueWatching();
  const fromProviders = (await Promise.all(app.providers.map((p) => p.resumePoints?.(app.profile).catch(() => []) ?? []))).flat();
  const all = [
    ...own.map((h): Item => ({ title: h.title, progress: h.progress, startSec: h.positionSec })),
    ...fromProviders.map((r): Item => ({ title: r.title, progress: r.progress, startSec: r.startSec })),
  ];
  const kept: Item[] = [];
  for (const i of all) {
    const same = kept.some(({ title: k }) => k.key === i.title.key || (k.kind === i.title.kind && nameKey(k.name) === nameKey(i.title.name) && (!k.year || !i.title.year || Math.abs(k.year - i.title.year) <= 1)));
    if (!same && filter(i.title)) kept.push(i);
  }
  return kept;
}

/** Whether this profile has picked, liked, listed or watched an anime. Until then, anime stays on the Anime page. */
export async function likesAnime(): Promise<boolean> {
  const [signals, history] = await Promise.all([app.library.signals(), app.library.history()]);
  return [...signals.filter((x) => x.kind !== 'dislike').map((x) => x.title), ...history.map((h) => h.title)].some((x) => !!x && isAnime(x));
}

/**
 * The Anime page: what you were watching, the anime lists of AniList and MyAnimeList, then TMDB's Japanese
 * animation by popularity, rating and date, and more of it as the page scrolls.
 */
/**
 * The TV Shows page: talk shows, reality, news and the entertainment channels' programmes, in the profile's language
 * first, then a row per channel, then the best rated; more of each as it scrolls. See tvshows.ts for what counts.
 */
export function tvShowRows(): { rows: RowDef[]; more: () => RowDef[] } {
  const lang = profileLang() ?? undefined;
  const show = (x: Title) => app.catalog.isShow(x);
  const disc = (params: Record<string, string | number | undefined>, page = 1) => async () =>
    (await app.catalog.discover('tv', { sort_by: 'popularity.desc', ...params, page })).filter(show).map((title): Item => ({ title }));
  const rows: RowDef[] = [
    { id: 'shows-continue', heading: t('Continue Watching'), keepAll: true, load: () => continueItems(show) },
    { id: 'shows-pop', heading: t('Popular TV shows'), poster: true, minCards: 1, load: disc({ with_type: SHOW_TYPES, with_original_language: lang }) },
    { id: 'shows-talk', heading: t('Talk shows'), minCards: 1, load: disc({ with_genres: 10767, with_original_language: lang }) },
    { id: 'shows-reality', heading: t('Reality TV'), minCards: 1, load: disc({ with_genres: 10764, with_original_language: lang }) },
    { id: 'shows-news', heading: t('News and magazines'), minCards: 1, load: disc({ with_genres: 10763, with_original_language: lang }) },
    ...Object.entries(SHOW_NETWORKS).map(([id, name]): RowDef => ({ id: `shows-net-${id}`, heading: t('On {name}', { name }), minCards: 1, load: disc({ with_networks: id }) })),
    { id: 'shows-best', heading: t('Best rated TV shows'), poster: true, minCards: 1, load: disc({ with_type: SHOW_TYPES, sort_by: 'vote_average.desc', 'vote_count.gte': 50 }) },
  ];
  let page = 1;
  const more = (): RowDef[] => {
    if (++page > 6) return [];
    return [
      { id: `shows-pop-${page}`, heading: t('More TV shows'), minCards: 1, load: disc({ with_type: SHOW_TYPES, with_original_language: lang }, page) },
      { id: `shows-net-all-${page}`, heading: t('More from TV channels'), minCards: 1, load: disc({ with_networks: Object.keys(SHOW_NETWORKS).join('|') }, page) },
    ];
  };
  return { rows, more };
}

export function animeRows(): { rows: RowDef[]; more: () => RowDef[] } {
  const disc = (kind: 'movie' | 'tv', params: Record<string, string | number>, page = 1) => async () =>
    (await app.catalog.discover(kind, { with_genres: 16, with_original_language: 'ja', ...params, page })).filter((x) => isAnime(x)).map((title): Item => ({ title }));
  const year = new Date().getFullYear();
  const rows: RowDef[] = [
    { id: 'anime-continue', heading: t('Continue Watching'), keepAll: true, load: () => continueItems((x) => isAnime(x)) },
    ...EXTERNAL.filter((x) => x.anime).map(({ id, heading }): RowDef => ({ id, heading: t(heading), poster: true, load: async () => (await app.catalog.external(id)).map((title) => ({ title })) })),
    { id: 'anime-new', heading: t('New anime series'), load: disc('tv', { sort_by: 'popularity.desc', 'first_air_date.gte': `${year - 1}-01-01` }) },
    { id: 'anime-pop', heading: t('Popular anime series'), poster: true, load: disc('tv', { sort_by: 'popularity.desc' }) },
    { id: 'anime-top', heading: t('Best rated anime series'), load: disc('tv', { sort_by: 'vote_average.desc', 'vote_count.gte': 300 }) },
    { id: 'anime-films', heading: t('Anime films'), poster: true, load: disc('movie', { sort_by: 'popularity.desc' }) },
    { id: 'anime-top-films', heading: t('Best rated anime films'), load: disc('movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 300 }) },
  ];
  // Further down, more of the same, two rows at a time, for as long as TMDB has pages.
  let page = 1;
  const more = (): RowDef[] => {
    if (++page > 10) return [];
    return [
      { id: `anime-pop-${page}`, heading: t('More anime series'), load: disc('tv', { sort_by: 'popularity.desc' }, page) },
      { id: `anime-films-${page}`, heading: t('More anime films'), poster: true, load: disc('movie', { sort_by: 'popularity.desc' }, page) },
    ];
  };
  return { rows, more };
}

/** The titles of the actor you loved or liked last, best known first; none of what you watched or said Not for me to. */
function withActor(filter: KindFilter): RowDef {
  const def: RowDef = {
    id: 'with-actor', heading: t('With actors you like'),
    load: async () => {
      const fan = Object.values(await app.library.people()).filter((x) => x.rating !== 'dislike').sort((a, b) => (b.rating === 'love' ? 1 : 0) - (a.rating === 'love' ? 1 : 0) || b.at - a.at)[0];
      if (!fan) return [];
      const page = await app.catalog.person({ id: fan.id, name: fan.name });
      if (!page) return [];
      def.heading = t('With {name}', { name: page.name });
      const skip = new Set([...(await app.library.history()).map((h) => h.key), ...Object.entries(await app.library.ratings()).filter(([, v]) => v === 'dislike').map(([k]) => k)]);
      return page.known.filter((x) => filter(x) && !skip.has(x.key)).map((title) => ({ title, why: t('With {name}', { name: page.name }) }));
    },
  };
  return def;
}

function because(filter: KindFilter): RowDef {
  const def: RowDef = {
    id: 'because', heading: t('Because you liked'),
    load: async () => {
      const liked = (await app.library.signals()).find((s) => ['love', 'like', 'pick', 'finished'].includes(s.kind) && s.title);
      if (!liked?.title) return [];
      def.heading = t('Because you liked {name}', { name: liked.title.name });
      const rec = await app.catalog.recommendations(liked.title);
      return rec.filter(filter).slice(0, 20).map((title) => ({ title, why: def.heading }));
    },
  };
  return def;
}

function regionName() {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(app.profile.region) ?? app.profile.region;
  } catch {
    return app.profile.region;
  }
}
