// Docs: docs/06 - API/Netflix Provider.md
// Purpose: Netflix: sign-in on its own page, availability from public data, playback in its own player.
import type { AppTarget, Availability, PlaySession, PlayTarget, Provider, ProviderContext, Title } from '@/sdk/types';
import type { Endpoints } from '@/core/catalog';

export const NETFLIX_TMDB_ID = 8;

/** Finds Netflix's ID for a title on Wikidata, by IMDb ID. Netflix itself is never asked. */
export async function netflixIdFromWikidata(imdbId: string, endpoint: string, fetcher: typeof fetch): Promise<string | null> {
  if (!/^tt\d+$/.test(imdbId)) return null;
  const u = new URL(endpoint, location.href);
  u.searchParams.set('format', 'json');
  u.searchParams.set('query', `SELECT ?n WHERE { ?i wdt:P345 "${imdbId}"; wdt:P1874 ?n } LIMIT 1`);
  const r = await fetcher(u, { headers: { Accept: 'application/sparql-results+json' } });
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: { bindings?: { n?: { value?: string } }[] } };
  const id = j.results?.bindings?.[0]?.n?.value;
  return id && /^\d+$/.test(id) ? id : null;
}

/**
 * Netflix's apps on Android: the TV app first, then the phone app. Undocumented by Netflix: on Android TV a link opens the
 * requested title only with `source=30`, otherwise the app shows what was last watched. See docs/06 - API/Netflix Provider.md.
 */
export const NETFLIX_APP: AppTarget = { packages: ['com.netflix.ninja', 'com.netflix.mediaclient'], extras: { source: '30' } };

/** The same addresses for the Netflix app, which reads `source=30` from the address as well as from the extra. */
export function netflixAppUrl(base: string, t: Pick<Title, 'kind' | 'name'>, id: string | null): string {
  const u = new URL(netflixUrl(base, t, id), location.href);
  u.searchParams.set('source', '30');
  return u.href;
}

/** Where Play goes: the player for a known film, the title page for a known series, otherwise Netflix's search. */
export function netflixUrl(base: string, t: Pick<Title, 'kind' | 'name'>, id: string | null): string {
  if (id) return t.kind === 'movie' ? `${base}/watch/${id}` : `${base}/title/${id}`;
  return `${base}/search?q=${encodeURIComponent(t.name)}`;
}

export function netflix(ctx: ProviderContext, endpoints: () => Endpoints): Provider {
  // A plain browser can't read netflix.com's cookie or come back from its pages. The tests' stand-in is same-origin.
  const androidTv = () => ctx.host.id === 'android';
  const reachable = () => ctx.host.id === 'cooldash' || new URL(endpoints().netflix, location.href).origin === location.origin;
  // On Android the Netflix app holds the account: Dholphin only needs to be told to use it.
  const signedIn = async () => (androidTv() ? (await ctx.get<boolean>('on')) === true : !!(await ctx.host.cookie(endpoints().netflix, 'NetflixId')));
  return {
    id: 'netflix',
    name: 'Netflix',
    logos: ['netflix.png'],
    get blurb() {
      return androidTv() ? 'Plays in the Netflix app on this TV, signed in to your account there.' : "You sign in on Netflix's own page. Films play in Netflix's own player, with its menu.";
    },
    onOff: androidTv,
    watchProviderId: NETFLIX_TMDB_ID,
    async status() {
      if (androidTv()) {
        if (!(await ctx.host.hasApp!(NETFLIX_APP.packages))) return { connected: false, detail: 'Install the Netflix app on this TV first' };
        return (await signedIn()) ? { connected: true, detail: 'On' } : { connected: false, detail: 'Off' };
      }
      if (!reachable()) return { connected: false, detail: 'Sign-in works on CoolDash OS, not in a plain browser' };
      return (await signedIn()) ? { connected: true } : { connected: false, detail: 'Not signed in' };
    },
    async connect() {
      if (androidTv()) {
        if (!(await ctx.host.hasApp!(NETFLIX_APP.packages))) throw new Error('Install the Netflix app on this TV first');
        return ctx.set('on', true);
      }
      if (!reachable()) throw new Error('Netflix sign-in works on CoolDash OS, not in a plain browser');
      await ctx.host.openExternal(`${endpoints().netflix}/login`, 'login');
    },
    async disconnect() {
      if (androidTv()) return ctx.del('on');
      await ctx.host.removeCookies(endpoints().netflix);
    },
    async availability(titles) {
      const out = new Map<string, Availability>();
      const yes = await signedIn();
      for (const t of titles) if (t.watchProviders.includes(NETFLIX_TMDB_ID)) out.set(t.key, yes ? 'playable' : 'none');
      return out;
    },
    async play({ title }: PlayTarget): Promise<PlaySession> {
      const key = `id:${title.key}`;
      let id = (await ctx.get<string>(key)) ?? null;
      if (!id && title.imdbId) {
        id = await netflixIdFromWikidata(title.imdbId, endpoints().wikidata, ctx.fetch).catch(() => null);
        if (id) await ctx.set(key, id);
      }
      if (androidTv()) return { kind: 'external', url: netflixAppUrl(endpoints().netflix, title, id), app: NETFLIX_APP };
      return { kind: 'external', url: netflixUrl(endpoints().netflix, title, id) };
    },
  };
}
