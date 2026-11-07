// Docs: docs/03 - Features/Home Rows.md
// Purpose: Home's endless feed, led by the profile's taste: category rows, and between them bands (made for you, your languages, themes you like, awards, decades).
import { app } from '@/ui/app';
import { reasonText, t } from '@/ui/i18n';
import type { Item, RowDef } from '@/ui/rows';
import type { Title } from '@/sdk/types';
import type { Params } from './catalog';
import { CATEGORIES, category, THEMES, type Category } from './categories';

export type KindFilter = (t: Title) => boolean;
export type Kinds = 'all' | 'movie' | 'series';
type Kind = 'movie' | 'tv';
const wants = (kinds: Kinds, k: Kind) => kinds === 'all' || (kinds === 'movie') === (k === 'movie');

/** The pages of one round: round 0 gets pages 1 to n, round 1 the next n, and so on, so each round shows new titles. */
export const pages = (round: number, n: number) => Array.from({ length: n }, (_, i) => round * n + i + 1);

/** Taking turns between lists, so popular series don't push out every film, or the reverse. */
function turns(lists: Title[][]): Title[] {
  const out: Title[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

/** The profile's language as TMDB's two-letter code: "fr-FR" → "fr". */
export const profileLang = () => app.profile.language.split('-')[0]!.toLowerCase();

/** Enough titles from a category's queries that its row stays full after repeats are removed. */
export async function fromQueries(id: string, filter: KindFilter, which: (heading: string) => boolean = () => true, pageList = [1, 2, 3], kinds: Kinds = 'all', lang: string | null = profileLang()): Promise<Item[]> {
  // null: every language.
  const queries = category(id)!.queries(app.today(), lang ?? undefined).filter((q) => which(q.heading) && wants(kinds, q.kind));
  const lists = await Promise.all(queries.flatMap((q) => pageList.map((page) => app.catalog.discover(q.kind, { ...q.params, page }).catch(() => [] as Title[]))));
  await app.primeOffers(lists.flat());
  return turns(lists).filter(filter).map((title) => ({ title }));
}

async function discoverBoth(kinds: Kinds, round: number, movie: Params | null, tv: Params | null, filter: KindFilter): Promise<Item[]> {
  const asks: [Kind, Params][] = [];
  if (movie && wants(kinds, 'movie')) asks.push(['movie', movie]);
  if (tv && wants(kinds, 'tv')) asks.push(['tv', tv]);
  const lists = await Promise.all(asks.flatMap(([k, p]) => pages(round, 2).map((page) => app.catalog.discover(k, { ...p, page }).catch(() => [] as Title[]))));
  await app.primeOffers(lists.flat());
  return turns(lists).filter(filter).map((title) => ({ title }));
}

const feature = (k: string) => app.engine.taste.features[k] ?? 0;

/** How much this profile likes a theme: its keyword counts double, plus the average of its genres. */
export function themeScore(c: Category): number {
  if (!c.taste) return 0;
  return 2 * feature(`k:${c.taste.keyword}`) + c.taste.genres.reduce((sum, g) => sum + feature(`g:${g}`), 0) / c.taste.genres.length;
}

/** Every theme, the ones this profile likes most first. Ties keep the list's order. */
export function themesByTaste(): Category[] {
  return THEMES.map((c, i) => ({ c, i, s: themeScore(c) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

/** The themes this profile shows a taste for, best first. */
export const themesForYou = (n = 6) => themesByTaste().filter((c) => themeScore(c) > 0).slice(0, n);

/**
 * This profile's languages: the one it uses Dholphin in, then the ones it watches most. English is left out, as most
 * of the catalog is in English already. Only languages with a category count.
 */
export function yourLanguages(n = 3): Category[] {
  const watched = Object.entries(app.engine.taste.features).filter(([k, v]) => k.startsWith('l:') && v > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k.slice(2));
  const codes = [...new Set([app.profile.language.slice(0, 2), ...watched])].filter((c) => c !== 'en');
  return codes.map((c) => CATEGORIES.find((x) => x.lang === c)).filter((c): c is Category => !!c).slice(0, n);
}

/** A band: a separator row, on posters. `load` gets the round, so a band met again shows the next titles. */
interface Band { id: string; heading: string; load: (round: number) => Promise<Item[]> }
type Group = 'you' | 'lang' | 'award' | 'theme' | 'decade' | 'more';

/** Made for you: the picks after the ones Top Picks shows, and more from what you liked. Once only. */
function forYou(filter: KindFilter): Band[] {
  const because = (n: number): Band => {
    const band: Band = {
      id: `because-${n}`, heading: t('Because you liked'),
      load: async (round) => {
        if (round) return [];
        const liked = (await app.library.signals()).filter((s) => ['love', 'like', 'pick', 'finished'].includes(s.kind) && s.title);
        const title = [...new Map(liked.map((s) => [s.title!.key, s.title!])).values()][n];
        if (!title) return [];
        band.heading = t('Because you liked {name}', { name: title.name });
        return (await app.catalog.recommendations(title)).filter(filter).map((x) => ({ title: x, why: band.heading }));
      },
    };
    return band;
  };
  return [
    {
      id: 'made-for-you', heading: t('Made for you'),
      load: async (round) => {
        if (round) return [];
        const seen = (await app.library.history()).map((h) => h.key);
        return app.engine.topPicks(120, seen).filter((s) => filter(s.title)).map((s) => ({ title: s.title, why: reasonText(s.reason) }));
      },
    },
    because(1), because(2),
  ];
}

/** Award winners, newest win first. The awards are Wikidata items: https://www.wikidata.org/wiki/<id>. */
const AWARDS: { id: string; name: string; kind: Kind; awards: string[] }[] = [
  { id: 'oscar', name: 'Best Picture Oscar winners', kind: 'movie', awards: ['Q102427'] },
  { id: 'palme', name: "Palme d'Or winners", kind: 'movie', awards: ['Q179808'] },
  { id: 'emmy', name: 'Emmy-winning series', kind: 'tv', awards: ['Q989438', 'Q2110156', 'Q20714679'] },
  { id: 'oscar-intl', name: 'Oscar winners: International Feature', kind: 'movie', awards: ['Q105304'] },
  { id: 'lion', name: 'Golden Lion winners, Venice', kind: 'movie', awards: ['Q209459'] },
  { id: 'oscar-anim', name: 'Oscar winners: Animated Feature', kind: 'movie', awards: ['Q106800'] },
  { id: 'bear', name: 'Golden Bear winners, Berlin', kind: 'movie', awards: ['Q154590'] },
  { id: 'bafta', name: 'BAFTA Best Film winners', kind: 'movie', awards: ['Q139184'] },
  { id: 'oscar-doc', name: 'Oscar winners: Documentary', kind: 'movie', awards: ['Q111332'] },
  { id: 'globe', name: 'Golden Globe winners: Drama', kind: 'movie', awards: ['Q1011509'] },
  { id: 'cesar', name: 'César Best Film winners', kind: 'movie', awards: ['Q645595'] },
  { id: 'goya', name: 'Goya Best Film winners', kind: 'movie', awards: ['Q1467554'] },
];
const AWARD_CARDS = 24;
function awardBands(filter: KindFilter, kinds: Kinds): Band[] {
  return AWARDS.filter((a) => wants(kinds, a.kind)).map((a) => ({
    id: `award-${a.id}`, heading: t(a.name),
    load: async (round) => {
      const ids = (await app.catalog.awardWinners(a.awards, a.kind)).slice(round * AWARD_CARDS, (round + 1) * AWARD_CARDS);
      const titles = await app.catalog.byIds(ids, a.kind);
      app.catalog.add(titles, 'Wikidata');
      await app.primeOffers(titles);
      return titles.filter(filter).map((title) => ({ title, why: t(a.name) }));
    },
  }));
}

/** Each decade's best rated, from the newest decade back. Each band runs newest to oldest. Series stop at the 1990s. */
const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950];
function decadeBands(kinds: Kinds): Band[] {
  const tv = kinds === 'series';
  const [from, to] = tv ? ['first_air_date.gte', 'first_air_date.lte'] : ['primary_release_date.gte', 'primary_release_date.lte'];
  return (tv ? DECADES.slice(0, 4) : DECADES).map((decade) => ({
    id: `best-${decade}`, heading: t('Best rated of all time: {decade}', { decade: t('{n}s', { n: decade }) }),
    load: async (round) => {
      const votes = tv ? 150 : decade >= 2000 ? 2000 : 400;
      const params = { sort_by: 'vote_average.desc', 'vote_count.gte': votes, [from]: `${decade}-01-01`, [to]: `${decade + 9}-12-31` };
      const titles = (await Promise.all(pages(round, 2).map((page) => app.catalog.discover(tv ? 'tv' : 'movie', { ...params, page })))).flat();
      return titles.sort((a, b) => (b.release ?? '').localeCompare(a.release ?? '')).map((title) => ({ title }));
    },
  }));
}

/** Themes, the ones this profile likes first, each best rated first. A theme without titles of this page's kind is left out. */
function themeBands(filter: KindFilter, kinds: Kinds): Band[] {
  return themesByTaste().filter((c) => c.queries(app.today()).some((q) => wants(kinds, q.kind))).map((c) => {
    const why = themeScore(c) > 0 ? t('A theme you like: {name}', { name: t(c.name) }) : undefined;
    return {
      id: `theme-${c.id}`, heading: t(c.name),
      load: async (round) => (await fromQueries(c.id, filter, (h) => h.startsWith('Best'), pages(round, 2), kinds)).map((i) => ({ ...i, why })),
    };
  });
}

/** Your languages: popular, then best rated, in each. */
function languageBands(filter: KindFilter, kinds: Kinds): Band[] {
  return yourLanguages().flatMap((c) => [
    { id: `lang-${c.id}`, heading: t('Popular: {name}', { name: t(c.name) }), load: (round: number) => fromQueries(c.id, filter, (h) => h.startsWith('Popular'), pages(round, 2), kinds) },
    { id: `lang-best-${c.id}`, heading: t('Best rated: {name}', { name: t(c.name) }), load: (round: number) => fromQueries(c.id, filter, (h) => h.startsWith('Best'), pages(round, 2), kinds) },
  ]);
}

/** Lists cut another way: by size, length, votes. */
function moreBands(filter: KindFilter, kinds: Kinds): Band[] {
  const band = (id: string, heading: string, movie: Params | null, tv: Params | null): Band =>
    ({ id, heading: t(heading), load: (round) => discoverBoth(kinds, round, movie, tv, filter) });
  const top = { sort_by: 'vote_average.desc' };
  return [
    band('gems', 'Hidden gems', { ...top, 'vote_average.gte': 7.3, 'vote_count.gte': 150, 'vote_count.lte': 1500 }, { ...top, 'vote_average.gte': 7.8, 'vote_count.gte': 50, 'vote_count.lte': 400 }),
    band('box-office', 'Biggest at the box office', { sort_by: 'revenue.desc' }, null),
    band('short', 'Under 90 minutes', { ...top, 'with_runtime.lte': 90, 'vote_count.gte': 1000 }, null),
    band('epics', 'Epics over two and a half hours', { ...top, 'with_runtime.gte': 150, 'vote_count.gte': 1000 }, null),
    band('acclaimed', 'Critically acclaimed series', null, { ...top, 'vote_count.gte': 2000 }),
    band('most-voted', 'Most voted of all time', { sort_by: 'vote_count.desc' }, { sort_by: 'vote_count.desc' }),
  ].filter((b) => b.id !== 'acclaimed' || kinds !== 'movie').filter((b) => !['box-office', 'short', 'epics'].includes(b.id) || kinds !== 'series');
}

/** The order bands take turns in, so two of a kind rarely meet. */
const PATTERN: Group[] = ['you', 'lang', 'theme', 'decade', 'award', 'theme', 'lang', 'award', 'more', 'theme'];

/** Every band once, the kinds taking turns. */
export function bandOrder(groups: Record<Group, Band[]>): Band[] {
  const left = Object.fromEntries(Object.entries(groups).map(([g, b]) => [g, [...b]])) as Record<Group, Band[]>;
  const out: Band[] = [];
  while (PATTERN.some((g) => left[g].length)) for (const g of PATTERN) if (left[g].length) out.push(left[g].shift()!);
  return out;
}

const GENRE_IDS: Record<string, string> = { Action: 'action', Adventure: 'adventure', Animation: 'animation', Comedy: 'comedy', Crime: 'crime', Documentary: 'documentary', Drama: 'drama', Family: 'family', Fantasy: 'fantasy', Horror: 'horror', Mystery: 'mystery', Romance: 'romance', 'Science Fiction': 'scifi', Thriller: 'thriller', War: 'war' };

/** How many rows one batch adds, and how many rounds the feed goes before it stops. */
const BATCH = 12, ROUNDS = 20;

/**
 * Home's feed below the fixed rows, without end: two category rows, then a band. Categories go popular then best
 * rated, your genres first. When the categories or the bands run out they start again, one round deeper, with new titles.
 */
export function endlessFeed(filter: KindFilter, kinds: Kinds): () => RowDef[] {
  const first = app.engine.topGenres(6).map((g) => GENRE_IDS[g]).filter(Boolean) as string[];
  const order = [...new Set([...first, ...Object.values(GENRE_IDS)])];
  const name = (id: string) => t(category(id)!.name);
  const genres = [
    ...order.map((id) => ({ id: `genre-${id}`, heading: name(id), load: (r: number) => fromQueries(id, filter, (h) => h.startsWith('Popular'), pages(r, 3), kinds) })),
    ...order.map((id) => ({ id: `best-of-${id}`, heading: t('Best rated: {name}', { name: name(id) }), load: (r: number) => fromQueries(id, filter, (h) => h.startsWith('Best'), pages(r, 3), kinds) })),
  ];
  const bands = bandOrder({ you: forYou(filter), lang: languageBands(filter, kinds), award: awardBands(filter, kinds), theme: themeBands(filter, kinds), decade: decadeBands(kinds), more: moreBands(filter, kinds) });
  let g = 0, b = 0, n = 0;
  const round = (i: number, len: number) => Math.floor(i / len);
  return () => {
    const out: RowDef[] = [];
    while (out.length < BATCH && round(b, bands.length) < ROUNDS) {
      for (let k = 0; k < 2; k++, g++) {
        const def = genres[g % genres.length]!, r = round(g, genres.length);
        out.push({ id: `${def.id}-${r}-${n++}`, heading: def.heading, load: () => def.load(r) });
      }
      const band = bands[b % bands.length]!, r = round(b++, bands.length);
      const row: RowDef = { id: `${band.id}-${r}-${n++}`, heading: band.heading, poster: true, separator: true, load: async () => {
        const items = await band.load(r);
        row.heading = band.heading; // Some bands name themselves once they know, such as Because you liked.
        return items;
      } };
      out.push(row);
    }
    return out;
  };
}
