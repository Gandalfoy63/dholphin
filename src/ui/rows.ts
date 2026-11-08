// Docs: docs/03 - Features/Home Rows.md
// Purpose: a hero and rows of cards. Rows load on their own, and an empty row hides itself.
import type { Title } from '@/sdk/types';
import { app } from './app';
import { $, $$, A, FADE, RISE, TV, cascade, esc, ico, plogo, viaApp } from './dom';
import { focusRow, go, nav } from './focus';
import { t as tr } from './i18n';
import { schedulePreview } from './preview';

export interface Item { title: Title; progress?: number; why?: string; n?: number; startSec?: number; state?: string }
export interface RowDef { id: string; heading: string; logo?: string; poster?: boolean; /** Bigger posters, four to a screen. */ big?: boolean; keepAll?: boolean; ranked?: boolean; /** Keeps its own order (already ranked, or by date) instead of the profile's likely liking. */ fixed?: boolean; separator?: boolean; minCards?: number; load: () => Promise<Item[]> }

/** Card width plus gap, and how many fit on screen, by shape. */
const STEP = { wide: 340, poster: 260, big: 380, ranked: 340 }, FITS = { wide: 5, poster: 6, big: 4, ranked: 5 };
const items = new WeakMap<HTMLElement, Item>();
export const itemOf = (el: HTMLElement) => items.get(el);

/**
 * One grade out of 10 summing up every score known for the title (TMDB, IMDb, Rotten Tomatoes, Metacritic, and
 * Trakt, TVmaze, AniList, MyAnimeList once asked). `count` adds how many sources it sums up.
 */
export const scoresHtml = (t: Title, count = false) => {
  const o = app.catalog.overall(t);
  if (!o) return t.scores.tomato != null ? `<span class="score tom" title="${esc(tr('Tomato score'))}">${ico('tomato')}${Math.round(t.scores.tomato)}%</span>` : '';
  const tip = tr('Average of {list}', { list: o.sources.join(', ') });
  // Rotten Tomatoes stays shown on its own too, beside the overall grade it is part of.
  const tomato = t.scores.tomato != null ? `<span class="score tom" title="${esc(tr('Tomato score'))}">${ico('tomato')}${Math.round(t.scores.tomato)}%</span>` : '';
  return `<span class="score" title="${esc(tip)}">${ico('star')}${o.value.toFixed(1)}</span>${tomato}${count && o.sources.length > 1 ? `<span class="gsrc muted" title="${esc(tip)}">${esc(tr('{n} sources', { n: o.sources.length }))}</span>` : ''}`;
};
const ageHtml = (t: Title) => (t.certification ? `<span class="tag">${esc(t.certification)}</span>` : '');
/**
 * What focus reveals. Posters carry the name in their art: a chip at the top right with stars, Tomato, year and age.
 * Wide cards: stars and Tomato at the top right, the name with the age at the bottom.
 */
const overlay = (t: Title, poster: boolean) => {
  const s = scoresHtml(t);
  return `<span class="ov${s ? '' : ' none'}"><span class="scores">${s}</span></span>${poster ? `<span class="oa">${t.year ? `<span class="oy">${t.year}</span>` : ''}${ageHtml(t)}</span>` : ''}`;
};
const nameHtml = (t: Title) => `<span class="ct"><span class="cn">${esc(t.name)}</span><span class="ca">${ageHtml(t)}</span></span>`;

/**
 * A title's picture. Loaded at once by default: the browser's own lazy loading can't be trusted here, because rows
 * slide (transform) rather than scroll, and some TV browsers then never see a picture come into view. Only cards far
 * along a row start `lazy`, and `wake` loads them as focus nears.
 */
const JF_WIDTH = { w300: 400, w342: 360, w500: 500, w780: 800, w1280: 1280 } as const;
export function artHtml(t: Title, size: 'w300' | 'w500' | 'w780' | 'w1280' = 'w500', prefer: 'backdrop' | 'poster' = 'backdrop', eager = true) {
  // A card is 320 by 180 (posters 240 by 360): w300 backdrops and w342 posters are enough, a third of w500's weight.
  const path = prefer === 'backdrop' ? t.backdrop ?? t.poster : t.poster ?? t.backdrop;
  const want = size === 'w300' && path === t.poster ? 'w342' : size;
  // Jellyfin resizes on request: its pictures are asked for at the card's size too, not 1280 wide.
  const src = app.catalog.image(path, want)?.replace(/([?&]fillWidth=)\d+/, `$1${JF_WIDTH[want]}`);
  return src ? `<img class="art" src="${esc(viaApp(src))}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async">` : '<span class="noart"></span>';
}
/** Loads a card's picture now if it was waiting. */
const wake = (el: Element | undefined) => {
  const img = el?.querySelector<HTMLImageElement>('img.art');
  if (img && img.loading !== 'eager') img.loading = 'eager';
};

export function cardHtml(it: Item, attrs = '', poster = false, big = false, eager = true) {
  const t = it.title, art = !!(poster ? t.poster ?? t.backdrop : t.backdrop ?? t.poster);
  return `<button class="f card ${poster ? 'poster' : ''} ${big ? 'big' : ''} ${art ? '' : 'named'} ${it.n ? 'ten' : ''}" type="button" ${attrs} aria-label="${esc(t.name)}" data-y="${t.year ?? ''}">${artHtml(t, big ? 'w780' : 'w300', poster ? 'poster' : 'backdrop', eager)}<span class="band"></span>${it.n ? `<span class="num">${it.n}</span>` : ''}${it.state ? `<span class="state ${it.state === 'Available' ? 'av' : it.state === 'Downloading' ? 'dl' : ''}">${esc(tr(it.state))}</span>` : ''}${!poster || !art ? nameHtml(t) : ''}${overlay(t, poster)}${it.progress ? `<span class="prog"><i style="transform:scaleX(${it.progress})"></i></span>` : ''}</button>`;
}
/** Binds items to cards inside a container, in order. */
export function bindCards(root: ParentNode, list: Item[], open: (it: Item, el: HTMLElement) => void) {
  $$('.card', root).forEach((c, i) => {
    const it = list[i]!;
    items.set(c, it);
    c.onclick = () => open(it, c);
  });
}

let tick = 0;
/** Focus on a card: shine, then stars, Tomato score, year and age on the card itself, then after a while the trailer. */
function reveal(el: HTMLElement) {
  const it = items.get(el);
  if (!it) return;
  const me = ++tick;
  setTimeout(() => {
    if (me !== tick || document.activeElement !== el) return;
    A($('.band', el), [{ opacity: 0.16, transform: 'translateX(0) rotate(18deg)' }, { opacity: 0.16, transform: 'translateX(520px) rotate(18deg)' }], { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)' });
    el.classList.add('rev');
  }, 70);
  // Usually its neighbour already loaded it (`primeAround`): the grade is there at once. Otherwise, held still for a
  // moment, it loads now and fades in.
  if (primed.has(el) || app.catalog.hasScores(it.title)) void prime(el, false);
  else setTimeout(() => {
    if (me === tick && document.activeElement === el) void prime(el, true);
  }, 150);
  // Staying on a card plays its trailer, in a preview above it.
  schedulePreview(el, () => (me === tick && document.activeElement === el ? it.title : null));
}

/** Cards whose grade and age rating are loaded, or loading. */
const primed = new WeakSet<HTMLElement>();

/** Loads a card's full scores and age rating and puts them on it. `fade` only for the card in focus that had to wait. */
async function prime(el: HTMLElement, fade: boolean) {
  wake(el);
  const it = items.get(el);
  if (!it?.title.tmdbId) return;
  primed.add(el);
  const full = await app.catalog.full(it.title).catch(() => null);
  if (!full || !el.isConnected) return;
  it.title = { ...it.title, ...full };
  const ov = $('.ov', el), oa = el.querySelector('.oa'), html = overlay(it.title, el.classList.contains('poster'));
  if (ov && ov.outerHTML + (oa?.outerHTML ?? '') !== html) {
    oa?.remove();
    ov.outerHTML = html;
    if (fade && el.classList.contains('rev')) A($('.ov', el), FADE, { duration: 200 });
  }
  const ca = el.querySelector('.ca');
  if (ca) ca.innerHTML = ageHtml(it.title);
}

/**
 * The cards around what has focus, in every direction: the two on each side in its row, and in the rows above and
 * below the nearest card and the ones beside it. Loading them ahead means a card shows its grade the moment it is
 * reached, without a flicker.
 */
function neighbours(el: HTMLElement): HTMLElement[] {
  const out = new Set<HTMLElement>();
  const besides = (c: HTMLElement, reach: number) => {
    const cs = $$('.card', c.parentElement!), i = cs.indexOf(c);
    for (let d = -reach; d <= reach; d++) if (cs[i + d]) out.add(cs[i + d]!);
  };
  if (el.classList.contains('card')) besides(el, 1);
  // Only the rows just above and below are measured: measuring every card on the page forced a layout each time.
  const row = el.closest('.row'), near = row ? [prevRow(row), nextRow(row)].filter((x): x is HTMLElement => !!x) : [];
  if (!near.length) return [...out].filter((c) => c !== el);
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cards = near.flatMap((x) => $$('.card', x)).map((c) => ({ c, b: c.getBoundingClientRect() }));
  for (const dir of [-1, 1]) {
    let best: HTMLElement | null = null, score = Infinity;
    for (const { c, b } of cards) {
      const dy = (b.top + b.height / 2 - cy) * dir, dx = Math.abs(b.left + b.width / 2 - cx);
      if (c === el || dy < 30) continue;
      const s = dy * 2 + dx;
      if (s < score) [best, score] = [c, s];
    }
    if (best) besides(best, 1);
  }
  out.delete(el);
  return [...out];
}

let aheadTimer = 0;
document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  clearTimeout(aheadTimer);
  // Only once focus rests a moment: racing along a row doesn't spend calls on every card passed.
  aheadTimer = window.setTimeout(() => {
    if (document.activeElement !== el) return;
    for (const c of neighbours(el)) if (!primed.has(c)) void prime(c, false);
  }, 250);
});

const isRow = (x: Element | null): x is HTMLElement => !!x && x.classList.contains('row') && !(x as HTMLElement).hidden;
function prevRow(r: Element): HTMLElement | null {
  let x = r.previousElementSibling;
  while (x && !isRow(x)) x = x.previousElementSibling;
  return x as HTMLElement | null;
}
function nextRow(r: Element): HTMLElement | null {
  let x = r.nextElementSibling;
  while (x && !isRow(x)) x = x.nextElementSibling;
  return x as HTMLElement | null;
}
/**
 * The row holding focus is marked `fr` (the rows below step down under its zoomed card), and rows far from it are
 * marked `far`, which skips drawing them. Set here rather than with `:has(.card:focus)`, which made the browser
 * check every row below on each move.
 */
let litRow: HTMLElement | null = null;
document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  // Back up to the hero (the showcase): the page goes back to its top, or the hero stays above the screen.
  const hero = el.closest?.('.hero'), sc = hero?.closest<HTMLElement>('.scroller');
  if (sc && !nav.pointer) sc.style.transform = 'none';
  const row = el.classList?.contains('card') ? el.closest<HTMLElement>('.row') : null;
  if (row === litRow) return;
  litRow?.classList.remove('fr');
  litRow = row;
  if (!row) return;
  row.classList.add('fr');
  const all = [...(row.parentElement?.children ?? [])].filter(isRow), at = all.indexOf(row);
  all.forEach((x, k) => x.classList.toggle('far', Math.abs(k - at) > 3));
  // The first pictures of the next two rows load before focus gets there.
  for (const x of [all[at + 1], all[at + 2]]) if (x) $$('.card', x).slice(0, 7).forEach(wake);
});

function onCard(el: HTMLElement) {
  const row = el.closest<HTMLElement>('.row');
  if (row) {
    const cards = $$('.card', row), i = cards.indexOf(el), was = row.dataset.last === undefined || row.dataset.n !== String(cards.length) ? -1 : Number(row.dataset.last);
    row.dataset.n = String(cards.length);
    row.dataset.last = String(i);
    let st = Number(row.dataset.start ?? 0);
    if (i < st) st = i;
    const shape = row.classList.contains('ranked') ? 'ranked' : row.classList.contains('big') ? 'big' : row.classList.contains('tall') ? 'poster' : 'wide';
    if (i > st + FITS[shape] - 1) st = i - FITS[shape] + 1;
    row.dataset.start = String(st);
    $('.track', row).style.transform = `translateX(${-st * STEP[shape]}px)`;
    // The pictures of the cards about to come into view load now.
    for (let j = i; j <= i + FITS[shape] + 2; j++) wake(cards[j]);
    // Only the cards between the old and the new place change side: fewer style changes on each move.
    const from = was < 0 ? 0 : Math.min(was, i), to = was < 0 ? cards.length - 1 : Math.max(was, i);
    for (let j = from; j <= to; j++) {
      cards[j]!.classList.toggle('bf', j < i);
      cards[j]!.classList.toggle('af', j > i);
    }
    const s = row.closest<HTMLElement>('.scroller');
    if (s && !nav.pointer) s.style.transform = $('.chero', s) && row === $('.row:not([hidden])', s) ? 'none' : `translateY(${-(row.offsetTop - 80)}px)`;
  }
  reveal(el);
}
nav.onCard = onCard;
document.addEventListener('focusout', (e) => (e.target as HTMLElement).classList?.remove('rev'));

export interface HeroOptions { title: Title; why?: string; play: () => void; more: (el: HTMLElement) => void }

export function heroHtml(t: Title) {
  return `<section class="hero">${artHtml(t, 'w1280')}<div class="scrim"></div><div class="htext"><h1>${esc(t.name)}</h1><div class="meta">${scoresHtml(t)}<span>${t.year ?? ''}</span>${t.certification ? `<span class="tag">${esc(t.certification)}</span>` : ''}<span>${esc((t.genreLabels?.length ? t.genreLabels : t.genres).slice(0, 3).join(', '))}</span></div><p style="max-width:760px">${esc(t.overview.length > 200 ? `${t.overview.slice(0, 197)}...` : t.overview)}</p><div class="btns"><button class="f btn lt hp" type="button">${ico('play', 's')}${tr('Play')}</button><button class="f btn hi" type="button">${ico('info', 's')}${tr('More info')}</button><button class="f btn hl" type="button">${ico('plus', 's')}${tr('My List')}</button></div></div></section>`;
}

export function rowSkeleton(def: RowDef) {
  return `<section class="row loading ${def.poster ? 'tall' : ''} ${def.big ? 'big' : ''} ${def.ranked ? 'ranked' : ''} ${def.separator ? 'sep' : ''}" data-row="${esc(def.id)}" data-start="0"><h2 class="${def.logo ? 'hasl' : ''}">${def.logo ? plogo(def.logo) : ''}${esc(def.heading)}</h2><div class="track">${`<div class="skc ${def.poster ? 'tall' : ''} ${def.big ? 'big' : ''}"></div>`.repeat(def.big ? 4 : def.poster ? 6 : 5)}</div></section>`;
}

/** How many rows load at once, and the fewest cards worth a row after repeats are removed. */
const EAGER = 8, MIN_CARDS = 4, ROW_CARDS = 20;

/**
 * Fills rows top to bottom, as they near the screen. A title appears once on the page: each row takes what the rows
 * above left. `keepAll` rows are the exceptions, such as a ranking, or what you're watching. With `more`, the page
 * has no end: nearing the bottom adds the next batch of rows, until `more` gives none.
 */
const ROW_WAIT_MS = 8_000;

export function loadRows(root: HTMLElement, defs: RowDef[], open: (it: Item, el: HTMLElement) => void, reserved: Promise<string | null> = Promise.resolve(null), more?: () => RowDef[], onEnd?: (end: HTMLElement) => void) {
  defs = [...defs];
  const seen = new Set<string>();
  let chain: Promise<unknown> = reserved.then((k) => k && seen.add(k)).catch(() => undefined);
  let started = 0, settled: ((order: number) => void) | undefined;
  const start = (upTo: number) => {
    while (started <= upTo && started < defs.length) {
      const order = started++, def = defs[order]!;
      const row = $(`.row[data-row="${def.id}"]`, root);
      // Rows show in order, each after the one above: a row still waiting after 8 seconds hides, so it never holds up the rest.
      const data = Promise.race([def.load(), new Promise<Item[]>((_, no) => setTimeout(() => no(new Error('took too long')), ROW_WAIT_MS))]).catch((e) => {
        console.warn(`Row ${def.id}:`, e);
        return [] as Item[];
      });
      chain = chain.then(async () => {
        // Every row is ordered for the profile, most likely liked first, before the first cards are taken: except rows
        // whose order means something (Continue Watching, Top Picks, Top 10, Upcoming, My List, Requested).
        // Watched, started or marked seen in the last 15 days: kept out (Continue Watching and lists that keep all aside).
        const resting = def.keepAll ? new Set<string>() : await app.library.resting().catch(() => new Set<string>());
        const loaded = (await data).filter((i) => !resting.has(i.title.key));
        const all = def.keepAll || def.ranked || def.fixed ? loaded : await app.engine.byAffinity(loaded);
        if (!row.isConnected) return;
        // Same name counts as the same film too: a viewer can't tell two entries called Doctor Who apart.
        const same = (i: Item) => seen.has(i.title.key) || seen.has(i.title.name.toLowerCase());
        const fresh: Item[] = [];
        for (const i of all) {
          if (def.keepAll || !same(i)) fresh.push(i);
          if (!def.keepAll) {
            seen.add(i.title.name.toLowerCase());
            if (fresh.length >= ROW_CARDS) break;
          }
        }
        const list = fresh;
        if (!list.length || (!def.keepAll && list.length < (def.minCards ?? MIN_CARDS))) {
          row.hidden = true;
          return;
        }
        list.forEach((i) => {
          seen.add(i.title.key);
          seen.add(i.title.name.toLowerCase());
        });
        row.classList.remove('loading');
        if (!def.logo) $('h2', row).textContent = def.heading;
        const track = $('.track', row);
        // The pictures on screen at first load at once; the rest as focus nears them (`wake`), so a TV doesn't fetch
        // and decode a hundred pictures before it can answer the remote.
        track.innerHTML = list.map((i, n) => cardHtml(i, '', def.poster, def.big, order < 3 && n < 7)).join('');
        bindCards(track, list, open);
        // Every row's cards arrive one by one as it fills (rows fill as they near the screen).
        cascade($$('.card', track).slice(0, 7), { step: 60 });
      });
      chain = chain.then(() => settled?.(order));
    }
  };
  start(EAGER - 1);
  const clip = root.closest<HTMLElement>('.content') ?? root;
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) start(defs.findIndex((d) => d.id === (e.target as HTMLElement).dataset.row));
  }, { root: clip, rootMargin: '1400px 0px' });
  $$('.row', root).forEach((r) => io.observe(r));
  if (!more) return;
  const end = document.createElement('div');
  end.className = 'rowend';
  end.setAttribute('aria-hidden', 'true');
  ($('.scroller', root) ?? root).append(end);
  let batchFrom = 0, waiting = false, emptyBatches = 0;
  const grow = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting) || !end.isConnected) return;
    // One batch at a time: the next waits until the last row of this one has loaded or hidden itself.
    if (started < defs.length || waiting) return;
    const batch = more();
    if (!batch.length) {
      grow.disconnect();
      return onEnd?.(end);
    }
    batchFrom = defs.length;
    waiting = true;
    end.insertAdjacentHTML('beforebegin', batch.map(rowSkeleton).join(''));
    defs.push(...batch);
    batch.forEach((d) => io.observe($(`.row[data-row="${d.id}"]`, root)));
  }, { root: clip, rootMargin: '2400px 0px' });
  settled = (order) => {
    if (order !== defs.length - 1) return;
    waiting = false;
    // Offline, every row hides: stop after three empty batches instead of asking for ever.
    emptyBatches = defs.slice(batchFrom).every((d) => $(`.row[data-row="${d.id}"]`, root).hidden) ? emptyBatches + 1 : 0;
    if (emptyBatches >= 3) {
      grow.disconnect();
      return onEnd?.(end);
    }
    // Observing again reports whether the end is near, so hidden rows that left it in view still bring more.
    grow.unobserve(end);
    grow.observe(end);
  };
  grow.observe(end);
}
