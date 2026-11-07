// Docs: docs/06 - API/Jellyfin and Seerr Provider.md
// Purpose: the Jellyfin endpoints we use. From CoolDash's Jellyfin app.

export const CLIENT = 'Dholphin';
export const CLIENT_VERSION = '1.0.0';
/** Jellyfin counts time in ticks: 10 000 000 per second. */
export const TICKS = 10_000_000;

export interface PublicInfo { ServerName?: string; Version?: string; Id?: string; StartupWizardCompleted?: boolean }
export interface User { Id: string; Name: string; PrimaryImageTag?: string | null; ServerId?: string }
export interface UserData { PlaybackPositionTicks?: number; PlayedPercentage?: number; Played?: boolean; IsFavorite?: boolean; LastPlayedDate?: string; UnplayedItemCount?: number }
export interface MediaStream { Index: number; Type: 'Audio' | 'Video' | 'Subtitle' | string; Codec?: string; Language?: string; DisplayTitle?: string; IsDefault?: boolean; IsExternal?: boolean; IsTextSubtitleStream?: boolean; IsForced?: boolean; DeliveryUrl?: string; DeliveryMethod?: string }
export interface MediaSource { Id: string; Container?: string; SupportsDirectPlay?: boolean; SupportsDirectStream?: boolean; TranscodingUrl?: string; MediaStreams?: MediaStream[]; DefaultAudioStreamIndex?: number; DefaultSubtitleStreamIndex?: number; RunTimeTicks?: number }
export interface Item {
  Id: string;
  Name: string;
  Type: string;
  ServerId?: string;
  CollectionType?: string;
  Overview?: string;
  ProductionYear?: number;
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  SeriesPrimaryImageTag?: string;
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  PrimaryImageAspectRatio?: number;
  UserData?: UserData;
  MediaSources?: MediaSource[];
  ChildCount?: number;
  IsFolder?: boolean;
  Chapters?: { Name?: string; StartPositionTicks: number }[];
  /** By media source id, then by picture width. */
  Trickplay?: Record<string, Record<string, TrickplayInfo>>;
}
export interface TrickplayInfo { Width: number; Height: number; TileWidth: number; TileHeight: number; ThumbnailCount: number; Interval: number }
export interface MediaSegment { Type: 'Unknown' | 'Commercial' | 'Preview' | 'Recap' | 'Outro' | 'Intro'; StartTicks: number; EndTicks: number }
export interface Page<T> { Items: T[]; TotalRecordCount: number; StartIndex?: number }
export interface AuthResult { User: User; AccessToken: string; ServerId: string }
export interface QuickConnect { Secret: string; Code: string; Authenticated: boolean }
export interface PlaybackInfo { MediaSources: MediaSource[]; PlaySessionId?: string; ErrorCode?: string }

/** "192.168.1.20:8096" → "http://192.168.1.20:8096"; trailing slashes and "/web/…" (copied from a browser) dropped. */
export function normalizeServer(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    const path = u.pathname.replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** One value of the MediaBrowser header: quotes and commas can't break out (the guide: url-encode values). */
const q = (v: string) => `"${encodeURIComponent(v)}"`;

export function authHeader(o: { deviceId: string; device: string; token?: string | null }): string {
  const parts = [`Client=${q(CLIENT)}`, `Device=${q(o.device)}`, `DeviceId=${q(o.deviceId)}`, `Version=${q(CLIENT_VERSION)}`];
  if (o.token) parts.push(`Token=${q(o.token)}`);
  return `MediaBrowser ${parts.join(', ')}`;
}

/** The server allows one token per DeviceId: one id per person on this TV (the guide's advice: device + hashed name). */
export function deviceIdFor(base: string, userName: string): string {
  let h = 0x811c9dc5;
  for (const c of userName.toLowerCase()) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return `${base}-${h.toString(36)}`;
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export function query(params: Query): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export class JellyfinError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fields the lists ask for: enough for a card and the details panel. */
const CARD_FIELDS = ['PrimaryImageAspectRatio', 'Overview', 'Genres', 'ChildCount'];

export class Jellyfin {
  token: string | null = null;
  userId: string | null = null;

  constructor(
    public server: string,
    public deviceId: string,
    public device = 'Dholphin',
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await this.fetcher(this.server + path, {
        method,
        headers: { Authorization: authHeader({ deviceId: this.deviceId, device: this.device, token: this.token }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!r.ok) throw new JellyfinError(r.status, r.status === 401 ? 'Signed out: sign in again' : `The server answered ${r.status}`);
      if (r.status === 204) return undefined as T;
      const text = await r.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (e) {
      if (e instanceof JellyfinError) throw e;
      throw new JellyfinError(0, ctl.signal.aborted ? 'The server did not answer in time' : 'Cannot reach the server');
    } finally {
      clearTimeout(t);
    }
  }

  get = <T>(path: string, params: Query = {}) => this.call<T>('GET', path + query(params));
  post = <T>(path: string, body?: unknown, params: Query = {}) => this.call<T>('POST', path + query(params), body ?? {});

  // ---- server and sign-in ----
  publicInfo = () => this.get<PublicInfo>('/System/Info/Public');
  publicUsers = () => this.get<User[]>('/Users/Public');
  async signIn(name: string, password: string): Promise<AuthResult> {
    const r = await this.post<AuthResult>('/Users/AuthenticateByName', { Username: name, Pw: password });
    this.use(r.AccessToken, r.User.Id);
    return r;
  }
  quickConnectEnabled = () => this.get<boolean>('/QuickConnect/Enabled');
  quickConnectStart = () => this.post<QuickConnect>('/QuickConnect/Initiate');
  quickConnectState = (secret: string) => this.get<QuickConnect>('/QuickConnect/Connect', { secret });
  async quickConnectFinish(secret: string): Promise<AuthResult> {
    const r = await this.post<AuthResult>('/Users/AuthenticateWithQuickConnect', { Secret: secret });
    this.use(r.AccessToken, r.User.Id);
    return r;
  }
  use(token: string | null, userId: string | null) {
    this.token = token;
    this.userId = userId;
  }
  me = () => this.get<User>('/Users/Me');
  signOut = () => this.post<void>('/Sessions/Logout');

  // ---- browsing ----
  views = () => this.get<Page<Item>>('/UserViews', { userId: this.userId });
  resume = (limit = 16) => this.get<Page<Item>>('/UserItems/Resume', { userId: this.userId, limit, mediaTypes: ['Video'], fields: CARD_FIELDS, enableImageTypes: ['Primary', 'Backdrop', 'Thumb'], imageTypeLimit: 1 });
  nextUp = (limit = 16, seriesId?: string) => this.get<Page<Item>>('/Shows/NextUp', { userId: this.userId, limit, seriesId, fields: CARD_FIELDS, enableResumable: false });
  latest = (parentId?: string, limit = 16) => this.get<Item[]>('/Items/Latest', { userId: this.userId, parentId, limit, fields: CARD_FIELDS, groupItems: true });
  items = (p: { parentId?: string; types?: string[]; genre?: string; sortBy?: string[]; sortOrder?: 'Ascending' | 'Descending'; filters?: string[]; search?: string; start?: number; limit?: number }) =>
    this.get<Page<Item>>('/Items', {
      userId: this.userId,
      parentId: p.parentId,
      includeItemTypes: p.types,
      genres: p.genre ? [p.genre] : undefined,
      sortBy: p.sortBy ?? ['SortName'],
      sortOrder: p.sortOrder ?? 'Ascending',
      filters: p.filters,
      searchTerm: p.search,
      recursive: true,
      startIndex: p.start ?? 0,
      limit: p.limit ?? 60,
      fields: CARD_FIELDS,
      enableUserData: true,
      imageTypeLimit: 1,
    });
  /** Watched things, newest first: the history row and screen. */
  history = (start = 0, limit = 40) => this.items({ types: ['Movie', 'Episode'], filters: ['IsPlayed'], sortBy: ['DatePlayed'], sortOrder: 'Descending', start, limit });
  genres = (parentId?: string, types?: string[]) => this.get<Page<{ Name: string; Id: string }>>('/Genres', { userId: this.userId, parentId, includeItemTypes: types, sortBy: ['SortName'] });
  item = (id: string) => this.get<Item>(`/Items/${encodeURIComponent(id)}`, { userId: this.userId });
  seasons = (seriesId: string) => this.get<Page<Item>>(`/Shows/${encodeURIComponent(seriesId)}/Seasons`, { userId: this.userId });
  episodes = (seriesId: string, seasonId?: string) => this.get<Page<Item>>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, { userId: this.userId, seasonId, fields: ['Overview'], enableUserData: true });
  /** Episodes next to this one, in order: the one before, itself, the one after. */
  adjacent = (seriesId: string, id: string) => this.get<Page<Item>>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, { userId: this.userId, adjacentTo: id, enableUserData: true });
  setPlayed = (id: string, played: boolean) => this.call<UserData>(played ? 'POST' : 'DELETE', `/UserPlayedItems/${encodeURIComponent(id)}${query({ userId: this.userId })}`);
  setFavorite = (id: string, fav: boolean) => this.call<UserData>(fav ? 'POST' : 'DELETE', `/UserFavoriteItems/${encodeURIComponent(id)}${query({ userId: this.userId })}`);

  // ---- playback ----
  playbackInfo = (id: string, body: Record<string, unknown>) => this.post<PlaybackInfo>(`/Items/${encodeURIComponent(id)}/PlaybackInfo`, { UserId: this.userId, ...body });
  /** Intro, recap, credits: Jellyfin 10.10 and later. Docs: Jellyfin/api/mediasegment. */
  segments = (id: string) => this.get<Page<MediaSegment>>(`/MediaSegments/${encodeURIComponent(id)}`);
  reportStart = (b: Record<string, unknown>) => this.post<void>('/Sessions/Playing', b);
  reportProgress = (b: Record<string, unknown>) => this.post<void>('/Sessions/Playing/Progress', b);
  reportStop = (b: Record<string, unknown>) => this.post<void>('/Sessions/Playing/Stopped', b);

  // ---- URLs the page loads itself (images, video): no header there, so media URLs carry ApiKey (guide § ApiKey) ----
  image(item: Item, kind: 'Primary' | 'Backdrop' | 'Thumb', o: { height?: number; width?: number } = {}): string | null {
    let id = item.Id;
    let tag = kind === 'Backdrop' ? item.BackdropImageTags?.[0] : item.ImageTags?.[kind];
    if (!tag && kind === 'Backdrop' && item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) [id, tag] = [item.ParentBackdropItemId, item.ParentBackdropImageTags[0]];
    if (!tag && kind === 'Thumb' && item.ParentThumbItemId && item.ParentThumbImageTag) [id, tag] = [item.ParentThumbItemId, item.ParentThumbImageTag];
    if (!tag && kind === 'Primary' && item.SeriesId && item.SeriesPrimaryImageTag) [id, tag] = [item.SeriesId, item.SeriesPrimaryImageTag];
    if (!tag) return null;
    return `${this.server}/Items/${encodeURIComponent(id)}/Images/${kind}${query({ tag, fillHeight: o.height, fillWidth: o.width, quality: 90 })}`;
  }
  userImage = (u: User) => (u.PrimaryImageTag ? `${this.server}/UserImage${query({ userId: u.Id, tag: u.PrimaryImageTag })}` : null);
  /** A server-relative media URL (TranscodingUrl, DeliveryUrl) made absolute, with the token. */
  media(path: string): string {
    const abs = /^https?:\/\//i.test(path) ? path : this.server + (path.startsWith('/') ? path : `/${path}`);
    if (!this.token || /[?&]ApiKey=/i.test(abs)) return abs;
    return `${abs}${abs.includes('?') ? '&' : '?'}ApiKey=${encodeURIComponent(this.token)}`;
  }
  /** One tile of preview pictures. Docs: Jellyfin/api/trickplay. */
  trickplayTile = (itemId: string, width: number, index: number, mediaSourceId: string) =>
    this.media(`/Videos/${encodeURIComponent(itemId)}/Trickplay/${width}/${index}.jpg${query({ mediaSourceId })}`);
  directUrl = (itemId: string, src: MediaSource, playSessionId?: string) =>
    this.media(`/Videos/${encodeURIComponent(itemId)}/stream${query({ static: true, mediaSourceId: src.Id, container: src.Container, playSessionId, deviceId: this.deviceId })}`);
}
