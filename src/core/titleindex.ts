// Docs: docs/03 - Features/Library.md
// Purpose: the title index: every title of every service, a few fields each, read in the background and kept on the device.
import type { Params } from './catalog';
import type { Store } from './store';
import type { LibraryEntry, Profile, Provider, Title } from '@/sdk/types';

/**
 * One title, only what the Library needs to list, filter and order it: TMDB ID, kind (0 film, 1 series, 2 other video),
 * name, year, rating x 10, votes, picture path, genre IDs, and its own key when it isn't TMDB's (a Jellyfin item).
 * No picture is stored: a card asks for its poster by path when shown.
 */
export type Rec = [id: number, kind: 0 | 1 | 2, name: string, year: number, rating: number, votes: number, poster: string, genres: number[], key?: string];
export interface IndexData { at: number; items: Rec[] }
export type IndexState = 'waiting' | 'running' | 'done' | 'error';
export interface IndexStatus { id: string; name: string; state: IndexState; count: number; at: number | null; pages: number; of: number; error?: string }

/** The setting: the index for the Library and Search, or the Library only. */
export const SEARCH_KEY = 'index:forSearch';
/** TMDB answers at most this many pages per list: a longer list is cut by release dates. Docs: TMDB/Discover Movie. */
export const MAX_PAGES = 500;
/** Pages asked at once, and the pause between groups, to stay well inside TMDB's rate limit. */
const PARALLEL = 4, PAUSE_MS = 120;
/** How long an index is used before it is read again: TMDB's lists change daily, Jellyfin's when something is added. */
export const FRESH_MS = { tmdb: 24 * 3_600_000, own: 3_600_000 };

interface TmdbRow { id: number; title?: string; name?: string; original_title?: string; original_name?: string; release_date?: string; first_air_date?: string; vote_average?: number; vote_count?: number; poster_path?: string | null; genre_ids?: number[] }

export function recFromTmdb(r: TmdbRow, kind: 'movie' | 'tv'): Rec | null {
  const name = (kind === 'movie' ? r.title ?? r.original_title : r.name ?? r.original_name) ?? '';
  if (!r.id || !name) return null;
  const date = (kind === 'movie' ? r.release_date : r.first_air_date) ?? '';
  return [r.id, kind === 'movie' ? 0 : 1, name, Number(date.slice(0, 4)) || 0, Math.round((r.vote_average ?? 0) * 10), r.vote_count ?? 0, r.poster_path ?? '', r.genre_ids ?? []];
}

export function recFromEntry(e: LibraryEntry): Rec {
  const t = e.title;
  return [t.tmdbId || 0, e.group === 'other' ? 2 : t.kind === 'series' ? 1 : 0, t.name, t.year ?? 0, Math.round((t.scores.tmdb || 0) * 10), t.scores.tmdbVotes || 0, t.poster ?? '', [], t.key];
}

/** A card's title from a record: the key TMDB's list would give, so details, My List and history find the same title. */
export function recToTitle(r: Rec, watchProviders: number[] = []): Title {
  return {
    key: r[8] ?? `tmdb:${r[1] === 1 ? 'tv' : 'movie'}:${r[0]}`, tmdbId: r[0], kind: r[1] === 1 ? 'series' : 'movie', name: r[2], year: r[3] || null,
    overview: '', genres: [], keywords: [], people: [], creators: [], language: '', poster: r[6] || null, backdrop: null, popularity: 0,
    scores: { tmdb: r[4] / 10, tmdbVotes: r[5] }, watchProviders,
  };
}

/** TMDB genre IDs of the genres a profile's maturity leaves out (`BLOCKED` in catalog.ts, by name). */
const GENRE_IDS: Record<string, number> = { Horror: 27, Thriller: 53, Crime: 80, War: 10752, 'War & Politics': 10768, Mystery: 9648, Romance: 10749, Drama: 18 };
export const blockedIds = (names: string[]) => names.map((n) => GENRE_IDS[n]).filter((x): x is number => !!x);

/** Lower case, without accents or punctuation, words split by single spaces. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

type Fetch = (kind: 'movie' | 'tv', params: Params) => Promise<{ results?: TmdbRow[]; total_pages?: number }>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads every title of a list, films then series: by date, oldest first, so pages don't shift as popularity moves.
 * A list longer than TMDB's 500 pages is cut in two by year, again and again until each part fits.
 */
export async function crawl(fetch: Fetch, base: Params, thisYear: number, progress: (done: number, of: number) => void, stop: () => boolean = () => false): Promise<Rec[]> {
  const out = new Map<string, Rec>();
  let done = 0, of = 0;
  for (const kind of ['movie', 'tv'] as const) {
    const date = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
    const windows: ([number, number] | null)[] = [null];
    while (windows.length) {
      const w = windows.shift()!;
      const q: Params = { ...base, sort_by: `${date}.asc`, ...(w ? { [`${date}.gte`]: `${w[0]}-01-01`, [`${date}.lte`]: `${w[1]}-12-31` } : {}) };
      const first = await fetch(kind, { ...q, page: 1 });
      const pages = Math.max(1, Number(first.total_pages) || 1);
      if (pages > MAX_PAGES) {
        const [a, b] = w ?? [1870, thisYear + 2];
        if (a < b) {
          const mid = (a + b) >> 1;
          windows.unshift([a, mid], [mid + 1, b]);
          continue;
        }
      }
      const take = (rows: TmdbRow[] = []) => rows.forEach((r) => {
        const rec = recFromTmdb(r, kind);
        if (rec) out.set(`${kind}:${rec[0]}`, rec);
      });
      take(first.results);
      of += Math.min(pages, MAX_PAGES);
      progress(++done, of);
      for (let p = 2; p <= Math.min(pages, MAX_PAGES); p += PARALLEL) {
        if (stop()) return [...out.values()];
        const group = Array.from({ length: Math.min(PARALLEL, Math.min(pages, MAX_PAGES) - p + 1) }, (_, i) => p + i);
        const answers = await Promise.all(group.map((page) => fetch(kind, { ...q, page })));
        answers.forEach((a) => take(a.results));
        done += group.length;
        progress(done, of);
        await sleep(PAUSE_MS);
      }
    }
  }
  return [...out.values()];
}

export interface IndexDeps {
  store: Store;
  providers: () => Provider[];
  profile: () => Profile;
  /** The catalog's region, language and maturity, which the index is kept by. */
  scope: () => { region: string; language: string; maturity: string };
  /** One raw discover page, with the profile's region and age limit added (no cache, nothing remembered). */
  discoverRaw: Fetch;
  /** Genres the profile's maturity leaves out, by name. */
  blocked: () => string[];
}

/**
 * Keeps each service's index, reads it in the background when it is old, and says how far along it is.
 * A service known through TMDB (Netflix) is read from TMDB's lists; one with its own list (Jellyfin) from that list.
 */
export class TitleIndex {
  private status = new Map<string, IndexStatus>();
  private running = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  /** Each service's records once read from the device, for Search: typing doesn't read the device each time. */
  private mem = new Map<string, Rec[]>();
  constructor(private d: IndexDeps) {}

  private key(p: Provider) {
    const s = this.d.scope();
    return `index:${p.id}:${s.region}:${s.language}:${s.maturity}`;
  }
  /** Services the index covers: those with a list or a watch provider ID, connected for this profile. */
  async services(): Promise<Provider[]> {
    const all = this.d.providers().filter((p) => p.library || p.watchProviderId);
    const on = await Promise.all(all.map(async (p) => (await p.status(this.d.profile()).catch(() => ({ connected: false }))).connected));
    return all.filter((_, i) => on[i]);
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  private set(p: Provider, s: Partial<IndexStatus>) {
    const was = this.status.get(p.id) ?? { id: p.id, name: p.name, state: 'waiting' as IndexState, count: 0, at: null, pages: 0, of: 0 };
    this.status.set(p.id, { ...was, ...s });
    this.emit();
  }
  /** Where each service's index stands, read from the device when not yet known. */
  async statuses(): Promise<IndexStatus[]> {
    const ps = await this.services();
    for (const p of ps) {
      if (this.status.has(p.id)) continue;
      const data = await this.d.store.get<IndexData>(this.key(p)).catch(() => undefined);
      this.status.set(p.id, { id: p.id, name: p.name, state: data ? 'done' : 'waiting', count: data?.items.length ?? 0, at: data?.at ?? null, pages: 0, of: 0 });
    }
    return ps.map((p) => this.status.get(p.id)!);
  }
  /** A service's records, as last read (empty before the first read ends). */
  async items(p: Provider): Promise<Rec[]> {
    const k = this.key(p);
    const hit = this.mem.get(k);
    if (hit) return hit;
    const items = (await this.d.store.get<IndexData>(k).catch(() => undefined))?.items ?? [];
    if (items.length) this.mem.set(k, items);
    return items;
  }

  /**
   * Titles of every service whose name has a word starting like each word typed (its first three letters, so a typo
   * further on still finds it; Search's own ranking then keeps only real matches). At most `limit`.
   */
  async find(query: string, limit = 60): Promise<Title[]> {
    const words = fold(query).split(' ').filter((w) => w.length >= 2).map((w) => w.slice(0, 3));
    if (!words.length) return [];
    const out: Title[] = [];
    for (const p of await this.services()) {
      for (const r of await this.items(p)) {
        const ws = fold(r[2]).split(' ');
        if (words.every((w) => ws.some((x) => x.startsWith(w)))) out.push(recToTitle(r, p.watchProviderId ? [p.watchProviderId] : []));
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
  isRunning = (id: string) => this.running.has(id);

  /**
   * Reads the services whose index is missing or old (a service just connected or turned on has none: it is read
   * now); `force` reads them all again. Drops what is kept of services no longer connected. Runs in the background.
   */
  async refresh(force = false) {
    const ps = await this.services();
    await this.prune(ps);
    await Promise.all(ps.map(async (p) => {
      const data = await this.d.store.get<IndexData>(this.key(p)).catch(() => undefined);
      const fresh = data && Date.now() - data.at < (p.library ? FRESH_MS.own : FRESH_MS.tmdb);
      if (force || !fresh) await this.read(p);
    }));
  }

  /**
   * Only the services this household has: the catalogue of one disconnected (or turned off) is deleted from the
   * device, and its count goes from Settings.
   */
  private async prune(keep: Provider[]) {
    const ids = new Set(keep.map((p) => p.id));
    for (const k of await this.d.store.keys('index:').catch(() => [] as string[])) {
      const id = k.split(':')[1]!;
      if (k === SEARCH_KEY || ids.has(id)) continue;
      await this.d.store.del(k).catch(() => undefined);
      this.mem.delete(k);
      this.status.delete(id);
    }
    for (const id of [...this.status.keys()]) if (!ids.has(id)) this.status.delete(id);
    this.emit();
  }

  /** Whether Search looks in the index too, or only the Library uses it. On by default; kept on the device. */
  async forSearch(): Promise<boolean> {
    return (await this.d.store.get<boolean>(SEARCH_KEY).catch(() => undefined)) ?? true;
  }
  async setForSearch(on: boolean) {
    await this.d.store.set(SEARCH_KEY, on);
    this.emit();
  }

  /** Reads one service now (or joins the read already running). */
  read(p: Provider): Promise<void> {
    const on = this.running.get(p.id);
    if (on) return on;
    const key = this.key(p);
    const run = (async () => {
      this.set(p, { state: 'running', pages: 0, of: 0, error: undefined });
      try {
        let items: Rec[];
        if (p.library) items = (await p.library(this.d.profile())).map(recFromEntry);
        else {
          // Without the genres a young profile can't see (lists carry no age rating). Docs: TMDB/Discover Movie.
          const blocked = blockedIds(this.d.blocked());
          const base: Params = { with_watch_providers: p.watchProviderId!, with_watch_monetization_types: 'flatrate', ...(blocked.length ? { without_genres: blocked.join('|') } : {}) };
          items = await crawl(this.d.discoverRaw, base, new Date().getFullYear(), (pages, of) => this.set(p, { pages, of }));
        }
        const at = Date.now();
        await this.d.store.set(key, { at, items } satisfies IndexData);
        this.mem.set(key, items);
        this.set(p, { state: 'done', count: items.length, at });
      } catch (e) {
        this.set(p, { state: 'error', error: (e as Error).message });
      } finally {
        this.running.delete(p.id);
        this.emit();
      }
    })();
    this.running.set(p.id, run);
    return run;
  }
}
