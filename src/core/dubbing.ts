// Docs: docs/03 - Features/Cast.md
// Purpose: dubbing credits read from Wikipedia articles and the Doblaje Wiki: who voices whom in the profile's language.

/** One dubbing credit: the voice in the profile's language, the original actor when the source names them, the role. */
export interface DubCredit { voice: string; actor?: string; role?: string }

interface Lang {
  /** Sections that may hold dubbing credits, by heading. */
  heads: RegExp;
  /** Sections whose plain lists are the voices themselves: `* Voice : Role`. */
  voiceHeads: RegExp;
  /** Table columns: the dubbed voice (the first matching header wins, so the main country comes first), the original actor, the character. */
  dub: RegExp[];
  orig: RegExp;
  char: RegExp;
}

/** Per interface language. French Wikipedia writes the voices with `{{Doublage|VF=…}}` or `(VF : …)`, Italian in prose, the rest in tables. */
export const DUB_LANGS: Record<string, Lang> = {
  fr: { heads: /distribution|voix|personnages|acteurs|doublage|interpr/i, voiceHeads: /^(voix fran|doublage)/i, dub: [/\bVF\b|france|fran[cç]ais/i, /\bVQ\b|qu[ée]b/i], orig: /original|acteur|interpr/i, char: /r[ôo]le|personnage/i },
  es: { heads: /doblaje|reparto|elenco/i, voiceHeads: /doblaje/i, dub: [/españ|castellan/i, /hispan|latin|méxico|mexic/i, /doblaje|voz/i], orig: /original/i, char: /personaje/i },
  de: { heads: /synchron|sprecher|besetzung/i, voiceHeads: /^(deutsche )?synchronsprecher/i, dub: [/deutsch|synchron/i], orig: /original|darsteller|schauspieler/i, char: /rolle|figur/i },
  it: { heads: /doppia|edizione italiana|personaggi|interpreti/i, voiceHeads: /doppiatori italiani|voci italiane/i, dub: [/italian|doppiat/i], orig: /original|interpret|attor/i, char: /personagg|ruolo/i },
  en: { heads: /cast|dub/i, voiceHeads: /english (dub|voice)/i, dub: [/english/i], orig: /original|japanese|french|korean|spanish|german|italian/i, char: /character|role/i },
};

/** Sections to read, from `action=parse&prop=sections`: the top-level matching ones (subsections come with them), at most three. */
export function dubSections(sections: { index: string; line: string; toclevel: number }[], lang: string): string[] {
  const L = DUB_LANGS[lang];
  if (!L) return [];
  const picked: { index: string; level: number }[] = [];
  let under = 0;
  for (const s of sections) {
    if (under && s.toclevel > under) continue;
    under = 0;
    const line = strip(s.line);
    if (L.heads.test(line) && !SKIP.test(line)) { picked.push({ index: s.index, level: s.toclevel }); under = s.toclevel; }
  }
  // Italian articles also list the voices in the infobox, in the lead section.
  return [...(lang === 'it' ? ['0'] : []), ...picked.slice(0, 3).map((p) => p.index)];
}

/** Headings about the casting or a trailer's dub, not the film's voices. */
const SKIP = /tr[áa]iler|sobre|selecci[óo]n|choix|casting|attribution|scelta|auswahl/i;

const strip = (h: string) => h.replace(/<[^>]*>/g, '').trim();

/** Wikitext → plain text: links to their label, known title templates kept, other templates, refs and markup dropped. */
export function plain(s = ''): string {
  let t = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>/]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/\[\[(?:File|Fichier|Archivo|Datei|Image|Imagen|Immagine|Bild):[^\]]*\]\]/gi, '');
  for (let i = 0; i < 4 && /\{\{/.test(t); i++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const [name = '', ...args] = body.split('|').map((x) => x.trim());
      if (/^(M\.|Mme|Mlle|Dr|Me|Pr)$/i.test(name)) return `${name} ${args.join(' ')}`;
      if (/^PersonZelle$/i.test(name)) return args.filter((a) => !a.includes('=')).join(' ');
      if (/^(lang|nihongo|langue|small|nowrap|nobr)$/i.test(name)) return args.filter((a) => !a.includes('=')).slice(-1)[0] ?? '';
      return '';
    });
  }
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\S+\s([^\]]*)\]/g, '$1');
  t = t.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/'{2,}/g, '').replace(/&nbsp;/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** A name, as it is said: no parenthesis such as "(engl. Hamm)" or "(non crédité)". */
const name = (s?: string) => plain(s).replace(/\s*\([^)]*\)/g, '').replace(/\s*\/.*$/, '').trim();
const self = /^(elle|lui|eux|elles)[- ]m[êe]mes?$|^s[ée] mism[oa]$|^s[ée] stess[oa]$|^sich selbst$|^himself$|^herself$/i;
const credit = (voice: string, actor?: string, role?: string): DubCredit | null => {
  const v = name(voice);
  if (!v || self.test(v) || v.length > 60) return null;
  // The character only: articles often add a description after a comma or a dash, or a "see also".
  const r = role ? plain(role).replace(/\s*\([^)]*\)/g, '').split(/,\s|\s[–—-]\s|\s(?:vedi|voir|siehe|véase|see)\s/)[0]!.trim() : undefined;
  const a = actor ? name(actor) : undefined;
  return { voice: v, ...(a ? { actor: a } : {}), ...(r ? { role: r.slice(0, 80) } : {}) };
};

/** Splits on `sep` outside [[links]] and {{templates}}. */
function split(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if ((two === ']]' || two === '}}') && depth) { depth--; cur += two; i++; continue; }
    if (!depth && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

/** A table cell without its attributes (`style="…" | text`). */
const cell = (c: string) => {
  const parts = split(c, '|');
  return (parts.length > 1 && /=/.test(parts[0]!) && !/\[\[|\{\{/.test(parts[0]!) ? parts.slice(1).join('|') : c).trim();
};

/** Every wikitable: header texts and data rows of raw cells. */
function tables(text: string): { head: string[]; rows: string[][] }[] {
  const out: { head: string[]; rows: string[][] }[] = [];
  for (const block of text.split(/^\{\|/m).slice(1)) {
    const body = block.split(/^\|\}/m)[0] ?? '';
    // German Wikipedia's dubbing tables get their header from a template: role, actor, German voice.
    const head: string[] = /^[^\n]*Kopfzeile Synchronisation/i.test(body) ? ['Rolle', 'Darsteller', 'Synchronsprecher'] : [], rows: string[][] = [];
    for (const row of body.split(/^\|-.*$/m)) {
      const cells: string[] = [];
      let header = false;
      for (const line of row.split('\n')) {
        if (/^\|\+/.test(line)) continue;
        if (/^!/.test(line)) { header = true; cells.push(...split(line.slice(1), '!!').map(cell)); }
        else if (/^\|/.test(line)) cells.push(...split(line.slice(1), '||').map(cell));
        else if (cells.length && line.trim()) cells[cells.length - 1] += `\n${line}`;
      }
      if (!cells.length) continue;
      if (header && !head.length) head.push(...cells.map(plain));
      else if (!header) rows.push(cells);
    }
    if (head.length) out.push({ head, rows });
  }
  return out;
}

/**
 * The dubbing credits in one section's wikitext, for an interface language. Reads, in order of how often they're used:
 * `{{Doublage|VF=…}}` and `(VF : …)` on list lines (French), `(doppiato da … e da … in italiano)` (Italian),
 * plain voice lists under a voices heading, and tables with a dubbed-voice column. Docs: MediaWiki/API Parsing wikitext.
 */
export function dubCredits(wikitext: string, lang: string): DubCredit[] {
  const L = DUB_LANGS[lang];
  if (!L) return [];
  const out: DubCredit[] = [];
  const add = (c: DubCredit | null) => c && out.push(c);
  let voiceList = false;
  for (const raw of wikitext.split('\n')) {
    const h = /^(=+)\s*(.*?)\s*\1\s*$/.exec(raw);
    if (h) { voiceList = L.voiceHeads.test(plain(h[2])); continue; }
    // An infobox parameter, such as Italian Wikipedia's `|doppiatori italiani =`.
    const param = /^\|\s*([\p{L} ]+?)\s*=/u.exec(raw);
    if (param) { voiceList = L.voiceHeads.test(param[1]!); continue; }
    if (!/^\*(?!\*)/.test(raw)) continue;
    const line = raw.slice(1).trim();
    if (lang === 'fr') {
      const tpl = /\{\{\s*Doublage\s*\|([^}]*)\}\}/i.exec(line);
      const small = /\(\s*VF(?:\s+et\s+VQ)?\s*:\s*([^;)]+)/i.exec(line);
      const vf = tpl ? split(tpl[1]!, '|').map((p) => p.split('=')).find(([k]) => k?.trim() === 'VF')?.[1] : small?.[1];
      if (vf) {
        const at = tpl ? tpl.index : line.indexOf('<small>') >= 0 ? line.indexOf('<small>') : small!.index;
        const rest = line.slice(at).replace(/^\{\{[^}]*\}\}|^<small>.*?<\/small>|^\([^)]*\)/i, '');
        add(credit(vf, line.slice(0, at), rest.replace(/^\s*:\s*/, '')));
        continue;
      }
    }
    if (lang === 'it') {
      const it = /doppiat[oaie]\s+(?:da\s+(.+?)\s+in\s+(?:ingles|original|lingua original|giappones|frances)\w*\s+e\s+)?(?:da\s+(.+?)\s+in\s+italiano|in\s+italiano\s+da\s+(.+?))\s*(?:\)|,|;|$)/i.exec(line);
      if (it) { add(credit(it[2] ?? it[3]!, it[1], line.slice(0, it.index).replace(/\(\s*$/, ''))); continue; }
    }
    if (voiceList) {
      const [who, ...role] = split(line, ':');
      if (role.length) add(credit(who!, undefined, role.join(':')));
      else if (lang === 'en') { const m = /^(.+?)\s+as\s+(.+)$/.exec(plain(line)); if (m) add(credit(m[1]!, undefined, m[2])); }
    }
  }
  for (const t of tables(wikitext)) {
    const dub = L.dub.map((re) => t.head.findIndex((x) => re.test(x) && !L.orig.test(x))).find((i) => i >= 0) ?? -1;
    if (dub < 0) continue;
    const orig = t.head.findIndex((x, i) => i !== dub && L.orig.test(x));
    const ch = t.head.findIndex((x, i) => i !== dub && i !== orig && L.char.test(x));
    for (const r of t.rows) add(credit(r[dub] ?? '', orig >= 0 ? r[orig] : undefined, ch >= 0 ? r[ch] : undefined));
  }
  const seen = new Set<string>();
  return out.filter((c) => { const k = `${key(c.voice)}|${key(c.role ?? '')}`; return !seen.has(k) && !!seen.add(k); });
}

/** Names compared without accents, case or punctuation, in any script. */
export const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The Wikipedia article for a TMDB title in one language, through Wikidata's sitelinks. Docs: MediaWiki/Wikibase RDF Dump Format (sitelinks). */
export function articleQuery(tmdbId: number, kind: 'movie' | 'tv', lang: string): string {
  const prop = kind === 'tv' ? 'P4983' : 'P4947';
  return `SELECT ?a WHERE { ?f wdt:${prop} "${tmdbId}". ?a schema:about ?f; schema:isPartOf <https://${lang}.wikipedia.org/>. } LIMIT 1`;
}

/** SPARQL answer → the article's title, or null. */
export function articleTitle(json: unknown): string | null {
  const v = (json as { results?: { bindings?: { a?: { value?: string } }[] } }).results?.bindings?.[0]?.a?.value;
  return v ? decodeURIComponent(v.split('/wiki/')[1] ?? '').replace(/_/g, ' ') || null : null;
}

/**
 * A Doblaje Wiki page is the title when its infobox names the same original title, or, without one, the same title as
 * one we know (the original or the Spanish one) with a year; and in both cases no other year.
 */
export function doblajeMatches(intro: string, names: string[], year?: number | null): boolean {
  const field = (f: string) => new RegExp(`^\\|[ \\t]*${f}[ \\t]*=[ \\t]*([^\\n]*)`, 'im').exec(intro)?.[1]?.split(/<br|\(/i)[0]?.trim();
  const y = /^\|[ \t]*año[ \t]*=[ \t]*(\d{4})/im.exec(intro)?.[1];
  if (y && year && Math.abs(Number(y) - year) > 1) return false;
  const known = names.map(key).filter(Boolean), same = (x?: string) => !!x && known.includes(key(plain(x)));
  const orig = field('titulo_orig');
  return orig ? same(orig) : !!y && same(field('titulo'));
}
