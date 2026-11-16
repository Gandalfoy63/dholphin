// Docs: docs/04 - Architecture/Overview.md
// Purpose: the app's shared state: profile, catalogue, engine, providers, and what a title's offers are.
import { createProviders } from '@providers/registry';
import { createHost } from '@hosts/index';
import { Catalog, DEFAULT_ENDPOINTS, type Endpoints } from '@/core/catalog';
import { key as nameKey } from '@/core/dubbing';
import { Engine } from '@/core/engine';
import { Library } from '@/core/library';
import { idbStore, rebaseServer, routedStore, serverStore, type Store } from '@/core/store';
import { TitleIndex } from '@/core/titleindex';
import type { Availability, Host, Profile, Provider, ProviderContext, Title } from '@/sdk/types';
import { viaApp } from './dom';

/** The film data keys. Only TMDB is needed; each other one adds a source. All are free. */
export interface Keys { tmdb?: string; omdb?: string; trakt?: string; google?: string }
/** Each key, and the page where it is made, shown during setup and in Settings. */
export const KEY_FIELDS: { key: keyof Keys; label: string; where: string; optional?: boolean }[] = [
  { key: 'tmdb', label: 'TMDB key', where: 'themoviedb.org/settings/api' },
  { key: 'omdb', label: 'OMDb key (optional)', where: 'omdbapi.com/apikey.aspx', optional: true },
  { key: 'trakt', label: 'Trakt client ID (optional)', where: 'trakt.tv/oauth/applications/new', optional: true },
  { key: 'google', label: 'Google Knowledge Graph key (optional)', where: 'console.cloud.google.com/apis/library/kgsearch.googleapis.com', optional: true },
];
/** `mode: 'server'`: served by, or linked to, a Dholphin server (see docs/04 - Architecture/Server.md). */
export interface Config { endpoints?: Partial<Endpoints>; keys?: Keys; mode?: 'server'; server?: { version: string; panel: string; origin: string }; store?: string }
/** A TV linked to a Dholphin server: its address and this device's token. Kept on the device only. */
export interface ServerLink { origin: string; token: string }
export const COLORS = ['#B4432F', '#2C6E91', '#3F8F5F', '#7A4FA3', '#A36A1F', '#37474F'];

class App {
  store: Store = idbStore();
  host: Host = createHost();
  config: Config = {};
  endpoints: Endpoints = DEFAULT_ENDPOINTS;
  catalog!: Catalog;
  providers: Provider[] = [];
  profiles: Profile[] = [];
  profile!: Profile;
  library!: Library;
  engine!: Engine;
  /** Every service's titles, kept on the device for the Library and Search only. */
  index!: TitleIndex;
  private offersKnown = new Map<string, Availability>();

  /** Set when this app uses a Dholphin server: the panel's address, and whether this device linked to it (a TV). */
  server: { panel: string; origin: string; linked: boolean } | null = null;

  async init() {
    const device = this.store;
    // A TV linked to a server: every call to it carries this device's token.
    const link = await device.get<ServerLink>('serverLink');
    if (link) {
      const real = window.fetch.bind(window);
      window.fetch = (input, init = {}) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        // The relay is reached by its secret path, and keeps the header the app set: Jellyfin's own sign-in.
        if (!url.startsWith(link.origin) || url.startsWith(`${link.origin}/api/r/`)) return real(input, init);
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${link.token}`);
        return real(input, { ...init, headers });
      };
    }
    // Where this app reached its server: the linked address, or the folder the web app was served from (a proxy may
    // put it under a path). The server's own idea of its address can be wrong behind a proxy: it is replaced by this one.
    const reached = link ? link.origin : new URL('.', location.href).href.replace(/\/$/, '');
    this.config = await fetch(`${reached}/config.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const said = this.config.server?.origin ?? '';
    if (this.config.mode === 'server') this.config = rebaseServer(this.config, said, reached);
    if (this.config.mode === 'server' && this.config.store) {
      this.store = routedStore(device, await serverStore(this.config.store, device, fetch, (v) => rebaseServer(v, said, reached)));
      this.server = { panel: this.config.server?.panel ?? '', origin: this.config.server?.origin ?? '', linked: !!link };
    } else if (link) {
      // Linked, but the server can't be reached: its data as last seen, kept on the device.
      this.store = routedStore(device, await serverStore(`${link.origin}/api/store`, device, async () => { throw new Error('offline'); }));
      this.server = { panel: `${link.origin}/panel`, origin: link.origin, linked: true };
    }
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...this.config.endpoints };
    this.endpoints.images = viaApp(this.endpoints.images);
    // Film data caches stay on the device in every mode.
    this.catalog = new Catalog(device, this.endpoints);
    await this.catalog.registry.load();
    const keys = (await this.store.get<Keys>('keys')) ?? {};
    this.catalog.tmdbKey = keys.tmdb ?? this.config.keys?.tmdb ?? '';
    this.catalog.omdbKey = keys.omdb ?? this.config.keys?.omdb ?? '';
    this.catalog.traktKey = keys.trakt ?? this.config.keys?.trakt ?? '';
    this.catalog.googleKey = keys.google ?? this.config.keys?.google ?? '';
    const ctxFor = (id: string): ProviderContext => ({
      fetch: (u, i) => fetch(u, i),
      get: (k) => this.store.get(`prov:${id}:${k}`),
      set: (k, v) => this.store.set(`prov:${id}:${k}`, v),
      del: (k) => this.store.del(`prov:${id}:${k}`),
      host: this.host,
      log: (...a) => console.info(`[${id}]`, ...a),
    });
    this.providers = createProviders(ctxFor, () => this.endpoints);
    this.index = new TitleIndex({
      store: { get: (k) => this.store.get(k), set: (k, v) => this.store.set(k, v), del: (k) => this.store.del(k), keys: (p) => this.store.keys(p) },
      providers: () => this.providers, profile: () => this.profile,
      scope: () => ({ region: this.catalog.region, language: this.catalog.language, maturity: this.catalog.maturity }),
      discoverRaw: (kind, params) => this.catalog.discoverRaw(kind, params), blocked: () => this.catalog.blockedGenres(),
    });
    this.profiles = (await this.store.get<Profile[]>('profiles')) ?? [];
  }

  async saveKeys(k: Keys) {
    const c = this.catalog;
    [c.tmdbKey, c.omdbKey, c.traktKey, c.googleKey] = [k.tmdb ?? '', k.omdb ?? '', k.trakt ?? '', k.google ?? ''];
    await this.store.set('keys', { tmdb: c.tmdbKey, omdb: c.omdbKey, trakt: c.traktKey, google: c.googleKey });
  }
  keyValues = (): Keys => ({ tmdb: this.catalog.tmdbKey, omdb: this.catalog.omdbKey, trakt: this.catalog.traktKey, google: this.catalog.googleKey });
  hasKeys = () => !!this.catalog.tmdbKey;
  async saveProfiles() {
    await this.store.set('profiles', this.profiles);
  }
  async setSetupDone() {
    await this.store.set('setupDone', true);
  }
  setupDone = async () => !!(await this.store.get('setupDone'));

  /** Makes a profile current, and refreshes what its providers have. */
  async use(p: Profile) {
    this.profile = p;
    this.catalog.use(p);
    this.library = new Library(this.store, p.id);
    this.engine = new Engine(this.catalog, this.library);
    this.library.changed = () => this.engine.stale();
    this.engine.availability = (t) => {
      const a = this.quickAvailability(t);
      return a === 'playable' ? 1 : a === 'requestable' ? 0.7 : 0.4;
    };
    await this.store.set('lastProfile', p.id);
    // TV programmes are told from series before the rows load; a slow answer doesn't hold the profile up.
    await Promise.race([this.catalog.loadTvShows().catch(() => undefined), new Promise((ok) => setTimeout(ok, 4000))]);
    // A big library read through a relay can take a while: the profile starts after 8 seconds at most, and the read
    // goes on; asking where a title plays waits for it.
    await Promise.race([Promise.allSettled(this.providers.map((q) => q.refresh?.(p))), new Promise((ok) => setTimeout(ok, 8000))]);
    // The title index, for the Library and Search: read again in the background when old, never waited for.
    setTimeout(() => void this.index.refresh().catch(() => undefined), 3000);
  }

  private quickAvailability(t: Title): Availability {
    return this.offersKnown.get(t.key) ?? 'none';
  }
  /** What is known of where a title plays, without asking: after `primeOffers` or `offers`. */
  availabilityOf = (t: Title) => this.quickAvailability(t);

  /** Where a title can be played or requested, by provider. */
  async offers(t: Title): Promise<{ provider: Provider; state: Availability }[]> {
    return (await this.offerCheck(t)).offers;
  }
  /** The offers, and the services that couldn't say (a server that didn't answer), so "not on your services" isn't claimed. */
  async offerCheck(t: Title): Promise<{ offers: { provider: Provider; state: Availability }[]; failed: Provider[] }> {
    const out: { provider: Provider; state: Availability }[] = [], failed: Provider[] = [];
    await Promise.all(this.providers.map(async (provider) => {
      const a = await provider.availability?.([t], this.profile).catch(() => {
        failed.push(provider);
        return null;
      });
      const state = a?.get(t.key);
      if (state && state !== 'none') out.push({ provider, state });
    }));
    out.sort((a, b) => Number(b.state === 'playable') - Number(a.state === 'playable'));
    const best = out[0]?.state ?? 'none';
    if (!failed.length || best === 'playable') this.offersKnown.set(t.key, best);
    return { offers: out, failed };
  }

  /**
   * Search: TMDB's titles, and each service's own (what only it has, such as a home video). One entry per title:
   * TMDB's, which knows more, when both have it. TMDB wants the words right, so when it finds little, each word is
   * also asked on its own: "low tied" finds Low Tide through "low". Those extra titles are `loose`: kept only if the
   * core finds the words typed in them, typos forgiven.
   */
  async search(q: string): Promise<{ titles: Title[]; loose: Set<string> }> {
    const [tmdb, ...own] = await Promise.all([
      this.catalog.search(q),
      ...this.providers.map((p) => p.search?.(q, this.profile).catch(() => [] as Title[]) ?? Promise.resolve([] as Title[])),
    ]);
    const byKey = new Map(tmdb.map((x) => [x.key, x]));
    // A service's entry without a TMDB ID can still be one of TMDB's: the same IMDb ID, or kind, name and year.
    const same = (a: Title, b: Title) => (!!a.imdbId && a.imdbId === b.imdbId) || (a.kind === b.kind && nameKey(a.name) === nameKey(b.name) && (!a.year || !b.year || Math.abs(a.year - b.year) <= 1));
    for (const x of own.flat()) if (!byKey.has(x.key) && !tmdb.some((y) => same(x, y))) byKey.set(x.key, x);
    const loose = new Set<string>();
    // The title index (every service's catalogue, kept on the device), when Settings has it serve Search too: what
    // TMDB's search didn't bring, kept only if the ranking finds the words in it.
    for (const x of (await this.index.forSearch()) ? await this.index.find(q).catch(() => [] as Title[]) : []) {
      if (byKey.has(x.key) || [...byKey.values()].some((y) => (!!y.tmdbId && y.tmdbId === x.tmdbId && y.kind === x.kind) || same(x, y))) continue;
      byKey.set(x.key, x);
      loose.add(x.key);
    }
    const words = [...new Set(q.trim().split(/\s+/).filter((w) => w.length >= 3))];
    if (byKey.size < 5 && (words.length > 1 || (words[0]?.length ?? 0) >= 6)) {
      // One long word: its start too, where a typo near the end is likeliest ("intersteller": "inter").
      const asks = words.length > 1 ? words : [words[0]!.slice(0, Math.ceil(words[0]!.length / 2))];
      for (const x of (await Promise.all(asks.map((w) => this.catalog.search(w).catch(() => [] as Title[])))).flat()) {
        if (byKey.has(x.key)) continue;
        byKey.set(x.key, x);
        loose.add(x.key);
      }
    }
    return { titles: [...byKey.values()], loose };
  }

  /** Marks titles for ranking, without asking about each one. */
  async primeOffers(titles: Title[]) {
    await Promise.all(this.providers.map(async (p) => {
      const a = await p.availability?.(titles, this.profile).catch(() => null);
      a?.forEach((state, key) => {
        if (this.offersKnown.get(key) !== 'playable') this.offersKnown.set(key, state);
      });
    }));
  }

  provider = (id: string) => this.providers.find((p) => p.id === id);
  async canRequest() {
    for (const p of this.providers) if (p.request && (await p.canRequest?.())) return p;
    return null;
  }
  today = () => new Date().toISOString().slice(0, 10);
}

export const app = new App();
