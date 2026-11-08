// Docs: docs/06 - API/Provider Contract.md
// Purpose: the contract that providers and hosts implement, and the shared data shapes.

export interface Scores { imdb?: number | null; imdbVotes?: number | null; tomato?: number | null; metacritic?: number | null; tmdb: number; tmdbVotes: number }

export interface Title {
  key: string; tmdbId: number; imdbId?: string | null; kind: 'movie' | 'series'; name: string; year?: number | null;
  release?: string | null; overview: string; genres: string[]; genreLabels?: string[]; keywords: string[]; people: string[]; creators: string[];
  language: string; certification?: string | null; runtime?: number | null; seasons?: number | null;
  poster?: string | null; backdrop?: string | null; trailer?: string | null; popularity: number; scores: Scores;
  watchProviders: number[];
  seasonList?: SeasonInfo[];
}
export interface SeasonInfo { number: number; name: string; episodes: number }

/** `photo` is a TMDB picture path of the actor chosen as the profile's picture, `photoOf` their name. */
export interface Profile { id: string; name: string; color: string; kids?: boolean; pin?: string; language: string; region: string; maturity: string; photo?: string; photoOf?: string }

export type Availability = 'playable' | 'requestable' | 'requested' | 'none';
export interface Offer { provider: Provider; state: Availability; label?: string }

export interface Episode { id: string; season: number; number: number; name: string; overview?: string; still?: string | null; progress?: number; runtime?: number | null; airDate?: string | null }
export interface Season { id: string; number: number; name: string }

/** An audio or subtitle track. `url`: text subtitles the page draws itself; without one, choosing it asks for a new stream. */
export interface StreamTrack { id: number; label: string; lang?: string; url?: string; forced?: boolean }
/** A part of the video the player offers to skip. `credits` leads to the next episode. */
export interface Segment { kind: 'intro' | 'recap' | 'credits' | 'preview' | 'commercial'; startSec: number; endSec: number }
export interface Chapter { name: string; startSec: number }
/** Preview pictures for seeking: tiles of `cols` x `rows` pictures, one every `intervalMs`. */
export interface Trickplay { width: number; height: number; cols: number; rows: number; intervalMs: number; count: number; tile(index: number): string }
export interface VideoSource {
  url: string; hls: boolean; startSec?: number;
  audio?: StreamTrack[]; audioId?: number;
  /** `subtitleId` -1 is off. A track without `url` that is chosen is drawn into the video by the server. */
  subtitles?: StreamTrack[]; subtitleId?: number;
  segments?: Segment[]; chapters?: Chapter[]; trickplay?: Trickplay;
}
export interface PlayReport { type: 'start' | 'progress' | 'stop'; positionSec: number; paused?: boolean; audioId?: number; subtitleId?: number }
/** What the person chose before, so a new stream starts with it. */
export interface StreamChoice { audioId?: number; subtitleId?: number; maxBitrate?: number; audioLang?: string; subtitleLang?: string | null }
export interface InternalSession {
  kind: 'internal';
  source: VideoSource;
  report(ev: PlayReport): Promise<void>;
  /** The episode that plays: a series resolves to its next one. */
  episode?: Episode;
  /** The episode after this one. */
  next?: Episode;
  /** The same video as a new stream: another audio track, subtitles drawn in, another quality. */
  reload?(choice: StreamChoice & { startSec: number }): Promise<InternalSession>;
}
/** The app's player plays `internal`. `external` hands over to the service's own player: the page is left. */
export type PlaySession = InternalSession | { kind: 'external'; url: string; app?: AppTarget };

export interface PlayTarget { title: Title; episode?: Episode; startSec?: number; choice?: StreamChoice }
/** `shared`: the same for every profile (a server's address), as opposed to each profile's own account. */
export interface ProviderField { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean; shared?: boolean }
export interface ProviderRow { heading: string; titles: Title[] }

export interface ProviderContext {
  fetch: typeof fetch;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  host: Host;
  log(...args: unknown[]): void;
}

/**
 * A service. Everything past `status` is optional: a missing method hides that feature in the interface.
 * To add one: a folder in providers/, and one line in providers/registry.ts. Nothing else changes.
 */
export interface Provider {
  id: string;
  name: string;
  /** Files in web/public/providers. */
  logos: string[];
  blurb: string;
  /** Turned on and off rather than connected: nothing to sign in to here, as Netflix on Android, where its app has the account. */
  onOff?(): boolean;
  /** Who requests go through, when that isn't the provider itself. */
  requestBrand?: { name: string; logo: string };
  /** TMDB's watch provider ID, so availability is known without asking the service. */
  watchProviderId?: number;
  /** Text fields needed to connect. Without fields, `connect` opens the service's own sign-in. */
  fields?: ProviderField[];
  values?(): Promise<Record<string, string>>;
  /** Saves the `shared` fields on their own, for every profile, without signing anyone in (the phone setup page). */
  saveShared?(values: Record<string, string>): Promise<void>;
  status(profile: Profile): Promise<{ connected: boolean; detail?: string }>;
  connect?(profile: Profile, values: Record<string, string>): Promise<void>;
  disconnect?(profile: Profile): Promise<void>;
  /** Refreshes what the service has, called on start and after connecting. */
  refresh?(profile: Profile): Promise<void>;
  availability?(titles: Title[], profile: Profile): Promise<Map<string, Availability>>;
  rows?(profile: Profile): Promise<ProviderRow[]>;
  seasons?(title: Title, profile: Profile): Promise<Season[]>;
  episodes?(title: Title, season: Season, profile: Profile): Promise<Episode[]>;
  play?(target: PlayTarget, profile: Profile): Promise<PlaySession>;
  resumePoints?(profile: Profile): Promise<{ title: Title; progress: number; label?: string; episode?: Episode; startSec?: number }[]>;
  /** `seasons` picks seasons of a series. Without it, a series is requested whole. */
  request?(title: Title, profile: Profile, options?: { seasons?: number[] }): Promise<string>;
  /** What is already requested or available, by season number. */
  seasonStates?(title: Title): Promise<Map<number, string>>;
  requestState?(title: Title): Promise<string | null>;
  canRequest?(): Promise<boolean>;
}

/** Another app on the device that can open a service's address, as the Netflix app on Android TV. */
export interface AppTarget { packages: string[]; extras?: Record<string, string> }
/** One field of the phone form. `section` puts a heading above the first field of a group; `placeholder` hints (never a stored secret). */
export interface PhoneField { key: string; label: string; secret?: boolean; section?: string; placeholder?: string }

export interface Host {
  id: 'cooldash' | 'browser' | 'android';
  /** True where opening a service leaves this page (a browser); false where the page waits behind another app (Android). */
  leavesPage: boolean;
  /** Leaves the page for a service's own site, or on Android hands the address to the service's own app (`app`). */
  openExternal(url: string, intent: 'login' | 'play', meta?: unknown, app?: AppTarget): Promise<void>;
  /** Android: whether one of these apps is installed. */
  hasApp?(packages: string[]): Promise<boolean>;
  /** Typing on a phone: the TV serves a one-time form on the home network, shown as a QR code. */
  phoneForm?: {
    start(title: string, fields: PhoneField[], onValues: (v: Record<string, string>) => void): Promise<{ url: string; qr: string }>;
    stop(): void;
  };
  /** A QR code image (data address) of a short text, where the device can draw one. */
  qr?(text: string): Promise<string | null>;
  /** The device's own private IPv4 addresses, to look for a Dholphin server on the same networks. */
  localAddresses?(): Promise<string[]>;
  /** Updates of the app itself, where the device installs them. */
  updater?: { version: string; build: number; install(url: string, onProgress: (pct: number) => void): Promise<'started' | 'needs_permission' | 'failed'> };
  cookie(url: string, name: string): Promise<string | null>;
  removeCookies(url: string): Promise<void>;
  /** What a service's player reported since the page was left. */
  takeExternalReport(): Promise<ExternalReport | null>;
  close(): void;
}
export interface ExternalReport { meta?: unknown; positionSec?: number; durationSec?: number }
