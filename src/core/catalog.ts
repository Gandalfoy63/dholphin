// Docs: docs/02 - Tech/Metadata Sources.md
// Purpose: film and series data from TMDB and OMDb, cached on the device.
import type { Episode, Profile, Title } from '../sdk/types';
import { buildCast, castQuery, commonsFile, commonsInfo, wikiRows, type CastInfo, type Person, type WikiRow } from './cast';
import { ownGrades, summarize } from './grades';
import { isTvShow, showFromDetails, SHOW_NETWORKS, SHOW_TYPES } from './tvshows';
import { articleQuery, articleTitle, doblajeMatches, DUB_LANGS, dubCredits, dubSections, key, type DubCredit } from './dubbing';
import { tmdbSeason } from './episodes';
import { anilistCast, anilistCastQuery, fill, knowledgePhoto, tvmazeCast, wikiPortraits, type Found } from './people';
import { Registry } from './registry';
import { anilistCandidates, anilistQuery, isAnime, jikanCandidates, traktCandidates, tvmazeCandidates, type Candidate } from './sources';
import { cached, type Store } from './store';
import { call } from './wasm';

const HOUR = 3_600_000, DAY = 24 * HOUR, TIMEOUT_MS = 10_000;
export interface Endpoints { tmdb: string; images: string; omdb: string; wikidata: string; commons: string; wikipedia: string; doblaje: string; anilist: string; jikan: string; tvmaze: string; trakt: string; knowledge: string; netflix: string; youtube: string; releases: string }
export const DEFAULT_ENDPOINTS: Endpoints = {
  tmdb: 'https://api.themoviedb.org/3', images: 'https://image.tmdb.org/t/p', omdb: 'https://www.omdbapi.com/', commons: 'https://commons.wikimedia.org/w/api.php',
  wikidata: 'https://query.wikidata.org/sparql', netflix: 'https://www.netflix.com',
  youtube: 'https://www.youtube.com/embed',
  // Dubbing credits: each language's Wikipedia ({lang} is the profile's), and the Doblaje Wiki for Latin American Spanish.
  wikipedia: 'https://{lang}.wikipedia.org/w/api.php', doblaje: 'https://doblaje.fandom.com/es/api.php',
  // More titles, scores and photos: anime from AniList and Jikan (MyAnimeList), shows from TVmaze, lists from Trakt, people from Google.
  anilist: 'https://graphql.anilist.co', jikan: 'https://api.jikan.moe/v4', tvmaze: 'https://api.tvmaze.com', trakt: 'https://api.trakt.tv',
  knowledge: 'https://kgsearch.googleapis.com/v1/entities:search',
  // The Android app's published versions: GitHub's latest release of the public releases repository.
  releases: 'https://api.github.com/repos/Gandalfoy63/dholphin-releases/releases/latest',
};
/** Wikimedia asks browser apps to name themselves in this header. Docs: Wikimedia Foundation/User-Agent policy. */
const API_AGENT = 'Dholphin (https://github.com/Gandalfoy63/dholphin-releases)';
const APPEND = 'credits,keywords,external_ids,videos,release_dates,content_ratings,watch/providers';
export type Params = Record<string, string | number | boolean | undefined>;
/** Lists from other sources, shown as Home rows. Trakt's need its key. */
/** One source's score for a title: `value` out of `outOf`, with how many votes when known. */
export interface Grade { source: string; value: number; outOf: number; votes?: number | null }
export type ExternalList = 'anilist-trending' | 'anilist-season' | 'mal-airing' | 'tvmaze-today' | 'trakt-trending' | 'trakt-anticipated';

/** What a profile's age limit removes from lists, which carry genres and no age rating. */
const BLOCKED: Record<string, string[]> = {
  All: ['Horror', 'Thriller', 'Crime', 'War', 'War & Politics', 'Mystery', 'Romance', 'Drama'],
  '12+': ['Horror', 'War'],
  '16+': [],
  '18+': [],
};
const MOVIE_CERT: Record<string, string> = { All: 'PG', '12+': 'PG-13', '16+': 'R' };
/** Age ratings above each limit, for titles that come with one (details do, lists don't). */
const ADULT_CERTS: Record<string, string[]> = {
  All: ['PG-13', 'R', 'NC-17', 'TV-14', 'TV-MA', '12', '16', '18'],
  '12+': ['R', 'NC-17', 'TV-MA', '16', '18'],
  '16+': ['NC-17', '18'],
};
export function allowedFor(maturity: string, t: Pick<Title, 'genres'>): boolean {
  const blocked = BLOCKED[maturity] ?? [];
  return !t.genres.some((g) => blocked.includes(g));
}

/** A person's page: who they are, their story, their photos and the titles they are known for. */
export interface PersonPage {
  id: number; name: string; photo: string | null; bio: string; bioInEnglish: boolean; born: string | null; died: string | null;
  place: string | null; job: string; photos: string[]; known: Title[];
}
/** An actor offered as a profile picture. */
export interface Actor { id: number; name: string; photo: string; known: string[] }
interface TmdbCredit { id?: number; media_type?: string; adult?: boolean; genre_ids?: number[]; character?: string; job?: string; vote_count?: number }
interface TmdbPersonFull {
  name?: string; biography?: string; birthday?: string | null; deathday?: string | null; place_of_birth?: string | null; known_for_department?: string; profile_path?: string | null;
  combined_credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] }; images?: { profiles?: { file_path?: string }[] };
}
interface TmdbPeople { id?: number; name?: string; profile_path?: string | null; adult?: boolean; known_for_department?: string; known_for?: { title?: string; name?: string }[] }

export class Catalog {
  private memory = new Map<string, Title>();
  tmdbKey = '';
  omdbKey = '';
  /** Trakt's client ID: trending lists and Trakt's score. Google's key: actor photos the others lack. Both optional. */
  traktKey = '';
  googleKey = '';
  language = 'en-US';
  region = 'US';
  maturity = '18+';
  /** Every title any source gave, once, with the source that gave it first. */
  registry: Registry;
  private fetcher: typeof fetch;
  constructor(private store: Store, public endpoints: Endpoints, fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.registry = new Registry(store);
    // A source that never answers must not hold anything up: every request gives up after 10 seconds.
    this.fetcher = (u, init) => fetcher(u, { ...init, signal: init?.signal ?? (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined) });
  }

  use(p: Profile) {
    if (p.language !== this.language) this.memory.clear(); // Names and summaries are per language.
    this.language = p.language;
    this.region = p.region;
    this.maturity = p.kids ? 'All' : p.maturity;
  }

  private async tmdb(path: string, params: Params = {}): Promise<unknown> {
    if (!this.tmdbKey) throw new Error('Add a TMDB key in Settings');
    const u = new URL(this.endpoints.tmdb + path, location.href);
    const bearer = this.tmdbKey.length > 60; // Read tokens are long and go in a header. API keys go in the URL.
    if (!bearer) u.searchParams.set('api_key', this.tmdbKey);
    u.searchParams.set('language', this.language);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    const r = await this.fetcher(u, bearer ? { headers: { Authorization: `Bearer ${this.tmdbKey}` } } : {});
    if (r.status === 401) throw new Error('TMDB refused the key. Check it in Settings');
    if (!r.ok) throw new Error(`TMDB answered ${r.status}`);
    return r.json();
  }

  /** Checks the keys during setup, without using the cache. */
  async checkTmdb(key: string): Promise<boolean> {
    const old = this.tmdbKey;
    this.tmdbKey = key;
    try {
      await this.tmdb('/genre/movie/list');
      return true;
    } catch {
      this.tmdbKey = old;
      return false;
    }
  }

  private remember(ts: Title[], source = 'TMDB'): Title[] {
    return this.registry.note(ts, source).map((t) => {
      const known = this.memory.get(t.key);
      // A list answer must not wipe what the details answer added.
      const merged = known ? { ...t, ...known, poster: t.poster ?? known.poster, backdrop: t.backdrop ?? known.backdrop } : t;
      this.memory.set(t.key, merged);
      return merged;
    });
  }

  known(key: string): Title | undefined {
    return this.memory.get(key);
  }

  /** Titles a provider or another source gave, named by `source` in the registry. */
  add(titles: Title[], source: string): Title[] {
    return this.remember(titles, source);
  }

  /**
   * A list from another source, as TMDB titles, so they open, play and dedupe like the rest. Lists are cached
   * 6 hours, each match a month. Unknown to TMDB: left out. Docs: AniList/GraphQL, Jikan/Top, TVmaze/API, Trakt/Movies.
   */
  async external(list: ExternalList): Promise<Title[]> {
    const [source, get] = this.sourceFor(list);
    const cands = await cached(this.store, `ext:${list}`, 6 * HOUR, get);
    const found: Title[] = [];
    for (let i = 0; i < cands.length; i += 4) {
      const part = await Promise.all(cands.slice(i, i + 4).map((c) => this.match(c).catch(() => null)));
      found.push(...part.filter((t): t is Title => !!t));
    }
    const seen = new Set<string>();
    return this.add(found.filter((t) => !seen.has(t.key) && !!seen.add(t.key)), source).filter((x) => (x.backdrop || x.poster) && allowedFor(this.maturity, x));
  }

  private sourceFor(list: ExternalList): [string, () => Promise<Candidate[]>] {
    const json = async (u: string, init?: RequestInit) => {
      const r = await this.fetcher(new URL(u, location.href), init);
      if (!r.ok) throw new Error(`${new URL(u, location.href).hostname} answered ${r.status}`);
      return r.json();
    };
    const anilist = (which: 'trending' | 'season') => json(this.endpoints.anilist, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(anilistQuery(which)) }).then(anilistCandidates);
    const trakt = async (path: string) => {
      if (!this.traktKey) return [];
      const h = { headers: { 'Content-Type': 'application/json', 'trakt-api-key': this.traktKey, 'trakt-api-version': '2' } };
      const [m, s] = await Promise.all([json(`${this.endpoints.trakt}/movies/${path}?limit=20`, h), json(`${this.endpoints.trakt}/shows/${path}?limit=20`, h)]);
      return [...traktCandidates(m, 'movie'), ...traktCandidates(s, 'tv')];
    };
    switch (list) {
      case 'anilist-trending': return ['AniList', () => anilist('trending')];
      case 'anilist-season': return ['AniList', () => anilist('season')];
      case 'mal-airing': return ['MyAnimeList', () => json(`${this.endpoints.jikan}/top/anime?filter=airing&sfw=true&limit=25`).then(jikanCandidates)];
      case 'tvmaze-today': return ['TVmaze', () => json(`${this.endpoints.tvmaze}/schedule/web?date=${new Date().toISOString().slice(0, 10)}`).then(tvmazeCandidates)];
      case 'trakt-trending': return ['Trakt', () => trakt('trending')];
      case 'trakt-anticipated': return ['Trakt', () => trakt('anticipated')];
    }
  }

  /** A candidate on TMDB: by TMDB ID, else IMDb or TVDB ID through `/find`, else a search by name and year. */
  private async match(c: Candidate): Promise<Title | null> {
    const kind = c.kind;
    const item = await cached(this.store, `match:${kind}:${c.tmdb ?? c.imdb ?? c.tvdb ?? `${key(c.name)}:${c.year ?? ''}`}`, 30 * DAY, async () => {
      if (c.tmdb) return { id: c.tmdb, byId: true };
      const ext = c.imdb ? ['imdb_id', c.imdb] : c.tvdb ? ['tvdb_id', String(c.tvdb)] : null;
      if (ext) {
        const f = await this.tmdb(`/find/${ext[1]}`, { external_source: ext[0] }) as Record<string, Record<string, unknown>[]>;
        const hit = f[kind === 'tv' ? 'tv_results' : 'movie_results']?.[0];
        if (hit) return hit;
      }
      const year = kind === 'tv' ? 'first_air_date_year' : 'year';
      for (const q of [...new Set([c.name, c.alt].filter((x): x is string => !!x))]) {
        const r = await this.tmdb(`/search/${kind}`, { query: q, ...(c.year ? { [year]: c.year } : {}) }) as { results?: { name?: string; title?: string; original_name?: string; original_title?: string; genre_ids?: number[] }[] };
        const res = r.results ?? [];
        // The same name, else, for anime, the first animation; never a guess on another kind of title.
        const same = res.find((x) => [x.name, x.title, x.original_name, x.original_title].some((n) => n && [key(c.name), key(c.alt ?? '')].includes(key(n))));
        const hit = same ?? (c.anime ? res.find((x) => x.genre_ids?.includes(16)) : undefined);
        if (hit) return hit;
      }
      return null;
    });
    if (!item) return null;
    if ((item as { byId?: boolean }).byId) return (await this.byIds([(item as { id: number }).id], kind))[0] ?? null;
    return call<Title[]>('normalize_list', { json: { results: [item] }, kind })[0] ?? null;
  }

  async list(path: string, params: Params = {}, kind?: 'movie' | 'tv', maxAge = 6 * HOUR): Promise<Title[]> {
    const key = `tmdb:list:${this.language}:${this.region}:${path}:${JSON.stringify(params)}`;
    const json = await cached(this.store, key, maxAge, () => this.tmdb(path, params));
    return this.remember(call<Title[]>('normalize_list', { json, kind: kind ?? null })).filter((x) => (x.backdrop || x.poster) && allowedFor(this.maturity, x));
  }

  trending = () => this.list('/trending/all/week');

  /**
   * A person's page, by TMDB ID, or by name when only the name is known (a dubbing voice). The biography in the
   * profile's language, else in English. Known for: their roles (or their crew jobs for someone behind the camera),
   * most voted first, without talk shows, news and appearances as themselves. Docs: TMDB/Person Details,
   * TMDB/Person Combined Credits, TMDB/Person Images, TMDB/Search Person.
   */
  async person(ref: { id?: number; name: string }): Promise<PersonPage | null> {
    let id = ref.id;
    if (!id) {
      const found = await cached(this.store, `tmdb:people:${this.language}:${ref.name.toLowerCase()}`, DAY, () => this.tmdb('/search/person', { query: ref.name, include_adult: 'false' }));
      id = ((found as { results?: TmdbPeople[] }).results ?? []).find((r) => key(r.name ?? '') === key(ref.name))?.id;
    }
    if (!id) return null;
    const d = await cached(this.store, `tmdb:person:${this.language}:${id}`, 7 * DAY, () => this.tmdb(`/person/${id}`, { append_to_response: 'combined_credits,images' })) as TmdbPersonFull;
    let bio = d.biography?.trim() ?? '', bioInEnglish = false;
    if (!bio && !this.language.startsWith('en')) {
      const en = await cached(this.store, `tmdb:person:en-US:${id}:bio`, 7 * DAY, () => this.tmdb(`/person/${id}`, { language: 'en-US' })).catch(() => ({})) as TmdbPersonFull;
      bio = en.biography?.trim() ?? '';
      bioInEnglish = !!bio;
    }
    const job = d.known_for_department ?? 'Acting';
    const credits = job === 'Acting' ? d.combined_credits?.cast ?? [] : d.combined_credits?.crew ?? [];
    const seen = new Set<string>();
    const picked = credits
      .filter((c) => !c.adult && !(c.genre_ids ?? []).some((g) => g === 10763 || g === 10767) && !/\b(self|himself|herself|themselves|host|narrator)\b/i.test(c.character ?? ''))
      .filter((c) => { const k = `${c.media_type}:${c.id}`; return !seen.has(k) && !!seen.add(k); })
      .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0)).slice(0, 30);
    const known = this.remember(call<Title[]>('normalize_list', { json: { results: picked }, kind: null })).filter((x) => (x.backdrop || x.poster) && allowedFor(this.maturity, x));
    return {
      id, name: d.name ?? ref.name, photo: this.image(d.profile_path, 'w500'), bio, bioInEnglish, born: d.birthday ?? null, died: d.deathday ?? null,
      place: d.place_of_birth ?? null, job, photos: (d.images?.profiles ?? []).slice(0, 12).map((i) => this.image(i.file_path, 'w300')).filter((x): x is string => !!x), known,
    };
  }

  /**
   * Actors for a profile picture: TMDB's most popular people (five pages), or those matching `query`. Only actors
   * with a photo, never adult entries. Docs: TMDB/Person Popular, TMDB/Search Person.
   */
  async actors(query = ''): Promise<Actor[]> {
    const q = query.trim();
    const pages = q ? [1] : [1, 2, 3, 4, 5];
    const lists = await Promise.all(pages.map((page) => cached(this.store, q ? `tmdb:people:${this.language}:${q.toLowerCase()}` : `tmdb:people:popular:${page}`, q ? DAY : 3 * DAY,
      () => this.tmdb(q ? '/search/person' : '/person/popular', q ? { query: q, include_adult: 'false' } : { page: String(page) })).catch(() => ({ results: [] }))));
    const seen = new Set<number>();
    return lists.flatMap((j) => ((j as { results?: TmdbPeople[] }).results ?? []))
      .filter((r) => r.id && r.name && r.profile_path && !r.adult && r.known_for_department === 'Acting' && !seen.has(r.id) && !!seen.add(r.id))
      .map((r) => ({ id: r.id!, name: r.name!, photo: r.profile_path!, known: (r.known_for ?? []).map((k) => k.title ?? k.name).filter((x): x is string => !!x).slice(0, 2) }));
  }
  // Never send `region` to discover: TMDB then answers with that country's release dates, so a 1994 film re-released
  // in 2019 reads as 2019. `watch_region` is what limits availability.
  /**
   * What streams in this region, most popular first. TMDB has no national chart: trending ignores regions, and
   * popularity is worldwide. So this is the worldwide order of what is available here.
   */
  async topInRegion(): Promise<Title[]> {
    const params = { sort_by: 'popularity.desc', with_watch_monetization_types: 'flatrate' };
    const [movies, series] = await Promise.all([this.discover('movie', params), this.discover('tv', params)]);
    return [...movies, ...series].sort((a, b) => b.popularity - a.popularity);
  }
  /** TV programmes known by their list (types and entertainment channels) or their details: see tvshows.ts. */
  readonly tvShows = new Set<string>();
  /** Whether a title is a TV programme (talk show, news, reality, entertainment-channel show) rather than a series. */
  isShow = (t: Pick<Title, 'key' | 'kind' | 'genres'>) => isTvShow(t, this.tvShows);
  /**
   * Lists the programmes TMDB marks by type (news, reality, talk show, video) and those of the entertainment
   * channels, so they can be told from series in any list. Cached with the lists. Docs: TMDB/Discover TV.
   */
  async loadTvShows() {
    const nets = Object.keys(SHOW_NETWORKS).join('|');
    const lists = await Promise.all([
      ...[1, 2, 3].map((page) => this.discover('tv', { with_type: SHOW_TYPES, sort_by: 'popularity.desc', page }).catch(() => [] as Title[])),
      ...[1, 2, 3, 4, 5].map((page) => this.discover('tv', { with_networks: nets, sort_by: 'popularity.desc', page }).catch(() => [] as Title[])),
    ]);
    for (const t of lists.flat()) this.tvShows.add(t.key);
  }
  discover = (kind: 'movie' | 'tv', params: Params) => {
    const cert = kind === 'movie' && MOVIE_CERT[this.maturity] ? { certification_country: 'US', 'certification.lte': MOVIE_CERT[this.maturity] } : {};
    return this.list(`/discover/${kind}`, { include_adult: false, watch_region: this.region, ...cert, ...params }, kind);
  };
  /**
   * TMDB IDs of the titles that won any of these awards, newest win first. TMDB has no awards, so this asks Wikidata:
   * the award statements (P166) with their year (P585), and each title's TMDB ID (P4947 films, P4983 series).
   */
  async awardWinners(awards: string[], kind: 'movie' | 'tv'): Promise<number[]> {
    const ids = awards.filter((a) => /^Q\d+$/.test(a));
    if (!ids.length) return [];
    const prop = kind === 'tv' ? 'P4983' : 'P4947';
    const query = `SELECT ?id (MAX(YEAR(?d)) AS ?y) WHERE { VALUES ?a { ${ids.map((a) => `wd:${a}`).join(' ')} } ?f p:P166 ?s. ?s ps:P166 ?a. OPTIONAL { ?s pq:P585 ?d } ?f wdt:${prop} ?id } GROUP BY ?id ORDER BY DESC(?y)`;
    const json = await this.sparql(`wikidata:awards:${kind}:${ids.join(',')}`, query, 7 * DAY);
    const rows = (json as { results?: { bindings?: { id?: { value?: string } }[] } }).results?.bindings ?? [];
    return [...new Set(rows.map((b) => Number(b.id?.value)).filter((n) => Number.isInteger(n) && n > 0))];
  }

  /** A Wikidata query, cached. Wikidata's query service sometimes answers 502 when busy: one more try. */
  private sparql(key: string, query: string, maxAge: number): Promise<unknown> {
    return cached(this.store, key, maxAge, async () => {
      const u = new URL(this.endpoints.wikidata, location.href);
      u.searchParams.set('format', 'json');
      u.searchParams.set('query', query);
      for (let attempt = 0; ; attempt++) {
        const r = await this.fetcher(u, { headers: { Accept: 'application/sparql-results+json' } });
        if (r.ok) return r.json();
        if (attempt || r.status < 500) throw new Error(`Wikidata answered ${r.status}`);
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    });
  }

  /**
   * Producers, cast and, for a title first made in another language, the dubbing voices in the profile's language.
   * Credits come from the title's cached TMDB details; Wikidata adds character names and pictures, matched by TMDB
   * person ID; Commons gives each picture's thumbnail and credit. Docs: Wikidata/Cast member property and the pages
   * next to it, MediaWiki/API Imageinfo.
   */
  async cast(t: Title): Promise<CastInfo> {
    if (!t.tmdbId) return { people: [], voices: [], credits: [], sources: [] };
    const kind = t.kind === 'series' ? 'tv' : 'movie', lang = this.language.split('-')[0]!.toLowerCase();
    const [json, rows] = await Promise.all([
      this.detailsJson(t),
      this.sparql(`wikidata:cast:${kind}:${t.tmdbId}:${lang}`, castQuery(t.tmdbId, kind, lang), 30 * DAY).then(wikiRows).catch(() => [] as WikiRow[]),
    ]);
    const d = json as { credits?: Parameters<typeof buildCast>[1]; created_by?: Parameters<typeof buildCast>[1]['created_by']; aggregate_credits?: Parameters<typeof buildCast>[1]['aggregate']; original_title?: string; original_name?: string; original_language?: string; external_ids?: { imdb_id?: string | null } };
    const dub = t.language && t.language !== lang ? await this.dubbing(t, kind, lang, d.original_title ?? d.original_name ?? t.name).catch(() => null) : null;
    const built = buildCast(t, { ...(d.credits ?? {}), created_by: d.created_by, aggregate: d.aggregate_credits }, rows, lang, (p) => this.image(p, 'w185'), dub?.credits ?? []);
    const more = await this.morePeople(t, d, built, lang, !!dub?.credits.length).catch(() => ({ photoSources: [] as string[], voiceSource: null as string | null, credits: [] as string[] }));
    // Commons pictures: a small thumbnail instead of the full file, and who to credit.
    const people = [...built.people, ...built.voices];
    const files = [...new Set(people.flatMap((p) => [p.character, p.photo]).map((u) => commonsFile(u ?? undefined)).filter((f): f is string => !!f))].slice(0, 50);
    let info = new Map<string, { thumb: string; credit: string }>();
    if (files.length) {
      info = await cached(this.store, `commons:${files.join('|')}`, 30 * DAY, async () => {
        const u = new URL(this.endpoints.commons, location.href);
        for (const [k, v] of Object.entries({ action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '240', iiextmetadatafilter: 'Artist|LicenseShortName|Attribution', titles: files.map((f) => `File:${f}`).join('|') })) u.searchParams.set(k, v);
        const r = await this.fetcher(u);
        if (!r.ok) throw new Error(`Commons answered ${r.status}`);
        return r.json();
      }).then(commonsInfo).catch(() => new Map());
    }
    const credits: string[] = [...more.credits];
    const swap = (url: string | null, who: string) => {
      const f = commonsFile(url ?? undefined);
      if (!f) return url;
      const i = info.get(f);
      // Without a thumbnail and its credit line, a Commons picture isn't shown.
      if (!i?.thumb || !i.credit) return null;
      credits.push(`${who}: ${i.credit}`);
      return i.thumb;
    };
    // A face belongs to one person: the same face for two names is a mix-up, so the second goes. A character's
    // picture may repeat: the actor and the voice dubbing them play the same character.
    const faces = new Map<string, string>();
    for (const p of people) {
      p.character = swap(p.character, p.role || p.name);
      p.photo = swap(p.photo, p.name);
      if (p.photo && faces.has(p.photo) && faces.get(p.photo) !== p.name) p.photo = null;
      if (p.photo) faces.set(p.photo, p.name);
    }
    const sources = built.voices.length && dub?.credits.length && dub.source ? [dub.source] : more.voiceSource && built.voices.length ? [more.voiceSource] : [];
    return { ...built, credits: [...new Set(credits)], sources, photoSources: more.photoSources };
  }

  /** Whether a title is anime-like: animation first made in Japanese, Chinese or Korean. */
  private anime = (t: Title, original = t.language) => isAnime(t, original);

  /** AniList's entry for an anime, by its original title and year, cached a week. Docs: AniList/GraphQL. */
  private anilistMedia(t: Title, original: string, lang: string): Promise<ReturnType<typeof anilistCast> | null> {
    return cached(this.store, `anilist:${t.key}:${lang}`, 7 * DAY, async () => {
      const r = await this.fetcher(new URL(this.endpoints.anilist, location.href), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: anilistCastQuery(lang), variables: { search: original, ...(t.year && t.kind === 'movie' ? { year: t.year } : {}) } }) });
      if (r.status === 404) return { data: { Media: null } };
      if (!r.ok) throw new Error(`AniList answered ${r.status}`);
      return r.json();
    }).then((j) => {
      const a = anilistCast(j);
      // Its search is loose: a different year means another title.
      return a.year && t.year && Math.abs(a.year - t.year) > 1 ? null : a;
    });
  }

  /** TVmaze's show, by IMDb ID, cached a week. Docs: TVmaze/API (lookup). */
  private tvmazeShow(imdb: string): Promise<{ id?: number; rating?: { average?: number | null } } | null> {
    return cached(this.store, `tvmaze:show:${imdb}`, 7 * DAY, async () => {
      const r = await this.fetcher(new URL(`${this.endpoints.tvmaze}/lookup/shows?imdb=${encodeURIComponent(imdb)}`, location.href));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`TVmaze answered ${r.status}`);
      return r.json();
    });
  }

  /**
   * Faces, character pictures and voices TMDB and Wikidata lack: AniList for anime (the original voices with their
   * characters, and the dub when Wikipedia had none), TVmaze for series, Wikipedia's portrait of an actor's article,
   * then Google's Knowledge Graph with its key. Each only fills what is missing; a picture is used once.
   */
  private async morePeople(t: Title, d: { original_title?: string; original_name?: string; original_language?: string; external_ids?: { imdb_id?: string | null } }, built: { people: Person[]; voices: Person[] }, lang: string, hadDub: boolean): Promise<{ photoSources: string[]; voiceSource: string | null; credits: string[] }> {
    const used = new Set([...built.people, ...built.voices].flatMap((p) => [p.photo, p.character]).filter((u): u is string => !!u));
    const photoSources: string[] = [], credits: string[] = [];
    let voiceSource: string | null = null;
    const took = (name: string, n: number) => { if (n && !photoSources.includes(name)) photoSources.push(name); };
    const original = d.original_title ?? d.original_name ?? t.name, imdb = d.external_ids?.imdb_id ?? t.imdbId ?? null;
    if (this.anime(t, d.original_language)) {
      const a = await this.anilistMedia(t, original, lang).catch(() => null);
      if (a) {
        took('AniList', fill(built.people, a.original, used));
        if (!hadDub && !built.voices.length && t.language !== lang && a.dub.length) {
          built.voices.push(...a.dub.slice(0, 20).map((f): Person => ({ name: f.name, kind: 'voice', role: f.role ?? '', photo: f.photo ?? null, character: f.character ?? null })));
          voiceSource = 'AniList';
        } else took('AniList', fill(built.voices, a.dub, used));
      }
    }
    if (t.kind === 'series' && imdb) {
      const show = await this.tvmazeShow(imdb).catch(() => null);
      if (show?.id) {
        const cast = await cached(this.store, `tvmaze:cast:${show.id}`, 7 * DAY, async () => {
          const r = await this.fetcher(new URL(`${this.endpoints.tvmaze}/shows/${show.id}/cast`, location.href));
          if (!r.ok) throw new Error(`TVmaze answered ${r.status}`);
          return r.json();
        }).then(tvmazeCast).catch(() => [] as Found[]);
        took('TVmaze', fill(built.people, cast, used));
      }
    }
    const missing = () => [...built.people, ...built.voices].filter((p) => !p.photo);
    if (missing().length && DUB_LANGS[lang]) {
      const names = [...new Set(missing().map((p) => p.name))].slice(0, 50);
      const pics = await cached(this.store, `wiki:portraits:${lang}:${names.join('|')}`, 30 * DAY, () =>
        this.mediawiki(this.endpoints.wikipedia.replace('{lang}', lang), { action: 'query', prop: 'pageimages|description', piprop: 'name', titles: names.join('|') })).then(wikiPortraits).catch(() => new Map<string, string>());
      took('Wikipedia', fill(missing(), [...pics].map(([k]) => names.find((n) => key(n) === k)!).filter(Boolean).map((n) => ({ name: n, photo: pics.get(key(n)) })), used));
    }
    if (this.googleKey) {
      for (const p of missing().slice(0, 8)) {
        const hit = await cached(this.store, `kg:${lang}:${key(p.name)}`, 30 * DAY, async () => {
          const u = new URL(this.endpoints.knowledge, location.href);
          for (const [k, v] of Object.entries({ query: p.name, types: 'Person', limit: '3', languages: lang, key: this.googleKey })) u.searchParams.set(k, v);
          const r = await this.fetcher(u);
          if (!r.ok) throw new Error(`Google answered ${r.status}`);
          return r.json();
        }).then((j) => knowledgePhoto(j, p.name)).catch(() => null);
        if (hit && !used.has(hit.photo)) {
          p.photo = hit.photo;
          used.add(hit.photo);
          took('Google', 1);
          if (hit.licence) credits.push(`${p.name}: ${hit.licence}`);
        }
      }
    }
    return { photoSources, voiceSource, credits };
  }

  /**
   * Every score known for a title, one per source: TMDB; IMDb, Rotten Tomatoes and Metacritic through OMDb; Trakt with
   * its key; TVmaze for series; AniList and MyAnimeList for anime. Each is fetched once a week; a source that fails is left out.
   * `now` are known at once; each of `later` comes when its source answers, or never.
   */
  async grades(t: Title): Promise<{ now: Grade[]; later: Promise<Grade | null>[] }> {
    const d = await this.detailsJson(t).catch(() => ({})) as { original_title?: string; original_name?: string; original_language?: string; external_ids?: { imdb_id?: string | null } };
    const imdb = d.external_ids?.imdb_id ?? t.imdbId ?? null, original = d.original_title ?? d.original_name ?? t.name;
    const out = ownGrades(t);
    const tasks: Promise<Grade | null>[] = [];
    if (this.traktKey && imdb) tasks.push(cached(this.store, `trakt:rating:${imdb}`, 7 * DAY, async () => {
      const r = await this.fetcher(new URL(`${this.endpoints.trakt}/${t.kind === 'series' ? 'shows' : 'movies'}/${imdb}/ratings`, location.href), { headers: { 'Content-Type': 'application/json', 'trakt-api-key': this.traktKey, 'trakt-api-version': '2' } });
      if (!r.ok) throw new Error(`Trakt answered ${r.status}`);
      return r.json();
    }).then((j: { rating?: number; votes?: number }) => (j.votes ? { source: 'Trakt', value: j.rating ?? 0, outOf: 10, votes: j.votes } : null)));
    if (t.kind === 'series' && imdb) tasks.push(this.tvmazeShow(imdb).then((sh) => (sh?.rating?.average != null ? { source: 'TVmaze', value: sh.rating.average, outOf: 10 } : null)));
    if (this.anime(t, d.original_language)) {
      tasks.push(this.anilistMedia(t, original, this.language.split('-')[0]!.toLowerCase()).then((a) => (a?.score != null ? { source: 'AniList', value: a.score, outOf: 100, votes: a.votes } : null)));
      tasks.push(cached(this.store, `jikan:${t.key}`, 7 * DAY, async () => {
        const r = await this.fetcher(new URL(`${this.endpoints.jikan}/anime?q=${encodeURIComponent(original)}&limit=5&sfw=true`, location.href));
        if (!r.ok) throw new Error(`Jikan answered ${r.status}`);
        return r.json();
      }).then((j: { data?: { title?: string; title_japanese?: string; title_english?: string; year?: number | null; aired?: { prop?: { from?: { year?: number | null } } }; score?: number | null; scored_by?: number | null }[] }) => {
        const hit = (j.data ?? []).find((a) => [a.title, a.title_japanese, a.title_english].some((n) => n && key(n) === key(original)) && (!t.year || Math.abs((a.year ?? a.aired?.prop?.from?.year ?? t.year) - t.year) <= 1));
        return hit?.score != null ? { source: 'MyAnimeList', value: hit.score, outOf: 10, votes: hit.scored_by } : null;
      }));
    }
    // What the other sources answer is kept, so the overall grade on cards includes them from then on.
    const later = tasks.map((p) => p.catch(() => null).then((g) => {
      if (g) this.extraGrades.set(t.key, [...(this.extraGrades.get(t.key) ?? []).filter((x) => x.source !== g.source), g]);
      return g;
    }));
    return { now: out, later };
  }

  /** Scores from Trakt, TVmaze, AniList and MyAnimeList, by title, once the ratings table has asked for them. */
  private extraGrades = new Map<string, Grade[]>();
  /** One grade out of 10 summing up every score known for the title. */
  overall(t: Pick<Title, 'key' | 'scores'>) {
    return summarize([...ownGrades(t), ...(this.extraGrades.get(t.key) ?? [])]);
  }
  /** Whether the title's scores from OMDb are in already: a card can then show its grade without waiting. */
  hasScores(t: Pick<Title, 'key' | 'imdbId'>) {
    const m = this.memory.get(t.key);
    return !!m && (m.scores.imdb != null || m.scores.tomato != null || !this.omdbKey || m.imdbId === null);
  }


  /**
   * Who voices whom in the profile's language: the title's Wikipedia article in that language, found through
   * Wikidata, read section by section; for Spanish, the Doblaje Wiki (Latin America) when Wikipedia has nothing.
   * Requests go one after another, as Wikimedia asks. Docs: MediaWiki/API Parsing wikitext, MediaWiki/API Etiquette.
   */
  private dubbing(t: Title, kind: 'movie' | 'tv', lang: string, original: string): Promise<{ credits: DubCredit[]; source: string | null }> {
    if (!DUB_LANGS[lang]) return Promise.resolve({ credits: [], source: null });
    return cached(this.store, `dub:${kind}:${t.tmdbId}:${lang}`, 30 * DAY, async () => {
      const article = articleTitle(await this.sparql(`wikidata:article:${kind}:${t.tmdbId}:${lang}`, articleQuery(t.tmdbId, kind, lang), 30 * DAY));
      const wiki = this.endpoints.wikipedia.replace('{lang}', lang);
      let credits = article ? await this.wikiCredits(wiki, article, lang) : [];
      if (credits.length) return { credits, source: `Wikipedia (${lang})` };
      if (lang === 'es') {
        // Its pages are named by the Latin American title: search by the Spanish title, the original, then with the year.
        const names = [...new Set([t.name, original])], tried = new Set<string>();
        for (const q of [...names, ...(t.year ? [`${original} ${t.year}`] : [])]) {
          const found = await this.mediawiki(this.endpoints.doblaje, { action: 'query', list: 'search', srsearch: q, srlimit: '3' }) as { query?: { search?: { title: string }[] } };
          for (const { title } of found.query?.search ?? []) {
            if (tried.has(title) || tried.size >= 6) continue;
            tried.add(title);
            const intro = await this.mediawiki(this.endpoints.doblaje, { action: 'parse', page: title, prop: 'wikitext', section: '0' }) as { parse?: { wikitext?: string } };
            if (!doblajeMatches(intro.parse?.wikitext ?? '', names, t.year)) continue;
            credits = await this.wikiCredits(this.endpoints.doblaje, title, lang);
            if (credits.length) return { credits, source: 'Doblaje Wiki' };
          }
        }
      }
      return { credits: [], source: null };
    });
  }

  /** One article's dubbing credits, from the sections that can hold them. A voice named twice keeps the fuller entry. */
  private async wikiCredits(api: string, page: string, lang: string): Promise<DubCredit[]> {
    const toc = await this.mediawiki(api, { action: 'parse', page, prop: 'sections' }) as { parse?: { sections?: { index: string; line: string; toclevel: number }[] } };
    const out = new Map<string, DubCredit>();
    for (const section of dubSections(toc.parse?.sections ?? [], lang)) {
      const r = await this.mediawiki(api, { action: 'parse', page, prop: 'wikitext', section }) as { parse?: { wikitext?: string } };
      for (const c of dubCredits(r.parse?.wikitext ?? '', lang)) {
        const k = key(c.voice), had = out.get(k);
        if (!had || (!had.actor && c.actor)) out.set(k, { ...had, ...c });
      }
    }
    return [...out.values()];
  }

  /** A MediaWiki API call: JSON, anonymous cross-site (`origin=*`), following redirects. Docs: MediaWiki/API CORS. */
  private async mediawiki(api: string, params: Record<string, string>): Promise<unknown> {
    const u = new URL(api, location.href);
    for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', origin: '*', redirects: '1', ...params })) u.searchParams.set(k, v);
    const r = await this.fetcher(u, { headers: { 'Api-User-Agent': API_AGENT } });
    if (!r.ok) throw new Error(`${u.hostname} answered ${r.status}`);
    return r.json();
  }

  /** A season's episodes on TMDB: name, picture, summary, length, air date. Cached a day. Docs: TMDB/TV Season. */
  async season(t: Pick<Title, 'tmdbId' | 'kind'>, n: number): Promise<Episode[]> {
    if (!t.tmdbId || t.kind !== 'series') return [];
    const json = await cached(this.store, `tmdb:season:${this.language}:${t.tmdbId}:${n}`, DAY, () => this.tmdb(`/tv/${t.tmdbId}/season/${n}`));
    const eps = tmdbSeason(json, t.tmdbId, n, (p) => this.image(p, 'w300'));
    // Many episodes have no summary, or only a placeholder name, in other languages: English fills them in.
    const untold = (e: Episode) => !e.overview || /^(Episode|Épisode|Episodio|Folge|Episodio) \d+$/i.test(e.name);
    if (this.language.startsWith('en') || !eps.some(untold)) return eps;
    const en = await cached(this.store, `tmdb:season:en-US:${t.tmdbId}:${n}`, DAY, () => this.tmdb(`/tv/${t.tmdbId}/season/${n}`, { language: 'en-US' }))
      .then((j) => new Map(tmdbSeason(j, t.tmdbId, n, (p) => this.image(p, 'w300')).map((e) => [e.number, e]))).catch(() => new Map<number, Episode>());
    return eps.map((e) => {
      const o = en.get(e.number);
      return o ? { ...e, overview: e.overview || o.overview, name: /^(Episode|Épisode|Episodio|Folge) \d+$/i.test(e.name) && o.name && !/^Episode \d+$/.test(o.name) ? o.name : e.name, still: e.still ?? o.still } : e;
    });
  }

  /** Full titles by TMDB ID, in the same order, without the ones this profile's age limit removes. */
  async byIds(ids: number[], kind: 'movie' | 'tv'): Promise<Title[]> {
    const k = kind === 'tv' ? 'series' : 'movie';
    const got = await Promise.all(ids.map((id) => this.details({ key: `tmdb:${kind}:${id}`, tmdbId: id, kind: k }).catch(() => null)));
    const over = ADULT_CERTS[this.maturity] ?? [];
    return got.filter((x): x is Title => !!x && (!!x.backdrop || !!x.poster) && allowedFor(this.maturity, x) && !over.includes(x.certification ?? ''));
  }
  recommendations = (t: Title) => this.list(`/${t.kind === 'series' ? 'tv' : 'movie'}/${t.tmdbId}/recommendations`, {}, t.kind === 'series' ? 'tv' : 'movie', DAY);
  similar = (t: Title) => this.list(`/${t.kind === 'series' ? 'tv' : 'movie'}/${t.tmdbId}/similar`, {}, t.kind === 'series' ? 'tv' : 'movie', DAY);
  search = (q: string) => this.list('/search/multi', { query: q, include_adult: false }, undefined, HOUR);

  /** The full title: genres, cast, age rating, where it streams, then scores. */
  async details(t: Pick<Title, 'key' | 'tmdbId' | 'kind'>): Promise<Title> {
    if (!t.tmdbId) return (this.memory.get(t.key) ?? t) as Title;
    const known = this.memory.get(t.key);
    if (known && known.imdbId !== undefined && known.watchProviders.length + known.people.length > 0) return known;
    const json = await this.detailsJson(t);
    const full = call<Title | null>('normalize_details', { json, kind: t.kind, region: this.region });
    if (!full) throw new Error('TMDB answered in an unknown form');
    full.scores = { ...full.scores, ...(known?.scores.imdb != null ? known.scores : {}) };
    if (t.kind === 'series' && showFromDetails(json as Parameters<typeof showFromDetails>[0])) this.tvShows.add(t.key);
    this.memory.set(t.key, full);
    return full;
  }

  /** TMDB's answer for a title, with credits and the rest appended: fetched once, kept 30 days. */
  private detailsJson(t: Pick<Title, 'key' | 'tmdbId' | 'kind'>): Promise<unknown> {
    const path = t.kind === 'series' ? 'tv' : 'movie';
    // A series also asks for every season's credits, so each actor's roles over the whole series are known.
    const series = t.kind === 'series';
    return cached(this.store, `tmdb:details:${this.language}:${this.region}:${t.key}${series ? ':agg' : ''}`, 30 * DAY, () => this.tmdb(`/${path}/${t.tmdbId}`, { append_to_response: series ? `${APPEND},aggregate_credits` : APPEND }));
  }

  /** Adds IMDb, Tomato and Metacritic scores. Without an OMDb key, TMDB's score stays. */
  async scores(t: Title): Promise<Title> {
    if (!this.omdbKey || !t.imdbId) return t;
    const json = await cached(this.store, `omdb:${t.imdbId}`, 7 * DAY, async () => {
      const u = new URL(this.endpoints.omdb, location.href);
      u.searchParams.set('apikey', this.omdbKey);
      u.searchParams.set('i', t.imdbId!);
      const r = await this.fetcher(u);
      if (!r.ok) throw new Error(`OMDb answered ${r.status}`);
      return r.json();
    });
    const s = call<Partial<Title['scores']>>('normalize_omdb', { json });
    const out = { ...t, scores: { ...t.scores, imdb: s.imdb, imdbVotes: s.imdbVotes, tomato: s.tomato, metacritic: s.metacritic } };
    this.memory.set(t.key, out);
    return out;
  }

  /** Details and scores together, for a focused card or the details view. */
  async full(t: Title): Promise<Title> {
    return this.scores(await this.details(t));
  }

  image(path: string | null | undefined, size: 'w185' | 'w300' | 'w500' | 'w780' | 'w1280' = 'w780'): string | null {
    if (!path) return null;
    if (/^(https?:|\/api|\.\/|data:)/.test(path)) return path;
    return `${this.endpoints.images}/${size}${path}`;
  }

  /** Removes old cache entries. Run on start, in the background. */
  async sweep(maxEntries = 2000): Promise<void> {
    const keys = [...(await this.store.keys('tmdb:list:'))];
    if (keys.length > maxEntries) await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => this.store.del(k)));
  }
}
