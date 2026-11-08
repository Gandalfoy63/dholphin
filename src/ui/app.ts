// Docs: docs/04 - Architecture/Overview.md
// Purpose: the app's shared state: profile, catalogue, engine, providers, and what a title's offers are.
import { createProviders } from '@providers/registry';
import { createHost } from '@hosts/index';
import { Catalog, DEFAULT_ENDPOINTS, type Endpoints } from '@/core/catalog';
import { Engine } from '@/core/engine';
import { Library } from '@/core/library';
import { idbStore, routedStore, serverStore, type Store } from '@/core/store';
import type { Availability, Host, Profile, Provider, ProviderContext, Title } from '@/sdk/types';

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
    this.config = await fetch(link ? `${link.origin}/config.json` : './config.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    if (this.config.mode === 'server' && this.config.store) {
      this.store = routedStore(device, await serverStore(this.config.store, device));
      this.server = { panel: this.config.server?.panel ?? '', origin: this.config.server?.origin ?? '', linked: !!link };
    } else if (link) {
      // Linked, but the server can't be reached: its data as last seen, kept on the device.
      this.store = routedStore(device, await serverStore(`${link.origin}/api/store`, device, async () => { throw new Error('offline'); }));
      this.server = { panel: `${link.origin}/panel`, origin: link.origin, linked: true };
    }
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...this.config.endpoints };
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
    await Promise.allSettled(this.providers.map((q) => q.refresh?.(p)));
  }

  private quickAvailability(t: Title): Availability {
    return this.offersKnown.get(t.key) ?? 'none';
  }

  /** Where a title can be played or requested, by provider. */
  async offers(t: Title): Promise<{ provider: Provider; state: Availability }[]> {
    const out: { provider: Provider; state: Availability }[] = [];
    await Promise.all(this.providers.map(async (provider) => {
      const a = await provider.availability?.([t], this.profile).catch(() => null);
      const state = a?.get(t.key);
      if (state && state !== 'none') out.push({ provider, state });
    }));
    out.sort((a, b) => Number(b.state === 'playable') - Number(a.state === 'playable'));
    const best = out[0]?.state ?? 'none';
    this.offersKnown.set(t.key, best);
    return out;
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
