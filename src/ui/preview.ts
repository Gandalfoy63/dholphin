// Docs: docs/03 - Features/Trailers.md
// Purpose: staying on a card plays its trailer in a preview above it, in YouTube's own embedded player.
import type { Title } from '@/sdk/types';
import { app } from './app';
import { A, esc, ico, reduced, tvScale, TV, FADE, FADE_OUT } from './dom';
import { getLocale, t } from './i18n';

/** How long focus stays on a card before its trailer plays, and the preview's size on the 1920 x 1080 canvas. */
const WAIT = 2600, W = 768, H = 432, INFO = 72, GAP = 16;
/** Who embeds the player, as YouTube asks: the app's ID, as YouTube's rules describe for apps without a web address. */
export const APP_REFERRER = 'https://dholphin.obncckjhgfhophihkofakhmfhjnpgcch/';

let timer = 0, open: HTMLElement | null = null, moved: HTMLElement[] = [], hidden: HTMLElement | null = null;

/** Puts the row back: the card shows again, its neighbours and the rows below slide home. */
function makeRoomUndo() {
  moved.forEach((e) => (e.style.translate = ''));
  moved = [];
  hidden?.classList.remove('pvon');
  hidden = null;
}

export function closePreview() {
  clearTimeout(timer);
  const p = open;
  open = null;
  makeRoomUndo();
  if (!p) return;
  // The player goes at once, so no sound plays on while it fades.
  p.querySelector('iframe')?.remove();
  const a = A(p, FADE_OUT, { duration: 140, fill: 'forwards' });
  if (a) a.finished.then(() => p.remove(), () => p.remove());
  else p.remove();
}

/** After a while on `card`, plays the trailer of what `title()` gives then. It gives null once focus has moved on. */
export function schedulePreview(card: HTMLElement, title: () => Title | null) {
  closePreview();
  timer = window.setTimeout(() => {
    const tl = title();
    if (tl?.trailer && card.isConnected) show(card, tl);
  }, WAIT);
}

export function trailerUrl(key: string): string {
  const u = new URL(`${app.catalog.endpoints.youtube}/${encodeURIComponent(key)}`, location.href);
  const lang = getLocale().slice(0, 2);
  for (const [k, v] of Object.entries({ autoplay: '1', controls: '0', disablekb: '1', fs: '0', rel: '0', iv_load_policy: '3', playsinline: '1', hl: lang, cc_lang_pref: lang, widget_referrer: APP_REFERRER })) u.searchParams.set(k, v);
  return u.href;
}

function show(card: HTMLElement, tl: Title) {
  const tv = TV(), s = tvScale(), r = card.getBoundingClientRect(), box = tv.getBoundingClientRect();
  const left = (r.left - box.left) / s, top = (r.top - box.top) / s, w = r.width / s, h = r.height / s;
  // The card grows into the preview where it stands. Near the right edge it grows leftwards instead.
  const x = Math.max(Math.min(left, 1920 - 40 - W), 140);
  const y = Math.max(Math.min(top, 1080 - 24 - H - INFO), 24);
  // The row makes room rather than being covered: cards after slide right, cards before slide left when the
  // preview had to move left, and the rows below slide down.
  const row = card.closest<HTMLElement>('.row');
  if (row) {
    const cards = [...row.querySelectorAll<HTMLElement>('.card')], i = cards.indexOf(card);
    const before = Math.min(0, x - left), after = x + W - (left + w) + GAP;
    cards.forEach((c, j) => {
      if (j === i) return;
      c.style.translate = `${j < i ? before : after}px 0`;
      moved.push(c);
    });
    let next = row.nextElementSibling as HTMLElement | null;
    const down = y + H + INFO - (top + h) + GAP;
    for (; next; next = next.nextElementSibling as HTMLElement | null) {
      if (!next.classList.contains('row')) continue;
      next.style.translate = `0 ${down}px`;
      moved.push(next);
    }
  }
  card.classList.add('pvon');
  hidden = card;
  const p = document.createElement('div');
  p.className = 'pv';
  p.setAttribute('aria-hidden', 'true');
  p.style.cssText = `left:${x}px;top:${y}px;width:${W}px;transform-origin:${Math.min(Math.max(left + w / 2 - x, 0), W)}px 0`;
  const star = tl.scores.imdb ?? (tl.scores.tmdb ? Math.round(tl.scores.tmdb * 10) / 10 : null);
  // Nothing sits on the player: the name and scores go in a strip below it, as YouTube's rules ask.
  p.innerHTML = `<div class="pvp" style="height:${H}px"><span class="pvl">${ico('loader-circle', 's')}</span></div><div class="pvi"><b>${esc(tl.name)}</b>${star != null ? `<span class="score">${ico('star')}${Number(star).toFixed(1)}</span>` : ''}${tl.scores.tomato != null ? `<span class="score tom">${ico('tomato')}${Math.round(tl.scores.tomato)}%</span>` : ''}<span>${tl.year ?? ''}</span>${tl.certification ? `<span class="tag">${esc(tl.certification)}</span>` : ''}<span class="pvt">${ico('play', 's')}${t('Trailer')}</span></div>`;
  tv.append(p);
  open = p;
  const add = () => {
    // The player starts only once the preview is fully shown, as YouTube's rules ask.
    if (open !== p) return;
    const f = document.createElement('iframe');
    f.src = trailerUrl(tl.trailer!);
    f.title = t('Trailer of {name}', { name: tl.name });
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.tabIndex = -1;
    f.width = String(W);
    f.height = String(H);
    p.querySelector('.pvp')!.append(f);
  };
  // It grows out of the card: from the card's size to the preview's.
  const a = A(p, reduced() ? FADE : [{ opacity: 0, transform: `scale(${w / W}, ${h / (H + INFO)})` }, { opacity: 1, transform: 'none' }], { duration: 260 });
  if (a) a.finished.then(add, add);
  else add();
}

// Leaving the card, opening something or scrolling ends the preview.
document.addEventListener('focusout', () => closePreview());
document.addEventListener('wheel', () => closePreview(), { passive: true });
