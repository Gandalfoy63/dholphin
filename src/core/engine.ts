// Docs: docs/03 - Features/Recommendations.md
// Purpose: gathers candidates and asks the Rust core to rank them for a profile.
import type { Catalog } from './catalog';
import type { Library, RawSignal } from './library';
import type { Title } from '../sdk/types';
import { call } from './wasm';

export interface Taste { features: Record<string, number>; liked: Record<string, string>; disliked: string[] }
export interface Scored { key: string; score: number; reason: string }
export interface Suggestion { title: Title; reason: string }
const DAY = 86_400_000;

export function signalsForCore(signals: RawSignal[], now = Date.now()) {
  return signals.map((s) => ({ key: s.key, kind: s.kind, ageDays: (now - s.at) / DAY }));
}

export class Engine {
  taste: Taste = { features: {}, liked: {}, disliked: [] };
  private pool: Title[] = [];
  private seedNames = new Map<string, string[]>();
  private trending = new Set<string>();
  availability: (t: Title) => number = () => 0.4;
  private tasteAt = 0;
  /** Each title's affinity for the current taste, by key: a title is scored once until the taste changes. */
  private scored = new Map<string, number>();
  private scoredFor = -1;
  /** Drawn once per launch: rows and picks shift a little each time the app starts, and stay put while it runs. */
  private readonly session = Math.floor(Math.random() * 2 ** 31);
  /** A stable number in [0, 1) for a title in this launch. */
  private wobble(key: string) {
    let h = this.session;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 2654435761);
    return ((h >>> 0) % 10_000) / 10_000;
  }

  constructor(private catalog: Catalog, private library: Library) {}

  /** Rebuilds the taste from the profile's signals. */
  async refreshTaste() {
    const raw = await this.library.signals();
    const uniq = new Map<string, Title>();
    await Promise.all(
      [...new Map(raw.filter((s) => s.title).map((s) => [s.key, s.title!])).values()].slice(0, 40).map(async (t) => {
        try {
          uniq.set(t.key, await this.catalog.details(t));
        } catch {
          uniq.set(t.key, t);
        }
      }),
    );
    const titles = [...uniq.values(), ...this.pool];
    this.taste = call<Taste>('taste', { signals: signalsForCore(raw), titles });
    this.tasteAt = Date.now();
    return this.taste;
  }

  /** Candidates: what liked titles recommend, the top genres' discover pages, and trending. */
  async refreshPool() {
    await this.refreshTaste();
    const seeds = Object.entries(this.taste.liked).slice(0, 6);
    this.seedNames.clear();
    const pool = new Map<string, Title>();
    const add = (ts: Title[]) => ts.forEach((t) => pool.set(t.key, t));
    const known = (await this.library.signals()).map((s) => s.title).filter(Boolean) as Title[];
    await Promise.allSettled(
      seeds.map(async ([key, name]) => {
        const seed = this.catalog.known(key) ?? known.find((t) => t.key === key);
        if (!seed) return;
        const recs = await this.catalog.recommendations(seed);
        add(recs);
        recs.forEach((r) => this.seedNames.set(r.key, [...(this.seedNames.get(r.key) ?? []), name]));
      }),
    );
    const trending = await this.catalog.trending().catch(() => [] as Title[]);
    this.trending = new Set(trending.map((t) => t.key));
    add(trending);
    this.pool = [...pool.values()];
    await this.refreshTaste();
    return this.pool;
  }

  /** Ranks titles for this profile. */
  rank(titles: Title[], limit = 20, exclude: string[] = []): Suggestion[] {
    const byKey = new Map(titles.map((t) => [t.key, t]));
    const candidates = titles.map((title) => ({ title, seeds: this.seedNames.get(title.key) ?? [], trending: this.trending.has(title.key), available: this.availability(title) * (0.95 + this.wobble(title.key) * 0.1) }));
    return call<Scored[]>('rank', { taste: this.taste, candidates, options: { limit, lambda: 0.75, exploreEvery: 8, exclude } }).map((s) => ({ title: byKey.get(s.key)!, reason: s.reason }));
  }

  /** The taste, rebuilt when older than a minute or after `stale()` (a rating changed). */
  async ensureTaste() {
    if (Date.now() - this.tasteAt > 60_000) await this.refreshTaste();
    return this.taste;
  }
  stale() {
    this.tasteAt = 0;
  }
  /** Whether the profile has told enough to score titles for it: any rating, pick, list or watch. */
  knows = () => Object.keys(this.taste.features).length > 0;

  /**
   * How likely the profile is to like each title, 0 to 1, by key: the core's affinity (taste, reviews, a little
   * popularity), moved by the people it rated: +0.08 with an actor it loves, +0.05 likes, -0.15 said Not for me to.
   */
  async affinity(titles: Title[]): Promise<Map<string, number>> {
    await this.ensureTaste();
    // Scores depend on the title and the taste only, so rows don't send the taste and the same titles again and again.
    if (this.scoredFor !== this.tasteAt) {
      this.scored.clear();
      this.scoredFor = this.tasteAt;
    }
    const fresh = titles.filter((t) => !this.scored.has(t.key));
    if (fresh.length) for (const [k, v] of call<[string, number][]>('affinity', { taste: this.taste, titles: fresh })) this.scored.set(k, v);
    const base = new Map(titles.map((t): [string, number] => [t.key, this.scored.get(t.key) ?? 0]));
    const people = Object.values(await this.library.people());
    for (const p of people) {
      const d = p.rating === 'love' ? 0.08 : p.rating === 'like' ? 0.05 : -0.15;
      for (const k of p.keys) if (base.has(k)) base.set(k, Math.min(1, Math.max(0, base.get(k)! + d)));
    }
    return base;
  }

  /** Orders items, most likely to be liked first; equal scores keep their order. */
  async byAffinity<T extends { title: Title }>(items: T[]): Promise<T[]> {
    if (items.length < 2) return items;
    const a = await this.affinity(items.map((i) => i.title)).catch(() => null);
    if (!a) return items;
    // Up to 0.06 of variety per launch: close matches trade places, a poor match never jumps ahead of a good one.
    return items.map((it, i) => ({ it, i, s: (a.get(it.title.key) ?? 0) + this.wobble(it.title.key) * 0.06 })).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.it);
  }

  topPicks(limit = 20, exclude: string[] = []): Suggestion[] {
    return this.rank(this.pool, limit, exclude);
  }

  /** The profile's strongest genres, best first. */
  topGenres(n = 3): string[] {
    return Object.entries(this.taste.features).filter(([k, v]) => k.startsWith('g:') && v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k.slice(2));
  }

  searchOrder(query: string, titles: Title[]): Title[] {
    const byKey = new Map(titles.map((t) => [t.key, t]));
    const keys = call<string[]>('search', { query, titles, taste: this.taste });
    return keys.map((k) => byKey.get(k)!).filter(Boolean);
  }
}
