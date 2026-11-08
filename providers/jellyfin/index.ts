// Docs: docs/06 - API/Jellyfin and Seerr Provider.md
// Purpose: your Jellyfin server, with Seerr for asking for what it doesn't have.
import { toEntry, type SeerrRequest } from './requests';
import type { Availability, Chapter, Episode, InternalSession, PlaySession, PlayTarget, Profile, Provider, ProviderContext, Season, Segment, StreamChoice, StreamTrack, Title, Trickplay, VideoSource } from '@/sdk/types';
import { key as nameKey } from '@/core/dubbing';
import { newId } from '@/core/id';
import { Jellyfin, normalizeServer, TICKS, type Item, type MediaSource, type MediaStream } from './api';
import { codecs, deviceProfile, videoProbe } from './profile';

interface Link { token: string; userId: string; deviceId: string }
const SEGMENT: Record<string, Segment['kind']> = { Intro: 'intro', Recap: 'recap', Outro: 'credits', Preview: 'preview', Commercial: 'commercial' };
/** The quality when none is chosen, in bits per second. */
const DEFAULT_BITRATE = 40_000_000;
const SEERR_STATE: Record<number, string> = { 1: 'Requested', 2: 'Pending', 3: 'Downloading', 4: 'Partly available', 5: 'Available', 6: 'Deleted' };

/** Turns a server item into a title. With a TMDB ID it merges with the catalogue's entry. */
export function itemToTitle(item: Item & { ProviderIds?: Record<string, string> }, image: (i: Item, k: 'Primary' | 'Backdrop') => string | null): Title {
  const series = item.Type === 'Series';
  const tmdb = Number(item.ProviderIds?.Tmdb ?? 0);
  return {
    key: tmdb ? `tmdb:${series ? 'tv' : 'movie'}:${tmdb}` : `jellyfin:${item.Id}`,
    tmdbId: tmdb, imdbId: item.ProviderIds?.Imdb ?? null, kind: series ? 'series' : 'movie', name: item.Name, year: item.ProductionYear ?? null,
    release: null, overview: item.Overview ?? '', genres: item.Genres ?? [], keywords: [], people: [], creators: [], language: '',
    certification: item.OfficialRating ?? null, runtime: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS / 60) : null, seasons: null,
    poster: image(item, 'Primary'), backdrop: image(item, 'Backdrop'), trailer: null, popularity: 0,
    scores: { tmdb: item.CommunityRating ?? 0, tmdbVotes: 0 }, watchProviders: [],
  };
}

/** What the server has, by profile: by title key, by IMDb ID, and by kind and name (without accents or case). */
interface Index { byKey: Map<string, Item>; byImdb: Map<string, Item>; byName: Map<string, Item[]> }
type FullItem = Item & { ProviderIds?: Record<string, string>; OriginalTitle?: string };

export function buildIndex(items: FullItem[]): Index {
  const ix: Index = { byKey: new Map(), byImdb: new Map(), byName: new Map() };
  for (const i of items) {
    const t = itemToTitle(i, () => null);
    ix.byKey.set(t.key, i);
    ix.byKey.set(`jellyfin:${i.Id}`, i);
    if (i.ProviderIds?.Imdb) ix.byImdb.set(i.ProviderIds.Imdb, i);
    for (const n of new Set([i.Name, i.OriginalTitle].filter((x): x is string => !!x))) {
      const k = `${t.kind}|${nameKey(n)}`;
      ix.byName.set(k, [...(ix.byName.get(k) ?? []), i]);
    }
  }
  return ix;
}

/**
 * The server's item for a title: by key (TMDB ID, or the server's own ID), else IMDb ID, else the same kind and name
 * with years at most one apart. A title the catalogue knows by TMDB and the server knows without, or under another
 * TMDB entry, is still found, so what you watched there stays playable there.
 */
export function findItem(ix: Index | undefined, t: Pick<Title, 'key' | 'imdbId' | 'kind' | 'name' | 'year'>): Item | undefined {
  if (!ix) return undefined;
  const direct = ix.byKey.get(t.key) ?? (t.imdbId ? ix.byImdb.get(t.imdbId) : undefined);
  if (direct) return direct;
  const same = ix.byName.get(`${t.kind}|${nameKey(t.name)}`) ?? [];
  return same.find((i) => !t.year || !i.ProductionYear || Math.abs(i.ProductionYear - t.year) <= 1);
}

export function jellyfin(ctx: ProviderContext): Provider {
  const clients = new Map<string, Jellyfin>();
  const index = new Map<string, Index>(); // By profile.
  const find = (p: Profile, t: Pick<Title, 'key' | 'imdbId' | 'kind' | 'name' | 'year'>) => findItem(index.get(p.id), t);

  async function client(p: Profile): Promise<Jellyfin | null> {
    const hit = clients.get(p.id);
    if (hit) return hit;
    const server = await ctx.get<string>('server');
    const link = await ctx.get<Link>(`link:${p.id}`);
    if (!server || !link) return null;
    const c = new Jellyfin(server, link.deviceId, 'Dholphin', ctx.fetch);
    c.use(link.token, link.userId);
    clients.set(p.id, c);
    return c;
  }
  const imageOf = (c: Jellyfin) => (i: Item, k: 'Primary' | 'Backdrop') => c.image(i, k, { width: k === 'Backdrop' ? 1280 : 500 });

  async function seerr(path: string, init: RequestInit = {}) {
    const url = await ctx.get<string>('seerrUrl');
    const key = await ctx.get<string>('seerrKey');
    if (!url || !key) return null;
    const r = await ctx.fetch(`${url}/api/v1${path}`, { ...init, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `Seerr answered ${r.status}`);
    }
    return r.status === 204 ? {} : r.json();
  }
  /** The Seerr user behind a profile's Jellyfin account, kept once found. Docs: Seerr API/Users (GET /user/jellyfin/{id}). */
  async function seerrUser(p: Profile): Promise<number | null> {
    const link = await ctx.get<Link>(`link:${p.id}`);
    if (!link) return null;
    const known = await ctx.get<number>(`seerrUser:${link.userId}`);
    if (known) return known;
    const u = (await seerr(`/user/jellyfin/${encodeURIComponent(link.userId)}`).catch(() => null)) as { id?: number } | null;
    if (u?.id) await ctx.set(`seerrUser:${link.userId}`, u.id);
    return u?.id ?? null;
  }
  const seerrPath = (t: Title) => `/${t.kind === 'series' ? 'tv' : 'movie'}/${t.tmdbId}`;

  const toEpisode = (c: Jellyfin, e: Item, season = 0): Episode => ({
    id: e.Id, season: e.ParentIndexNumber ?? season, number: e.IndexNumber ?? 0, name: e.Name, overview: e.Overview,
    // Only the episode's own picture: without one, the server's fallback is the series poster, and TMDB's still is better.
    still: e.ImageTags?.Primary ? c.image(e, 'Primary', { width: 480 }) : null, progress: (e.UserData?.PlayedPercentage ?? 0) / 100,
  });

  /** Asks the server how to play: with the tracks chosen, or the ones the person prefers by language. */
  /** `sourceId`: the media source already playing. The server only applies the device profile's secondary audio rule
   *  when the request names it (checked against a real server). */
  async function open(c: Jellyfin, item: Item, startSec: number | undefined, choice: StreamChoice, sourceId?: string) {
    const bitrate = choice.maxBitrate ?? DEFAULT_BITRATE;
    const body = (extra: Record<string, unknown>) => ({ DeviceProfile: deviceProfile(codecs(videoProbe()), bitrate), AutoOpenLiveStream: true, StartTimeTicks: startSec ? Math.round(startSec * TICKS) : 0, MaxStreamingBitrate: bitrate, EnableTranscoding: true, ...extra });
    const explicit = choice.audioId !== undefined || choice.subtitleId !== undefined;
    let info = await c.playbackInfo(item.Id, body(explicit ? { MediaSourceId: sourceId, AudioStreamIndex: choice.audioId, SubtitleStreamIndex: choice.subtitleId } : {}));
    let media = info.MediaSources?.[0];
    if (!media) throw new Error(info.ErrorCode ?? 'The server has no way to play this');
    let picked = pickTracks(media, choice);
    // Another audio track is a new stream from the server: ask again, once, with it.
    if (!explicit && picked.audioId !== undefined && picked.audioId !== (media.DefaultAudioStreamIndex ?? picked.audioId)) {
      info = await c.playbackInfo(item.Id, body({ MediaSourceId: media.Id, AudioStreamIndex: picked.audioId, SubtitleStreamIndex: picked.subtitleId }));
      media = info.MediaSources?.[0] ?? media;
      picked = pickTracks(media, { audioId: picked.audioId, subtitleId: picked.subtitleId });
    }
    return { media, session: info.PlaySessionId, ...picked };
  }

  function trickplay(c: Jellyfin, item: Item, media: MediaSource): Trickplay | undefined {
    const byWidth = item.Trickplay?.[media.Id] ?? Object.values(item.Trickplay ?? {})[0];
    if (!byWidth) return undefined;
    const widths = Object.keys(byWidth).map(Number).sort((a, b) => a - b);
    const width = widths.find((w) => w >= 240) ?? widths[widths.length - 1]!;
    const i = byWidth[String(width)]!;
    return { width: i.Width, height: i.Height, cols: i.TileWidth, rows: i.TileHeight, intervalMs: i.Interval, count: i.ThumbnailCount, tile: (n) => c.trickplayTile(item.Id, width, n, media.Id) };
  }

  /** A playing session: the stream, its tracks, what can be skipped, and the episode after. */
  async function session(c: Jellyfin, item: Item, startSec: number | undefined, choice: StreamChoice, extras?: { segments: Segment[]; next?: Episode; episode?: Episode }, sourceId?: string): Promise<InternalSession> {
    const [o, more] = await Promise.all([open(c, item, startSec, choice, sourceId), extras ?? details(c, item)]);
    const { media } = o;
    // Only direct play is the file as it is. Direct stream is the server repackaging it (another audio track, for one),
    // so it plays from TranscodingUrl like a conversion. Docs: Jellyfin/api/mediainfo.
    const direct = !!media.SupportsDirectPlay || !media.TranscodingUrl;
    const method = direct ? 'DirectPlay' : media.SupportsDirectStream ? 'DirectStream' : 'Transcode';
    const streams = media.MediaStreams ?? [];
    const label = (s: MediaStream, n: number, kind: string) => s.DisplayTitle ?? s.Language ?? `${kind} ${n + 1}`;
    const audio: StreamTrack[] = streams.filter((s) => s.Type === 'Audio').map((s, n) => ({ id: s.Index, label: label(s, n, 'Audio'), lang: s.Language }));
    // Text the page can draw arrives as a file; pictures and styled subtitles have none and are drawn in by the server.
    const subtitles: StreamTrack[] = streams.filter((s) => s.Type === 'Subtitle').map((s, n) => ({ id: s.Index, label: label(s, n, 'Subtitles'), lang: s.Language, forced: !!s.IsForced, url: s.DeliveryMethod === 'External' && s.DeliveryUrl ? c.media(s.DeliveryUrl) : undefined }));
    const chapters: Chapter[] = (item.Chapters ?? []).map((ch, n) => ({ name: ch.Name || `Chapter ${n + 1}`, startSec: ch.StartPositionTicks / TICKS }));
    const source: VideoSource = {
      url: direct ? c.directUrl(item.Id, media, o.session) : c.media(media.TranscodingUrl!), hls: !direct, startSec,
      audio, audioId: o.audioId, subtitles, subtitleId: o.subtitleId, segments: more.segments, chapters: chapters.length > 1 ? chapters : undefined, trickplay: trickplay(c, item, media),
    };
    const base = { ItemId: item.Id, MediaSourceId: media.Id, PlaySessionId: o.session, PlayMethod: method, CanSeek: true };
    const report: InternalSession['report'] = async (ev) => {
      const b = { ...base, PositionTicks: Math.round(ev.positionSec * TICKS), IsPaused: !!ev.paused, AudioStreamIndex: ev.audioId, SubtitleStreamIndex: ev.subtitleId };
      await (ev.type === 'start' ? c.reportStart(b) : ev.type === 'stop' ? c.reportStop(b) : c.reportProgress(b));
    };
    return {
      kind: 'internal', source, report, episode: more.episode, next: more.next,
      // Stopping the old stream ends its conversion on the server, then the new one starts where it was.
      reload: async ({ startSec: at, ...ch }) => {
        await report({ type: 'stop', positionSec: at }).catch(() => undefined);
        return session(c, item, at, { audioId: ch.audioId ?? o.audioId, subtitleId: ch.subtitleId ?? o.subtitleId, maxBitrate: ch.maxBitrate ?? choice.maxBitrate }, more, media.Id);
      },
    };
  }

  /** What can be skipped, and for an episode, the one after. Older servers have no segments: nothing to skip. */
  async function details(c: Jellyfin, item: Item) {
    const segments = c.segments(item.Id).then((r) => r.Items.filter((s) => SEGMENT[s.Type]).map((s): Segment => ({ kind: SEGMENT[s.Type]!, startSec: s.StartTicks / TICKS, endSec: s.EndTicks / TICKS }))).catch(() => [] as Segment[]);
    let next: Episode | undefined, episode: Episode | undefined;
    if (item.Type === 'Episode' && item.SeriesId) {
      episode = toEpisode(c, item);
      const near = await c.adjacent(item.SeriesId, item.Id).catch(() => null);
      const list = near?.Items ?? [];
      const at = list.findIndex((e) => e.Id === item.Id);
      if (at >= 0 && list[at + 1]) next = toEpisode(c, list[at + 1]!);
    }
    return { segments: await segments, next, episode };
  }

  const provider: Provider = {
    id: 'jellyfin',
    name: 'Jellyfin',
    logos: ['jellyfin.svg', 'seerr.svg'],
    blurb: "Your own server. Ask for what it doesn't have through Seerr.",
    requestBrand: { name: 'Seerr', logo: 'seerr.svg' },
    fields: [
      // The server and Seerr are the household's; the user name and password are each profile's own.
      { key: 'server', label: 'Jellyfin address', placeholder: '192.168.1.20:8096', shared: true },
      { key: 'user', label: 'User name' },
      { key: 'password', label: 'Password', secret: true, optional: true },
      { key: 'seerrUrl', label: 'Seerr address, for every profile', placeholder: '192.168.1.20:5055', optional: true, shared: true },
      { key: 'seerrKey', label: 'Seerr API key, for every profile', secret: true, optional: true, shared: true },
    ],
    async saveShared(v) {
      if (v.server) {
        const server = normalizeServer(v.server);
        if (!server) throw new Error('Check the Jellyfin address');
        if (server !== (await ctx.get<string>('server'))) {
          await ctx.set('server', server);
          clients.clear();
        }
      }
      if (v.seerrUrl) await ctx.set('seerrUrl', normalizeServer(v.seerrUrl));
      if (v.seerrKey) await ctx.set('seerrKey', v.seerrKey);
    },
    async values() {
      return { server: (await ctx.get<string>('server')) ?? '', seerrUrl: (await ctx.get<string>('seerrUrl')) ?? '' };
    },
    async status(p) {
      const c = await client(p);
      if (!c) return { connected: false, detail: 'Not connected' };
      try {
        await c.me();
        return { connected: true };
      } catch (e) {
        return { connected: false, detail: (e as Error).message };
      }
    },
    async connect(p, v) {
      // The address may be left out once the household's server is known.
      const server = normalizeServer(v.server || ((await ctx.get<string>('server')) ?? ''));
      if (!server) throw new Error('Check the Jellyfin address');
      let base = await ctx.get<string>('device');
      if (!base) {
        base = newId();
        await ctx.set('device', base);
      }
      const deviceId = `${base}-${p.id}`;
      const c = new Jellyfin(server, deviceId, 'Dholphin', ctx.fetch);
      const r = await c.signIn(v.user ?? '', v.password ?? '').catch((e: Error & { status?: number }) => {
        throw e.status === 401 ? new Error('Wrong user name or password') : e;
      });
      await ctx.set('server', server);
      await ctx.set(`link:${p.id}`, { token: r.AccessToken, userId: r.User.Id, deviceId });
      clients.set(p.id, c);
      const seerrUrl = normalizeServer(v.seerrUrl ?? '');
      if (seerrUrl && v.seerrKey) {
        await ctx.set('seerrUrl', seerrUrl);
        await ctx.set('seerrKey', v.seerrKey);
      }
      await provider.refresh!(p);
    },
    async disconnect(p) {
      await (await client(p))?.signOut().catch(() => undefined);
      clients.delete(p.id);
      index.delete(p.id);
      await ctx.del(`link:${p.id}`);
    },
    async refresh(p) {
      const c = await client(p);
      if (!c) return;
      const r = await c.get<{ Items: FullItem[] }>('/Items', { userId: c.userId, includeItemTypes: ['Movie', 'Series'], recursive: true, fields: ['ProviderIds', 'Overview', 'Genres', 'OriginalTitle'], limit: 10000 });
      index.set(p.id, buildIndex(r.Items));
    },
    async availability(titles, p) {
      const out = new Map<string, Availability>();
      const canRequest = !!(await ctx.get('seerrUrl'));
      for (const t of titles) {
        if (find(p, t)) out.set(t.key, 'playable');
        else if (canRequest && t.tmdbId) out.set(t.key, 'requestable');
      }
      return out;
    },
    async rows(p) {
      const c = await client(p);
      if (!c) return [];
      const latest = await c.get<(Item & { ProviderIds?: Record<string, string> })[]>('/Items/Latest', { userId: c.userId, limit: 20, fields: ['ProviderIds', 'Overview', 'Genres'], includeItemTypes: ['Movie', 'Series'] });
      return [{ heading: 'Jellyfin', titles: latest.map((i) => itemToTitle(i, imageOf(c))) }];
    },
    async seasons(t, p) {
      const c = await client(p);
      const item = find(p, t);
      if (!c || !item) return [];
      return (await c.seasons(item.Id)).Items.map((s) => ({ id: s.Id, number: s.IndexNumber ?? 0, name: s.Name }));
    },
    async episodes(t, season: Season, p) {
      const c = await client(p);
      const item = find(p, t);
      if (!c || !item) return [];
      return (await c.episodes(item.Id, season.id)).Items.map((e) => toEpisode(c, e, season.number));
    },
    async play({ title, episode, startSec, choice }: PlayTarget, p): Promise<PlaySession> {
      const c = await client(p);
      if (!c) throw new Error('Connect Jellyfin in Settings');
      let id = episode?.id ?? find(p, title)?.Id;
      if (!id && title.key.startsWith('jellyfin:')) id = title.key.slice(9);
      if (!id) throw new Error('This title is not on your server');
      // The full item: chapters, preview pictures, and for an episode its series.
      let item = await c.item(id);
      if (item.Type === 'Series') {
        const next = await c.nextUp(1, item.Id);
        const first = next.Items[0] ?? (await c.episodes(item.Id)).Items[0];
        if (!first) throw new Error('This series has no episodes yet');
        startSec ??= (first.UserData?.PlaybackPositionTicks ?? 0) / TICKS || undefined;
        item = await c.item(first.Id);
      }
      return session(c, item, startSec, choice ?? {});
    },
    async resumePoints(p) {
      const c = await client(p);
      if (!c) return [];
      const r = await c.resume(16);
      return r.Items.filter((i) => i.Type === 'Movie').map((i) => ({ title: itemToTitle(i as Item & { ProviderIds?: Record<string, string> }, imageOf(c)), progress: (i.UserData?.PlayedPercentage ?? 0) / 100, startSec: (i.UserData?.PlaybackPositionTicks ?? 0) / TICKS }));
    },
    async request(t, p, options) {
      const media = t.kind === 'series' ? { mediaType: 'tv', mediaId: t.tmdbId, seasons: options?.seasons ?? 'all' } : { mediaType: 'movie', mediaId: t.tmdbId };
      // One Seerr for the household, each request in the name of whoever asks: the Seerr user of this profile's
      // Jellyfin account. Without a match, the request goes in the name of the API key's owner.
      const userId = await seerrUser(p);
      const r = (await seerr('/request', { method: 'POST', body: JSON.stringify(userId ? { ...media, userId } : media) })) as { status?: number } | null;
      if (!r) throw new Error('Connect Seerr in Settings');
      return 'Requested';
    },
    async requestState(t) {
      const r = (await seerr(seerrPath(t))) as { mediaInfo?: { status?: number } } | null;
      return r?.mediaInfo?.status ? SEERR_STATE[r.mediaInfo.status] ?? null : null;
    },
    async seasonStates(t) {
      const r = (await seerr(seerrPath(t))) as { mediaInfo?: { seasons?: { seasonNumber: number; status: number }[]; requests?: { status?: number; seasons?: { seasonNumber: number; status?: number }[] }[] } } | null;
      const out = new Map<number, string>();
      // A request names its seasons. A season's own status, where Seerr gives one, is more up to date.
      for (const q of r?.mediaInfo?.requests ?? []) for (const s of q.seasons ?? []) out.set(s.seasonNumber, 'Requested');
      for (const s of r?.mediaInfo?.seasons ?? []) if (s.status > 1) out.set(s.seasonNumber, SEERR_STATE[s.status] ?? 'Requested');
      return out;
    },
    async canRequest() {
      return !!(await ctx.get('seerrUrl'));
    },
    async requestList(p) {
      // Docs: Seerr API/Request (GET /request). With the household's key, Seerr gives everyone's requests.
      const [me, r] = await Promise.all([seerrUser(p).catch(() => null), seerr('/request?take=100&skip=0&sort=modified&filter=all') as Promise<{ results?: SeerrRequest[] } | null>]);
      if (!r) throw new Error('Connect Seerr in Settings');
      return (r.results ?? []).map((q) => toEntry(q, me)).filter((e): e is NonNullable<typeof e> => !!e);
    },
  };
  return provider;
}

/**
 * The tracks to start with. A chosen track wins; then the person's language; then the server's default.
 * A preferred subtitle language only picks text the page draws, so it never forces a converted stream.
 */
export function pickTracks(media: MediaSource, choice: StreamChoice = {}): { audioId?: number; subtitleId: number } {
  const streams = media.MediaStreams ?? [];
  const audio = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  const audioId = choice.audioId ?? (choice.audioLang ? audio.find((a) => a.Language === choice.audioLang)?.Index : undefined) ?? media.DefaultAudioStreamIndex ?? audio[0]?.Index;
  let subtitleId = choice.subtitleId;
  if (subtitleId === undefined && choice.subtitleLang === null) subtitleId = -1;
  if (subtitleId === undefined && choice.subtitleLang) {
    const text = subs.filter((s) => s.Language === choice.subtitleLang && s.DeliveryMethod === 'External' && s.DeliveryUrl);
    subtitleId = (text.find((s) => !s.IsForced) ?? text[0])?.Index;
  }
  return { audioId, subtitleId: subtitleId ?? media.DefaultSubtitleStreamIndex ?? -1 };
}
