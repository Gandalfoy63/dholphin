// Docs: docs/05 - UI-UX/Focus and Remote.md
// Purpose: typing with the remote: an on-screen keyboard that writes to the last focused field.
import { $, $$, esc, ico } from './dom';
import { go } from './focus';
import { t } from './i18n';

import { HANGUL_KEYS, hangul, kanaMark, katakana, pinyinCandidates, type PinyinTable, type Syllable } from '@/core/typing';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const REST = '0123456789.:/-_@'.split('');
const HIRA = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよ゛゜らりるれろわをんー小'];

/** The scripts the search and name keyboard types. `tab` is the label on its tab, `name` says what it is. */
export const LAYOUTS = [
  { id: 'abc', tab: 'ABC', name: 'Latin letters', keys: LETTERS },
  { id: 'accents', tab: 'ÀÉ', name: 'Accented letters', keys: [...'àâäáãåæçéèêëíìîïñóòôöõøœúùûüýÿß'] },
  { id: 'cyrillic', tab: 'АБВ', name: 'Cyrillic', keys: [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'] },
  { id: 'hiragana', tab: 'あ', name: 'Japanese hiragana: ゛ ゜ and 小 change the last kana', keys: HIRA },
  { id: 'katakana', tab: 'ア', name: 'Japanese katakana: ゛ ゜ and 小 change the last kana', keys: HIRA.map((c) => (c === '小' || c === 'ー' ? c : katakana(c))) },
  { id: 'hangul', tab: '한', name: 'Korean: type the letters, they join into syllables', keys: HANGUL_KEYS },
  { id: 'pinyin', tab: '中', name: 'Chinese: type the pinyin, then pick the character', keys: LETTERS },
] as const;
type LayoutId = (typeof LAYOUTS)[number]['id'];
const MARKS = new Set(['゛', '゜', '小']);

const keysHtml = (keys: readonly string[]) => keys.map((c) => `<button class="f key" type="button" data-k="${c}">${c}</button>`).join('');
const savedLayout = (): LayoutId => {
  try {
    const v = localStorage.getItem('dholphin.kb');
    return LAYOUTS.some((l) => l.id === v) ? (v as LayoutId) : 'abc';
  } catch {
    return 'abc';
  }
};

/** The keyboard. `full` (keys and addresses) is Latin with digits and Shift; otherwise it offers every script. */
export function keyboardHtml(full = true) {
  const end = `<button class="f key wide" type="button" data-k=" ">${t('Space')}</button><button class="f key" type="button" data-k="del" aria-label="${t('Delete')}">${ico('delete', 's')}</button>`;
  if (full) return `<div class="kb full">${keysHtml([...LETTERS, ...REST])}<button class="f key" type="button" data-k="shift" aria-pressed="false" style="grid-column:span 2">${t('Shift')}</button>${end}</div>`;
  const now = savedLayout(), lay = LAYOUTS.find((l) => l.id === now)!;
  return `<div class="kbw"><div class="kbl" role="tablist" aria-label="${t('Keyboard')}">${LAYOUTS.map((l) => `<button class="f key kt" type="button" role="tab" data-l="${l.id}" aria-selected="${l.id === now}" aria-label="${esc(t(l.name))}" title="${esc(t(l.name))}">${l.tab}</button>`).join('')}</div><p class="kbn muted">${esc(t(lay.name))}</p><div class="kbc" hidden></div><div class="kb" data-layout="${now}">${keysHtml(lay.keys)}${end}</div></div>`;
}

let pinyin: PinyinTable | null = null;
const loadPinyin = async () => (pinyin ??= await fetch('./pinyin.json').then((r) => r.json() as Promise<PinyinTable>).catch(() => ({})));

/**
 * Binds the keyboard. `onKey` gets each character to add, or 'del' to remove the last one. Kana marks and Hangul
 * replace what they just typed (a 'del', then the new text). Chinese builds the pinyin, then a picked character is typed.
 */
export function bindKeyboard(root: ParentNode, onKey: (k: string) => void) {
  let upper = false, layout: LayoutId = ($('.kb', root).dataset.layout as LayoutId | undefined) ?? 'abc';
  let last: string | null = null, open: Syllable | null = null, typed = '';
  const write = (drop: number, add: string) => {
    for (let i = 0; i < drop; i++) onKey('del');
    for (const c of add) onKey(c);
  };
  const cands = $('.kbc', root) as HTMLElement | null;
  const paintCands = async () => {
    if (!cands) return;
    if (layout !== 'pinyin' || !typed) {
      cands.hidden = true;
      cands.innerHTML = '';
      return;
    }
    const list = pinyinCandidates(await loadPinyin(), typed);
    cands.hidden = false;
    cands.innerHTML = `<span class="kpy">${esc(typed)}</span>${list.map((c) => `<button class="f key kch" type="button" data-c="${c}">${c}</button>`).join('') || `<span class="muted">${t('No match')}</span>`}`;
    $$('.kch', cands).forEach((b) => (b.onclick = () => pick(b.dataset.c!)));
  };
  const pick = (c: string) => {
    typed = '';
    onKey(c);
    void paintCands();
    go($('.kb .key', root));
  };
  const press = (k: string) => {
    if (k === 'shift') {
      upper = !upper;
      $('[data-k="shift"]', root).setAttribute('aria-pressed', String(upper));
      $$('.kb .key', root).forEach((x) => {
        if (x.dataset.k!.length === 1 && /[a-z]/.test(x.dataset.k!)) x.textContent = upper ? x.dataset.k!.toUpperCase() : x.dataset.k!;
      });
      return;
    }
    if (k === 'del') {
      open = null;
      last = null;
      if (layout === 'pinyin' && typed) {
        typed = typed.slice(0, -1);
        return void paintCands();
      }
      return onKey('del');
    }
    if (layout === 'pinyin' && /^[a-z]$/.test(k)) {
      typed += k;
      return void paintCands();
    }
    if (layout === 'pinyin' && k === ' ' && typed) {
      const first = pinyin && pinyinCandidates(pinyin, typed, 1)[0];
      return first ? pick(first) : undefined;
    }
    if (MARKS.has(k)) {
      const next = kanaMark(last, k as '゛' | '゜' | '小');
      if (next) {
        write(1, next);
        last = next;
      }
      return;
    }
    if (layout === 'hangul' && HANGUL_KEYS.includes(k)) {
      const r = hangul(open, k);
      write(r.edit.drop, r.edit.add);
      open = r.open;
      return;
    }
    open = null;
    last = k === ' ' ? null : k;
    onKey(upper ? k.toUpperCase() : k);
  };
  const bindKeys = () => $$('.kb .key', root).forEach((b) => (b.onclick = () => press(b.dataset.k!)));
  $$<HTMLButtonElement>('.kbl .kt', root).forEach((b) => (b.onclick = () => {
    layout = b.dataset.l as LayoutId;
    const lay = LAYOUTS.find((l) => l.id === layout)!;
    try {
      localStorage.setItem('dholphin.kb', layout);
    } catch { /* the choice just isn't kept */ }
    $$('.kbl .kt', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('.kbn', root).textContent = t(lay.name);
    const kb = $('.kb', root);
    kb.dataset.layout = layout;
    kb.querySelectorAll('[data-k]:not([data-k=" "]):not([data-k="del"])').forEach((x) => x.remove());
    kb.insertAdjacentHTML('afterbegin', keysHtml(lay.keys));
    open = null;
    last = null;
    typed = '';
    bindKeys();
    void paintCands();
    if (layout === 'pinyin') void loadPinyin();
  }));
  bindKeys();
}

export const fieldsHtml = (fields: { key: string; label: string; secret?: boolean; placeholder?: string; value?: string }[]) =>
  `<div class="fields">${fields.map((f) => `<label class="field"><span>${esc(t(f.label))}</span><input class="f" id="fld-${esc(f.key)}" data-key="${esc(f.key)}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${esc(f.placeholder ?? '')}" value="${esc(f.value ?? '')}"></label>`).join('')}</div>`;

/** Fields plus keyboard: the keyboard types into whichever field was focused last. */
export function bindFields(root: ParentNode, changed?: () => void) {
  const inputs = $$<HTMLInputElement>('.field input', root);
  let target = inputs[0];
  inputs.forEach((i) => {
    i.addEventListener('focus', () => (target = i));
    i.addEventListener('input', () => changed?.());
  });
  bindKeyboard(root, (k) => {
    if (!target) return;
    target.value = k === 'del' ? target.value.slice(0, -1) : target.value + k;
    changed?.();
  });
  return () => Object.fromEntries(inputs.map((i) => [i.dataset.key!, i.value.trim()]));
}
export const firstKey = (root: ParentNode) => $('.kb .key', root);
