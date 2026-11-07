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
};

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

export function installKeys() {
  document.addEventListener('keydown', (e) => {
    if (nav.override) {
      nav.override(e);
      return;
    }
    if (ARROWS.has(e.key)) {
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
  // On a computer: the mouse's own Back button, or a right click, does what the remote's Back does.
  const back = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  TV().addEventListener('contextmenu', (e) => {
    if ((e.target as Element).closest?.('input, textarea')) return;
    e.preventDefault();
    back();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
      e.preventDefault();
      back();
    }
  });
  TV().addEventListener('wheel', (e) => {
    e.preventDefault();
    if (nav.override) return;
    nav.pointer = false;
    move(e.deltaY > 0 ? 'ArrowDown' : 'ArrowUp');
  }, { passive: false });
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains('card')) nav.onCard(el);
  });
}
