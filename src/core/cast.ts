// Docs: docs/03 - Features/Cast.md
// Purpose: who made and plays a title: TMDB's credits, with Wikidata's character names and pictures, and dubbing voices from Wikidata and Wikipedia.
import type { Title } from '@/sdk/types';
import { key, type DubCredit } from './dubbing';

export interface Person {
  name: string;
  /** TMDB's person ID, when TMDB lists them (not dubbing voices read from Wikipedia). */
  id?: number;
  /** `producer`, `creator`: shown first. `cast`: on screen or the original voice. `voice`: a dubbing voice. */
  kind: 'producer' | 'creator' | 'cast' | 'voice';
  /** The character, in the profile's language when Wikidata has it. Empty for producers. */
  role: string;
  photo: string | null;
  /** A picture of the character, when one exists: animation, make-up, costumes. */
  character: string | null;
}
/** `credits`: who to credit for each Commons picture. `sources`: where the dubbing voices come from. `photoSources`: where faces TMDB lacked came from. */
export interface CastInfo { people: Person[]; voices: Person[]; credits: string[]; sources: string[]; photoSources?: string[] }

/** Wikidata items for the interface languages, for dubbing statements' language (P407). */
export const LANGUAGE_ITEM: Record<string, string> = { fr: 'Q150', en: 'Q1860', es: 'Q1321', de: 'Q188', it: 'Q652' };

interface TmdbPerson { id?: number; name?: string; character?: string; job?: string; profile_path?: string | null; order?: number }
interface Credits { cast?: TmdbPerson[]; crew?: TmdbPerson[] }
/** A series' credits over all its seasons: each person once, with every role and how many episodes each. Docs: TMDB/TV Aggregate Credits. */
interface Aggregate { cast?: (TmdbPerson & { roles?: { character?: string; episode_count?: number }[]; total_episode_count?: number })[] }

/**
 * A person's roles as one line, "Role 1 / Role 2 / Role 3": in the order given (the main role first), each once
 * (case and accents aside), without the "(voice)" marks, and splitting a TMDB role already written "A / B".
 */
export function joinRoles(roles: (string | null | undefined)[]): string {
  const seen = new Set<string>(), out: string[] = [];
  for (const r of roles.flatMap((x) => plainRole(x ?? '').split(/\s+\/\s+/))) {
    const k = key(r);
    if (r && k && !seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out.join(' / ');
}
export interface WikiRow { st?: string; prop: 'cast' | 'voice'; actor: string; tmdb?: number; actorImg?: string; char?: string; charImg?: string; lang?: string }

/** "Woody (voice)" → "Woody". */
const plainRole = (c = '') => c.replace(/\s*\((?:voice|uncredited|voix)\)\s*$/i, '').trim();

/** The SPARQL query: each cast (P161) and voice (P725) statement, its character (P453), language (P407), pictures (P18). */
export function castQuery(tmdbId: number, kind: 'movie' | 'tv', lang: string): string {
  const prop = kind === 'tv' ? 'P4983' : 'P4947';
  const labels = [...new Set([lang, 'en'])].join(',');
  return `SELECT ?st ?prop ?actorLabel ?tmdb ?actorImg ?charLabel ?charImg ?lang WHERE { ?f wdt:${prop} "${tmdbId}". { ?f p:P161 ?st. ?st ps:P161 ?actor. BIND("cast" AS ?prop) } UNION { ?f p:P725 ?st. ?st ps:P725 ?actor. BIND("voice" AS ?prop) } OPTIONAL { ?st pq:P453 ?char. OPTIONAL { ?char wdt:P18 ?charImg } } OPTIONAL { ?st pq:P407 ?lang } OPTIONAL { ?actor wdt:P4985 ?tmdb } OPTIONAL { ?actor wdt:P18 ?actorImg } SERVICE wikibase:label { bd:serviceParam wikibase:language "${labels}". } } LIMIT 500`;
}

/** SPARQL JSON → rows, one per statement. A label the service could not find comes back as the item's Q-id: dropped. */
export function wikiRows(json: unknown): WikiRow[] {
  const b = (json as { results?: { bindings?: Record<string, { value?: string }>[] } }).results?.bindings ?? [];
  const seen = new Map<string, WikiRow>();
  const label = (v?: string) => (v && !/^Q\d+$/.test(v) ? v : undefined);
  for (const x of b) {
    const key = x.st?.value ?? `${x.actorLabel?.value}|${x.charLabel?.value}|${x.lang?.value}`;
    if (seen.has(key)) continue;
    const actor = label(x.actorLabel?.value);
    if (!actor) continue;
    seen.set(key, {
      prop: x.prop?.value === 'voice' ? 'voice' : 'cast', actor, tmdb: x.tmdb?.value ? Number(x.tmdb.value) : undefined,
      actorImg: x.actorImg?.value, char: label(x.charLabel?.value), charImg: x.charImg?.value, lang: x.lang?.value?.split('/').pop(),
    });
  }
  return [...seen.values()];
}

/** A Commons address (…/Special:FilePath/Name.jpg) → its file name. */
export const commonsFile = (url?: string) => (url ? decodeURIComponent(url.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ') || null : null);

/**
 * Producers first (a series' creators, then its executive producers), then the cast in billing order.
 * Each cast member gets the character's name in the profile's language and its picture when Wikidata has them,
 * matched by TMDB person ID. Dubbing voices only come for a title first made in another language: from `dubs` (read
 * from Wikipedia, see dubbing.ts) when there are any, else from Wikidata. A dubbing credit is matched to the cast by
 * the original actor's name, else by the character's, so it takes the cast's place in the billing and its picture.
 */
export function buildCast(t: Pick<Title, 'kind' | 'language'>, credits: Credits & { created_by?: TmdbPerson[]; aggregate?: Aggregate }, rows: WikiRow[], lang: string, img: (p: string | null | undefined) => string | null, dubs: DubCredit[] = []): Omit<CastInfo, 'credits' | 'sources'> {
  const original = rows.filter((r) => !r.lang || r.lang !== LANGUAGE_ITEM[lang] || t.language === lang);
  const byPerson = new Map<number, WikiRow>(), charsOf = new Map<number, string[]>();
  for (const r of original) {
    if (!r.tmdb) continue;
    if (!byPerson.has(r.tmdb)) byPerson.set(r.tmdb, r);
    if (r.char) charsOf.set(r.tmdb, [...(charsOf.get(r.tmdb) ?? []), r.char]);
  }
  const crew = credits.crew ?? [];
  const makers: Person[] = t.kind === 'series'
    ? [...(credits.created_by ?? []).map((p) => ({ p, kind: 'creator' as const })), ...crew.filter((c) => c.job === 'Executive Producer').map((p) => ({ p, kind: 'producer' as const }))]
      .slice(0, 3).map(({ p, kind }) => ({ name: p.name ?? '', id: p.id, kind, role: '', photo: img(p.profile_path), character: null }))
    : crew.filter((c) => c.job === 'Producer').slice(0, 3).map((p) => ({ name: p.name ?? '', id: p.id, kind: 'producer', role: '', photo: img(p.profile_path), character: null }));
  const seen = new Set<string>();
  const unique = (list: Person[]) => list.filter((p) => p.name && !seen.has(`${p.kind}:${p.name}`) && seen.add(`${p.kind}:${p.name}`));
  // Everyone once, with all their roles, the main one first. A series: every season's roles, the one played in the most
  // episodes first, people in the series' billing. A film: someone listed twice keeps the place of their first billing.
  const agg = t.kind === 'series' ? credits.aggregate?.cast ?? [] : [];
  const rolesOf = new Map<string, string[]>();
  const who = (p: TmdbPerson) => (p.id ? `#${p.id}` : key(p.name ?? ''));
  let billed: TmdbPerson[];
  if (agg.length) {
    billed = [...agg].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    for (const p of agg) rolesOf.set(who(p), [...(p.roles ?? [])].sort((a, b) => (b.episode_count ?? 0) - (a.episode_count ?? 0)).map((x) => x.character ?? ''));
  } else {
    billed = [];
    for (const p of [...(credits.cast ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))) {
      if (!rolesOf.has(who(p))) billed.push(p);
      rolesOf.set(who(p), [...(rolesOf.get(who(p)) ?? []), p.character ?? '']);
    }
  }
  const foreign = !!t.language && t.language !== lang;
  const wanted = foreign ? dubs : [];
  const byActor = new Map(wanted.filter((d) => d.actor).map((d) => [key(d.actor!), d]));
  const cast: Person[] = billed.slice(0, 15).map((p) => {
    const w = p.id ? byPerson.get(p.id) : undefined, d = byActor.get(key(p.name ?? ''));
    // Wikidata's names, in the profile's language, when it has as many roles as TMDB; otherwise TMDB's full list.
    const tmdb = joinRoles(rolesOf.get(who(p)) ?? [p.character]), wiki = joinRoles(p.id ? charsOf.get(p.id) ?? [] : []);
    const role = wiki && wiki.split(' / ').length >= tmdb.split(' / ').length ? wiki : tmdb.includes(' / ') ? tmdb : wiki || d?.role || tmdb;
    return { name: p.name ?? '', id: p.id, kind: 'cast', role, photo: img(p.profile_path) ?? w?.actorImg ?? null, character: w?.charImg ?? null };
  });
  const fromWikidata = foreign ? rows.filter((r) => r.prop === 'voice' && r.lang === LANGUAGE_ITEM[lang]) : [];
  const voiceImg = new Map(fromWikidata.filter((r) => r.actorImg).map((r) => [key(r.actor), r.actorImg!]));
  // Each dubbing credit, matched to whom it dubs: by the actor's name, else the character's.
  const rank = (d: DubCredit) => {
    const i = billed.findIndex((p) => (d.actor && key(p.name ?? '') === key(d.actor)) || (d.role && key(plainRole(p.character)) === key(d.role)));
    return { i: i < 0 ? 999 : i, p: i < 0 ? undefined : billed[i] };
  };
  const voices: Person[] = wanted.length
    ? wanted.map((d, n) => ({ d, n, ...rank(d) })).sort((a, b) => a.i - b.i || a.n - b.n).slice(0, 20).map(({ d, p }) => {
      const w = p?.id ? byPerson.get(p.id) : undefined;
      return { name: d.voice, kind: 'voice' as const, role: d.role ?? w?.char ?? plainRole(p?.character), photo: voiceImg.get(key(d.voice)) ?? null, character: w?.charImg ?? null };
    })
    : fromWikidata.map((r) => ({ name: r.actor, kind: 'voice', role: r.char ?? '', photo: r.actorImg ?? null, character: r.charImg ?? null }));
  return { people: unique([...makers, ...cast]), voices: unique(mergeVoices(voices)) };
}

/** One voice dubbing several characters shows once, at the first one's place, with every character: "A / B". */
function mergeVoices(list: Person[]): Person[] {
  const out: Person[] = [], at = new Map<string, Person>();
  for (const v of list) {
    const k = key(v.name), had = at.get(k);
    if (!had) {
      const copy = { ...v };
      at.set(k, copy);
      out.push(copy);
    } else {
      had.role = joinRoles([had.role, v.role]);
      had.character ??= v.character;
    }
  }
  return out;
}

/** Commons' answer → a thumbnail address and a credit line for each file. Docs: MediaWiki/API Imageinfo. */
export function commonsInfo(json: unknown): Map<string, { thumb: string; credit: string }> {
  const out = new Map<string, { thumb: string; credit: string }>();
  const q = (json as { query?: { normalized?: { from: string; to: string }[]; pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string; url?: string; extmetadata?: Record<string, { value?: string }> }[] }> } }).query;
  const from = new Map((q?.normalized ?? []).map((n) => [n.to, n.from]));
  const text = (h?: string) => (h ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  for (const page of Object.values(q?.pages ?? {})) {
    const info = page.imageinfo?.[0], title = page.title ?? '';
    if (!info) continue;
    const m = info.extmetadata ?? {};
    const by = text(m.Attribution?.value) || text(m.Artist?.value);
    const credit = [by, text(m.LicenseShortName?.value)].filter(Boolean).join(', ');
    const name = (from.get(title) ?? title).replace(/^File:/, '');
    out.set(name, { thumb: info.thumburl ?? info.url ?? '', credit });
  }
  return out;
}
