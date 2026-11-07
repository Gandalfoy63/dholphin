// Docs: docs/03 - Features/Cast.md
// Purpose: more faces, character pictures and anime voices from TVmaze, AniList, Wikipedia and Google, each answer read here.
import type { Person } from './cast';
import { key } from './dubbing';

/** A face or a character picture another source has, by the person's name. */
export interface Found { name: string; photo?: string | null; character?: string | null; role?: string }

/** AniList's language names for its voice actors, by interface language. Docs: AniList/GraphQL. */
export const ANILIST_LANG: Record<string, string> = { fr: 'FRENCH', es: 'SPANISH', de: 'GERMAN', it: 'ITALIAN', en: 'ENGLISH' };

/** One anime's characters, the original (Japanese) voices and the voices in the profile's language. */
export function anilistCastQuery(lang: string): string {
  const dub = ANILIST_LANG[lang] ?? 'ENGLISH';
  return `query ($search: String, $year: Int) { Media(search: $search, type: ANIME, seasonYear: $year) { id averageScore popularity startDate { year } title { english romaji } characters(sort: [ROLE, RELEVANCE], perPage: 25) { edges { node { name { full } image { large } } orig: voiceActors(language: JAPANESE) { name { full } image { large } } dub: voiceActors(language: ${dub}) { name { full } image { large } } } } } }`;
}

/** AniList's placeholder picture means none. */
const real = (u?: string | null) => (u && !/\/default\.(jpg|png)$/.test(u) ? u : null);

interface AniEdge { node?: { name?: { full?: string }; image?: { large?: string } }; orig?: { name?: { full?: string }; image?: { large?: string } }[]; dub?: { name?: { full?: string }; image?: { large?: string } }[] }
/** AniList's answer: each original voice with the character's picture, the dub's voices, and the score out of 100. */
export function anilistCast(json: unknown): { original: Found[]; dub: Found[]; score: number | null; votes: number | null; year: number | null } {
  const m = (json as { data?: { Media?: { averageScore?: number | null; popularity?: number | null; startDate?: { year?: number }; characters?: { edges?: AniEdge[] } } } }).data?.Media;
  const edges = m?.characters?.edges ?? [];
  const pick = (side: 'orig' | 'dub') => edges.flatMap((e) => (e[side] ?? []).slice(0, 1).map((v) => ({
    name: v.name?.full ?? '', photo: real(v.image?.large), character: real(e.node?.image?.large), role: e.node?.name?.full ?? '',
  }))).filter((f) => f.name);
  return { original: pick('orig'), dub: pick('dub'), score: m?.averageScore ?? null, votes: m?.popularity ?? null, year: m?.startDate?.year ?? null };
}

/** TVmaze's `/shows/{id}/cast`: each actor's photo and the character's, by name. Docs: TVmaze/API. */
export function tvmazeCast(json: unknown): Found[] {
  const list = Array.isArray(json) ? json as { person?: { name?: string; image?: { medium?: string } | null }; character?: { name?: string; image?: { medium?: string } | null } }[] : [];
  return list.map((c) => ({ name: c.person?.name ?? '', photo: c.person?.image?.medium ?? null, character: c.character?.image?.medium ?? null, role: c.character?.name })).filter((f) => f.name);
}

/** Words that say a page or entity is about an actor or a voice, in the five languages. */
const ACTOR = /act(or|ress|eur|rice|riz|ice)|comédien|doubl|voice|voix|voz|schauspiel|synchron|sprecher|doppiat|attor|seiy|doblaj|perform/i;

/** Wikipedia's `prop=pageimages|description`: the portrait's file, only for pages that describe an actor. Docs: MediaWiki/Extension PageImages. */
export function wikiPortraits(json: unknown): Map<string, string> {
  const pages = (json as { query?: { pages?: { title?: string; pageimage?: string; description?: string; missing?: boolean }[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } }).query;
  const back = new Map<string, string>();
  for (const r of [...(pages?.normalized ?? []), ...(pages?.redirects ?? [])]) back.set(r.to, back.get(r.from) ?? r.from);
  const out = new Map<string, string>();
  for (const p of pages?.pages ?? []) {
    if (p.missing || !p.pageimage || !p.title || !ACTOR.test(p.description ?? '')) continue;
    out.set(key(back.get(p.title) ?? p.title), `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.pageimage)}`);
  }
  return out;
}

/** Google Knowledge Graph's answer: the first person described as an actor, with the picture and its licence page. Docs: Google Knowledge Graph/Reference. */
export function knowledgePhoto(json: unknown, name: string): { photo: string; licence: string } | null {
  const items = (json as { itemListElement?: { result?: { name?: string; description?: string; image?: { contentUrl?: string; url?: string } } }[] }).itemListElement ?? [];
  const hit = items.map((i) => i.result).find((r) => r?.image?.contentUrl && key(r.name ?? '') === key(name) && ACTOR.test(r.description ?? ''));
  return hit ? { photo: hit.image!.contentUrl!, licence: hit.image!.url ?? '' } : null;
}

/**
 * Fills what is missing from what other sources found, matched by name, never replacing what is there.
 * A face is used once: one already shown for someone else is left out. A character's picture may repeat.
 */
export function fill(people: Person[], found: Found[], used: Set<string>): number {
  const byName = new Map(found.map((f) => [key(f.name), f]));
  let n = 0;
  for (const p of people) {
    const f = byName.get(key(p.name));
    if (!f) continue;
    if (!p.photo && f.photo && !used.has(f.photo)) { p.photo = f.photo; used.add(f.photo); n++; }
    if (!p.character && f.character) { p.character = f.character; n++; }
  }
  return n;
}
