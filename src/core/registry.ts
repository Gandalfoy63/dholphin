// Docs: docs/04 - Architecture/Title Registry.md
// Purpose: every title any source has given, once: who gave it first, who gave it since. Saved as one JSON document.
import type { Title } from '@/sdk/types';
import { key as nameKey } from './dubbing';
import type { Store } from './store';

/** One title, as the registry keeps it. `first` is the source that gave it first, `secondary` every other one since. */
export interface Entry { key: string; name: string; year: number | null; kind: Title['kind']; first: string; secondary: string[]; title: Title }
/** The saved document: entries by title key. */
export interface RegistryJson { version: 1; titles: Record<string, Entry> }

const STORE_KEY = 'registry.json';
/** The same title from two sources: same kind, same name without accents or case, same year (or one unknown). */
export const identity = (t: Pick<Title, 'kind' | 'name' | 'year'>) => `${t.kind}|${nameKey(t.name)}`;

export class Registry {
  private doc: RegistryJson = { version: 1, titles: {} };
  private byName = new Map<string, Entry[]>();
  private saving: ReturnType<typeof setTimeout> | null = null;
  private loaded: Promise<void> | null = null;

  constructor(private store: Store, private saveAfterMs = 10_000) {}

  load(): Promise<void> {
    return (this.loaded ??= this.store.get<RegistryJson>(STORE_KEY).then((d) => {
      if (d?.version === 1) this.doc = d;
      for (const e of Object.values(this.doc.titles)) this.index(e);
    }).catch(() => undefined));
  }

  private index(e: Entry) {
    const k = identity(e), list = this.byName.get(k) ?? [];
    list.push(e);
    this.byName.set(k, list);
  }

  /** The entry for a title: by its key, else the same name and kind with a matching year. */
  find(t: Pick<Title, 'key' | 'kind' | 'name' | 'year'>): Entry | undefined {
    const direct = this.doc.titles[t.key];
    if (direct) return direct;
    return this.byName.get(identity(t))?.find((e) => !e.year || !t.year || Math.abs(e.year - t.year) <= 1);
  }

  /**
   * Records titles from one source and gives back, for each, the version the first source gave, so a title another
   * source also lists shows once and as it first came. A later source is added to `secondary`. A first version
   * without a TMDB ID gives way to one with it, keeping who came first.
   */
  note(titles: Title[], source: string): Title[] {
    let changed = false;
    const out = titles.map((t) => {
      const e = this.find(t);
      if (!e) {
        const n: Entry = { key: t.key, name: t.name, year: t.year ?? null, kind: t.kind, first: source, secondary: [], title: t };
        this.doc.titles[t.key] = n;
        this.index(n);
        changed = true;
        return t;
      }
      if (e.first !== source && !e.secondary.includes(source)) {
        e.secondary.push(source);
        changed = true;
      }
      if (!e.title.tmdbId && t.tmdbId) {
        delete this.doc.titles[e.key];
        Object.assign(e, { key: t.key, title: t });
        this.doc.titles[t.key] = e;
        changed = true;
      }
      // The first version, with what this answer knows better (fresher pictures and details of the same title).
      return e.key === t.key ? { ...e.title, ...t } : e.title;
    });
    if (changed) this.save();
    return out;
  }

  /** Who gave a title: the first source, then the others. */
  sources(t: Pick<Title, 'key' | 'kind' | 'name' | 'year'>): string[] {
    const e = this.find(t);
    return e ? [e.first, ...e.secondary] : [];
  }

  /** The whole document, as saved. */
  json(): RegistryJson {
    return this.doc;
  }

  private save() {
    if (this.saving) return;
    this.saving = setTimeout(() => {
      this.saving = null;
      void this.store.set(STORE_KEY, this.doc).catch(() => undefined);
    }, this.saveAfterMs);
  }

  /** Saves now, for tests and before leaving. */
  async flush() {
    if (this.saving) clearTimeout(this.saving);
    this.saving = null;
    await this.store.set(STORE_KEY, this.doc);
  }
}
