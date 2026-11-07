// Docs: docs/03 - Features/TV Shows.md
// Purpose: tells TV programmes (talk shows, news, reality, entertainment-channel sketch shows) from series.
import type { Title } from '@/sdk/types';

/** TMDB's TV genres for programmes rather than stories. Docs: TMDB/Genres TV. */
export const SHOW_GENRES = ['Talk', 'News', 'Reality'];
/** TMDB's TV types for programmes: 1 News, 3 Reality, 5 Talk Show, 6 Video. Docs: TMDB/Discover TV (`with_type`). */
export const SHOW_TYPES = '1|3|5|6';
export const SHOW_TYPE_NAMES = ['News', 'Reality', 'Talk Show', 'Video'];
/**
 * French entertainment channels, by TMDB network ID: what airs only there is a programme even when TMDB calls it a
 * scripted comedy (the Palmashow on C8 and Direct 8). Found from the networks TMDB lists for their shows.
 */
export const SHOW_NETWORKS: Record<number, string> = { 1603: 'C8', 874: 'Direct 8', 5838: 'D8', 776: 'W9', 1133: 'TMC', 3601: 'NRJ 12', 2448: 'TFX', 2638: 'Gulli' };

/**
 * Whether a series is a TV programme: in `known` (the programmes listed by type and by channel, and any whose details
 * said so), or with a programme genre, or a TMDB series with no genre at all (game shows such as Les 12 coups de midi).
 */
export function isTvShow(t: Pick<Title, 'key' | 'kind' | 'genres'>, known: ReadonlySet<string>): boolean {
  if (t.kind !== 'series') return false;
  if (known.has(t.key)) return true;
  if (t.genres.some((g) => SHOW_GENRES.includes(g))) return true;
  return t.key.startsWith('tmdb:') && t.genres.length === 0;
}

/** From a series' details: a programme type, or every network an entertainment channel. */
export function showFromDetails(d: { type?: string; networks?: { id?: number }[] }): boolean {
  if (d.type && SHOW_TYPE_NAMES.includes(d.type)) return true;
  const nets = d.networks ?? [];
  return nets.length > 0 && nets.every((n) => n.id !== undefined && n.id in SHOW_NETWORKS);
}
