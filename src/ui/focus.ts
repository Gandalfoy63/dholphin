// Docs: docs/05 - UI-UX/Focus and Remote.md
// Purpose: moves focus with the arrows, by geometry, with rows remembering their place.
import { $, $$, TV } from './dom';

export const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'XF86Back']);
export const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
type Dir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export const nav = {
  pointer: false,
  /** Set by a full-screen layer, such as the player, which takes all keys. */
  override: null as ((e: KeyboardEvent) => void) | null,
  onBack: (() => undefined) as () => void,
  openRail: (() => undefined) as () => void,
  closeRail: (() => undefined) as () => void,
  onCard: ((_el: HTMLElement) => undefined) as (el: HTMLElement) => void,
  /** Turns a row by pixels, for a sideways wheel or swipe: set by rows.ts. */
  scrollRow: ((_row: HTMLElement, _dx: number) => undefined) as (row: HTMLElement, dx: number) => void,
};

/** A page with its own scrolling (the Library's list draws only the rows in view): the wheel asks it first. */
export interface Scroll { by(dy: number): void }
const scrolls = new WeakMap<Element, Scroll>();
export const setScroll = (el: Element, s: Scroll) => void scrolls.set(el, s);

/** Where an element sits now, from the `translateY` the page set on it. */
export const slidY = (el: HTMLElement) => -Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
let settle = 0;
/**
 * Slides a page by pixels, within its length: a short transition so the wheel feels continuous, then the page's own
 * (longer) one again for focus moves.
 */
export function slideBy(el: HTMLElement, dy: number, view = 1080) {
  const max = Math.max(0, el.scrollHeight - view), to = Math.min(max, Math.max(0, slidY(el) + dy));
  el.style.transition = 'transform 140ms ease-out';
  el.style.transform = `translateY(${-to}px)`;
  clearTimeout(settle);
  settle = window.setTimeout(() => (el.style.transition = ''), 300);
  // Title Details dims its picture once its sections come up, as focus moving down does.
  el.closest('.dlayer')?.classList.toggle('down', to > 200);
}

/** What the wheel scrolls: a dialog's own page if it has one, Title Details, then the page in view. */
function wheelScroll(t: Element, dy: number) {
  for (let n: Element | null = t; n && n !== TV(); n = n.parentElement) {
    const own = scrolls.get(n);
    if (own) return own.by(dy);
  }
  const modal = $$('.modal', TV()).pop();
  if (modal) {
    const s = $('.ppl-scroll', modal);
    return s ? slideBy(s, dy) : undefined;
  }
  const d = $('.dlayer .dscroll', TV());
  if (d) return slideBy(d, dy);
  const page = $('#ct > .scroller, #ct > .pg, #ct .scroller', TV());
  if (page) slideBy(page, dy);
}

export const go = (e: Element | null | undefined) => (e as HTMLElement | null)?.focus({ preventScroll: true });
export function layer(): HTMLElement {
  return $('.modal', TV()) ?? $('.dlayer', TV()) ?? TV();
}
export function focusables(scope: ParentNode): HTMLElement[] {
  return $$('.f', scope).filter((e) => !(e as HTMLButtonElement).disabled && !e.closest('[data-off]') && !e.closest('[hidden]'));
}

/** The nearest element in the direction, preferring those in line. */
export function nearest(from: DOMRect, dir: Dir, list: { el: HTMLElement; r: DOMRect }[]): HTMLElement | null {
  const ax = from.left + from.width / 2, ay = from.top + from.height / 2;
  let best: HTMLElement | null = null, score = 1e9;
  const h = dir === 'ArrowLeft' || dir === 'ArrowRight';
  for (const { el, r } of list) {
    const dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
    const p = dir === 'ArrowLeft' ? -dx : dir === 'ArrowRight' ? dx : dir === 'ArrowUp' ? -dy : dy;
    if (p <= 2) continue;
    const s = p + (h ? Math.abs(dy) : Math.abs(dx)) * 2.5;
    if (s < score) {
      score = s;
      best = el;
    }
  }
  return best;
}

const visibleRow = (r: Element | null, step: 'previousElementSibling' | 'nextElementSibling'): HTMLElement | null => {
  let n = r?.[step] ?? null;
  while (n && !(n.classList.contains('row') && !(n as HTMLElement).hidden && $('.card', n))) n = n[step];
  return n as HTMLElement | null;
};
export function focusRow(row: HTMLElement | null) {
  if (!row) return;
  const cards = $$('.card', row);
  go(cards[Number(row.dataset.last ?? row.dataset.start ?? 0)] ?? cards[0]);
}

function rowsMove(el: HTMLElement, dir: Dir): boolean {
  const hero = el.closest('.hero');
  if (hero) {
    if (dir === 'ArrowDown') {
      const first = $('.row:not([hidden])', el.closest('.scroller')!);
      focusRow($('.card', first ?? document) ? first : visibleRow(first, 'nextElementSibling'));
      return true;
    }
    return dir === 'ArrowUp';
  }
  const row = el.closest<HTMLElement>('.row');
  if (!row || !el.classList.contains('card')) return false;
  const cards = $$('.card', row), i = cards.indexOf(el);
  if (dir === 'ArrowLeft') {
    if (i === 0) nav.openRail();
    else go(cards[i - 1]);
    return true;
  }
  if (dir === 'ArrowRight') {
    go(cards[i + 1]);
    return true;
  }
  const n = visibleRow(row, dir === 'ArrowUp' ? 'previousElementSibling' : 'nextElementSibling');
  if (n) focusRow(n);
  else if (dir === 'ArrowUp') go($('.hero .f', row.parentElement!));
  return true;
}

export function move(dir: Dir) {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !el.classList.contains('f') || !TV().contains(el)) {
    go(focusables(layer())[0]);
    return;
  }
  const rail = el.closest('.rail');
  if (rail) {
    if (dir === 'ArrowRight') nav.closeRail();
    if (dir === 'ArrowUp' || dir === 'ArrowDown') {
      const all = $$('.f', rail);
      go(all[all.indexOf(el) + (dir === 'ArrowDown' ? 1 : -1)]);
    }
    return;
  }
  if (!el.closest('.dlayer') && !el.closest('.modal') && rowsMove(el, dir)) return;
  const scope = layer();
  const list = focusables(scope).filter((e) => e !== el && !e.closest('.rail')).map((e) => ({ el: e, r: e.getBoundingClientRect() }));
  const n = nearest(el.getBoundingClientRect(), dir, list);
  if (n) go(n);
  else if (dir === 'ArrowLeft' && scope === TV() && $('.rail', TV())) nav.openRail();
}

/**
 * In a text field, Left and Right move the cursor; at the field's start or end they move focus, as Up and Down do.
 * A field's own keyboard (the system's, on Android) takes the keys before the page while it is open.
 */
export function keepsArrow(e: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !['text', 'search', 'password', 'url'].includes(el.type)) return false;
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? el.value.length;
  if (e.key === 'ArrowLeft') return start > 0 || start !== end;
  if (e.key === 'ArrowRight') return end < el.value.length || start !== end;
  return false;
}

export function installKeys() {
  document.addEventListener('keydown', (e) => {
    if (nav.override) {
      nav.override(e);
      return;
    }
    if (ARROWS.has(e.key)) {
      if (keepsArrow(e)) return;
      e.preventDefault();
      nav.pointer = false;
      move(e.key as Dir);
    } else if (BACK_KEYS.has(e.key) || (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement))) {
      e.preventDefault();
      nav.pointer = false;
      // An open dialog closes first, on every screen, setup included: the update offer can appear anywhere.
      const modal = document.querySelector('#tv .modal');
      const shut = (window as unknown as { _mret?: () => void })._mret;
      if (modal) return shut ? shut() : modal.remove();
      nav.onBack();
    }
  });
  TV().addEventListener('mousemove', (e) => {
    const f = (e.target as Element).closest?.<HTMLElement>('.f');
    if (f && !(f as HTMLButtonElement).disabled && document.activeElement !== f && !f.closest('[data-off]')) {
      nav.pointer = true;
      f.focus({ preventScroll: true });
    }
  });
  // On a computer: the mouse's own Back button does what the remote's Back does (through the browser's history, see
  // `installHistory`). A right click is left to the browser: it used to go back, which a website never does.
  // A click beside a dialog (on its dimmed backdrop) closes it, as Back does: what a website's dialogs do.
  TV().addEventListener('click', (e) => {
    const m = e.target as HTMLElement;
    if (m.classList?.contains('modal') && m === $$('.modal', TV()).pop()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  // The wheel and a touchpad scroll the page by pixels, as a website does; focus stays where it is. Sideways (a
  // touchpad's swipe, or Shift and the wheel) over a row turns that row.
  TV().addEventListener('wheel', (e) => {
    e.preventDefault();
    if (nav.override) return;
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const sideways = e.shiftKey && !e.deltaX;
    const dx = (sideways ? e.deltaY : e.deltaX) * unit, dy = (sideways ? 0 : e.deltaY) * unit;
    const t = e.target as Element;
    if (Math.abs(dx) > Math.abs(dy)) {
      const row = t.closest?.<HTMLElement>('.row');
      if (row) nav.scrollRow(row, dx);
      return;
    }
    if (dy) wheelScroll(t, dy);
  }, { passive: false });
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains('card')) nav.onCard(el);
  });
}

/**
 * In a browser: the browser's Back (its button, Alt and Left, a mouse's Back button) does the app's Back instead of
 * leaving the site. One extra history entry stands in front of the page; going back to the one below it runs Back and
 * puts the entry back.
 */
export function installHistory() {
  history.replaceState({ dholphin: 'base' }, '', location.href);
  history.pushState({ dholphin: 'top' }, '', location.href);
  addEventListener('popstate', (e) => {
    if ((e.state as { dholphin?: string } | null)?.dholphin !== 'base') return;
    history.pushState({ dholphin: 'top' }, '', location.href);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}
