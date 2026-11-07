// Docs: docs/05 - UI-UX/Focus and Remote.md
// Purpose: what the on-screen keyboard types in other scripts: Japanese kana marks, Hangul syllables, Chinese from pinyin.

/** One change to the text: remove `drop` characters from its end, then add `add`. */
export interface Edit { drop: number; add: string }

/* ---------- Japanese: ゛ ゜ and small kana act on the last kana typed ---------- */

const pairs = (s: string) => {
  const m = new Map<string, string>();
  for (let i = 0; i < s.length; i += 2) m.set(s[i]!, s[i + 1]!);
  return m;
};
const VOICED = pairs('かがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとどはばひびふぶへべほぼうゔ');
const SEMI = pairs('はぱひぴふぷへぺほぽ');
const SMALL = pairs('あぁいぃうぅえぇおぉつっやゃゆゅよょわゎぁあぃいぅうぇえぉおっつゃやゅゆょよゎわ');
const plainOf = new Map([...[...VOICED].map(([k, v]) => [v, k] as const), ...[...SEMI].map(([k, v]) => [v, k] as const)]);
const toHira = (c: string) => (c >= 'ァ' && c <= 'ヶ' ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c);
const toKata = (c: string) => (c >= 'ぁ' && c <= 'ゖ' ? String.fromCharCode(c.charCodeAt(0) + 0x60) : c);
export const katakana = (s: string) => [...s].map(toKata).join('');

/**
 * ゛, ゜ or 小 on the last kana: が from か, ぱ from は or ば, っ from つ. Pressed again it takes the mark off.
 * Null when it doesn't apply to that kana.
 */
export function kanaMark(last: string | null, mark: '゛' | '゜' | '小'): string | null {
  if (!last) return null;
  const h = toHira(last), base = plainOf.get(h) ?? h;
  let next: string | undefined;
  if (mark === '小') next = SMALL.get(h);
  else if (mark === '゛') next = VOICED.get(h) === undefined ? (h === VOICED.get(base) ? base : VOICED.get(base)) : VOICED.get(h);
  else next = h === SEMI.get(base) ? base : SEMI.get(base);
  if (!next) return null;
  return last !== h ? toKata(next) : next;
}

/* ---------- Korean: jamo assembled into syllables (Unicode 3.12, Hangul Syllables) ---------- */

const L = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const V = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const T = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
const BOTH_V: Record<string, string> = { ㅗㅏ: 'ㅘ', ㅗㅐ: 'ㅙ', ㅗㅣ: 'ㅚ', ㅜㅓ: 'ㅝ', ㅜㅔ: 'ㅞ', ㅜㅣ: 'ㅟ', ㅡㅣ: 'ㅢ' };
const BOTH_T: Record<string, string> = { ㄱㅅ: 'ㄳ', ㄴㅈ: 'ㄵ', ㄴㅎ: 'ㄶ', ㄹㄱ: 'ㄺ', ㄹㅁ: 'ㄻ', ㄹㅂ: 'ㄼ', ㄹㅅ: 'ㄽ', ㄹㅌ: 'ㄾ', ㄹㅍ: 'ㄿ', ㄹㅎ: 'ㅀ', ㅂㅅ: 'ㅄ' };
const SPLIT_T = Object.fromEntries(Object.entries(BOTH_T).map(([k, v]) => [v, [k[0]!, k[1]!] as const]));
export const HANGUL_KEYS = [...L, ...V];

/** The syllable being typed: its leading consonant, vowel and final, as compatibility jamo. */
export interface Syllable { l: string; v?: string; t?: string }
const draw = (s: Syllable) => (s.v ? String.fromCharCode(0xac00 + (L.indexOf(s.l) * 21 + V.indexOf(s.v)) * 28 + Math.max(0, T.indexOf(s.t ?? ' '))) : s.l);

/**
 * Adds one jamo to what is being typed. Returns the edit to the text and the syllable now open (null when none):
 * a vowel after a final takes that final as its own first consonant, as in 갑 + ㅏ = 가바.
 */
export function hangul(open: Syllable | null, j: string): { edit: Edit; open: Syllable | null } {
  const vowel = V.includes(j);
  if (!open) return vowel ? { edit: { drop: 0, add: j }, open: null } : { edit: { drop: 0, add: j }, open: { l: j } };
  if (vowel) {
    if (!open.v) return redraw(open, { ...open, v: j });
    if (!open.t) {
      const both = BOTH_V[open.v + j];
      return both ? redraw(open, { ...open, v: both }) : { edit: { drop: 0, add: j }, open: null };
    }
    // The final moves on: the whole final, or the second half of a double one.
    const [keep, move] = SPLIT_T[open.t] ?? [undefined, open.t];
    const before = { ...open, t: keep }, next = { l: move, v: j };
    return { edit: { drop: 1, add: draw(before) + draw(next) }, open: next };
  }
  if (!open.v) return { edit: { drop: 0, add: j }, open: { l: j } };
  if (!open.t) return T.includes(j) && j !== ' ' ? redraw(open, { ...open, t: j }) : { edit: { drop: 0, add: j }, open: { l: j } };
  const both = BOTH_T[open.t + j];
  return both ? redraw(open, { ...open, t: both }) : { edit: { drop: 0, add: j }, open: { l: j } };
}
const redraw = (_was: Syllable, now: Syllable) => ({ edit: { drop: 1, add: draw(now) }, open: now });

/* ---------- Chinese: type the pinyin, pick the character ---------- */

/** Pinyin without tones (ü as v) to characters, most used first: data/pinyin.json, from Unihan's kHanyuPinlu. */
export type PinyinTable = Record<string, string>;

/** The characters for what has been typed: its own reading first, then readings it starts, each by use. */
export function pinyinCandidates(table: PinyinTable, typed: string, max = 10): string[] {
  const p = typed.toLowerCase().replace(/ü/g, 'v');
  if (!p) return [];
  const out: string[] = [];
  const add = (c: string) => {
    if (out.length < max && !out.includes(c)) out.push(c);
  };
  for (const c of table[p] ?? '') add(c);
  const longer = Object.keys(table).filter((k) => k !== p && k.startsWith(p)).map((k) => table[k]!);
  // Round-robin: the most used character of each longer reading, then the next of each.
  for (let i = 0; out.length < max && longer.some((s) => s.length > i); i++) for (const s of longer) if (s[i]) add(s[i]!);
  return out;
}
