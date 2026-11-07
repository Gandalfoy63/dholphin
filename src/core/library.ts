// Docs: docs/04 - Architecture/Data Model.md
// Purpose: a profile's own data: list, ratings, history, progress, requests and taste signals.
import type { Title } from '../sdk/types';
import type { Store } from './store';

/** `seen`: marked as already watched with Already seen, not played here. */
export interface HistoryEntry { key: string; at: number; progress: number; positionSec?: number; durationSec?: number; provider?: string; label?: string; hidden?: boolean; title: Title; episodeId?: string; seen?: boolean }
/** How long something watched or started stays out of the lists (Continue Watching aside). */
export const RESTING_DAYS = 15;
export interface ListEntry { key: string; at: number; title: Title }
export interface RequestRecord { key: string; at: number; title: Title; state: string; seasons?: number[] }
export type Rating = 'love' | 'like' | 'dislike';
/** A person the profile rated: their name and photo to show, and the keys of the titles they are known for. */
export interface PersonRating { id: number; name: string; photo: string | null; rating: Rating; keys: string[]; at: number }
export interface RawSignal { key: string; kind: string; at: number; title?: Title }
export const FINISHED = 0.9;

export class Library {
  constructor(private store: Store, private profileId: string) {}
  private k = (name: string) => `p:${this.profileId}:${name}`;
  private read = async <T>(name: string, fallback: T) => (await this.store.get<T>(this.k(name))) ?? fallback;
  /** Called after any change, so the taste can be rebuilt before rows are next ordered. */
  changed: () => void = () => undefined;
  private write = async (name: string, v: unknown) => {
    await this.store.set(this.k(name), v);
    this.changed();
  };

  list = () => this.read<ListEntry[]>('list', []);
  async inList(key: string) {
    return (await this.list()).some((e) => e.key === key);
  }
  /** Returns whether the title is now in the list. */
  async toggleList(t: Title): Promise<boolean> {
    const l = await this.list();
    const on = !l.some((e) => e.key === t.key);
    await this.write('list', on ? [{ key: t.key, at: Date.now(), title: t }, ...l] : l.filter((e) => e.key !== t.key));
    if (on) await this.signal(t, 'list');
    return on;
  }

  ratings = () => this.read<Record<string, Rating>>('ratings', {});
  async rate(t: Title, value: Rating | null) {
    const r = await this.ratings();
    if (value) r[t.key] = value;
    else delete r[t.key];
    await this.write('ratings', r);
    const kept = (await this.read<RawSignal[]>('signals', [])).filter((s) => !(s.key === t.key && ['love', 'like', 'dislike'].includes(s.kind)));
    await this.write('signals', kept);
    if (value) await this.signal(t, value);
  }

  /** Actors and other people the profile rated, by TMDB ID, with the titles they are known for (to leave out for a dislike). */
  people = () => this.read<Record<string, PersonRating>>('people', {});
  async ratePerson(p: Omit<PersonRating, 'rating' | 'at'>, value: Rating | null) {
    const all = await this.people();
    if (value) all[p.id] = { ...p, rating: value, at: Date.now() };
    else delete all[p.id];
    await this.write('people', all);
  }

  signals = () => this.read<RawSignal[]>('signals', []);
  async signal(t: Title, kind: string) {
    const s = await this.signals();
    s.unshift({ key: t.key, kind, at: Date.now(), title: t });
    await this.write('signals', s.slice(0, 500));
  }

  history = () => this.read<HistoryEntry[]>('history', []);
  /** Records a watch. One entry per title: a later watch replaces the earlier one. */
  async watched(t: Title, e: { progress: number; positionSec?: number; durationSec?: number; provider?: string; label?: string; episodeId?: string }) {
    const rest = (await this.history()).filter((h) => h.key !== t.key);
    await this.write('history', [{ key: t.key, at: Date.now(), title: t, ...e }, ...rest].slice(0, 500));
    if (e.progress >= FINISHED) await this.signal(t, 'finished');
    else if (e.progress >= 0.2) await this.signal(t, 'watched');
    else if (e.progress > 0) await this.signal(t, 'abandoned');
  }
  /** Already seen elsewhere: goes into History as finished, counts as finished for the taste. */
  async markSeen(t: Title) {
    const rest = (await this.history()).filter((h) => h.key !== t.key);
    await this.write('history', [{ key: t.key, at: Date.now(), title: t, progress: 1, seen: true }, ...rest].slice(0, 500));
    await this.signal(t, 'finished');
  }
  /** Takes back Already seen: out of History, and the finished signal goes. */
  async unmarkSeen(key: string) {
    await this.removeHistory(key);
    await this.write('signals', (await this.signals()).filter((s) => !(s.key === key && s.kind === 'finished')));
  }
  /** Keys watched, started or marked seen in the last `days` days: they stay out of the lists for that long. */
  async resting(days = RESTING_DAYS): Promise<Set<string>> {
    const since = Date.now() - days * 86_400_000;
    return new Set((await this.history()).filter((h) => h.at >= since).map((h) => h.key));
  }
  /** What can be resumed, newest first. */
  async continueWatching() {
    return (await this.history()).filter((h) => !h.hidden && h.progress > 0 && h.progress < FINISHED);
  }
  async hideFromContinue(key: string) {
    await this.write('history', (await this.history()).map((h) => (h.key === key ? { ...h, hidden: true } : h)));
  }
  async removeHistory(key: string) {
    await this.write('history', (await this.history()).filter((h) => h.key !== key));
  }
  /** The record as CSV, for download. */
  async historyCsv() {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return ['Title,Kind,Date,Progress', ...(await this.history()).map((h) => [q(h.title.name), h.title.kind, new Date(h.at).toISOString(), `${Math.round(h.progress * 100)}%`].join(','))].join('\n');
  }

  requests = () => this.read<RequestRecord[]>('requests', []);
  /** Asking for more seasons of a series adds to the seasons already asked for. */
  async addRequest(t: Title, state: string, seasons?: number[]) {
    const all = await this.requests();
    const old = all.find((r) => r.key === t.key)?.seasons ?? [];
    const merged = seasons ? [...new Set([...old, ...seasons])].sort((a, b) => a - b) : undefined;
    await this.write('requests', [{ key: t.key, at: Date.now(), title: t, state, seasons: merged }, ...all.filter((r) => r.key !== t.key)]);
  }
  async setRequestStates(states: Map<string, string>) {
    await this.write('requests', (await this.requests()).map((r) => ({ ...r, state: states.get(r.key) ?? r.state })));
  }

  async remove() {
    await Promise.all((await this.store.keys(`p:${this.profileId}:`)).map((k) => this.store.del(k)));
  }
}
