// Docs: docs/03 - Features/Categories.md
// Purpose: the categories page: tiles with real artwork under a coloured gradient, and each category's own page.
import { byRating, CATEGORIES, category, deeperQueries, type Category, type CategoryQuery } from '@/core/categories';
import type { Title } from '@/sdk/types';
import { app } from './app';
import { A, $, $$, esc, RISE } from './dom';
import { go, nav } from './focus';
import { getLocale, t as tr } from './i18n';

/** A row's heading in the profile's language; a month is written as its name and year. */
function heading(q: CategoryQuery): string {
  const vars = { ...q.vars };
  if (typeof vars.month === 'string') {
    try {
      vars.month = new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(new Date(`${vars.month}T12:00:00`));
    } catch { /* the date stays as it is */ }
    vars.month = String(vars.month)[0]!.toUpperCase() + String(vars.month).slice(1);
  }
  return tr(q.heading, vars as Record<string, string | number>);
}
import { openDetails } from './details';
import { profileLang, themesByTaste, themesForYou, yourLanguages } from '@/core/bands';
import { appendEverything } from './everything';
import { artHtml, bindCards, cardHtml, loadRows, rowSkeleton, type Item, type RowDef } from './rows';

const CYCLE_MS = 3500;

async function art(c: Category): Promise<Title[]> {
  if (c.special === 'requested') return (await app.library.requests()).map((r) => r.title);
  const q = c.queries(app.today())[0];
  return q ? app.catalog.discover(q.kind, q.params) : [];
}

const tileHtml = (c: Category) => `<button class="f cat" type="button" data-cat="${c.id}" style="--tint:${c.tint}" aria-label="${esc(tr(c.name))}"><span class="cgrad"></span><span class="ctxt"><b>${esc(tr(c.name))}</b>${c.blurb ? `<span>${esc(tr(c.blurb))}</span>` : ''}</span></button>`;

/** Fills a tile with up to three backdrops, and cycles them while it has focus. */
function animateTile(tile: HTMLElement, c: Category) {
  let imgs: HTMLImageElement[] = [], at = 0, timer = 0;
  const load = async () => {
    const list = (await art(c).catch(() => [] as Title[])).filter((t) => t.backdrop).slice(0, 3);
    if (!tile.isConnected || !list.length) return;
    const grad = $('.cgrad', tile);
    imgs = list.map((t, i) => {
      const im = new Image();
      im.className = `cimg${i === 0 ? ' on' : ''}`;
      im.alt = '';
      im.decoding = 'async';
      im.src = app.catalog.image(t.backdrop, 'w780')!;
      tile.insertBefore(im, grad);
      return im;
    });
  };
  const next = () => {
    if (imgs.length < 2) return;
    imgs[at]!.classList.remove('on');
    at = (at + 1) % imgs.length;
    imgs[at]!.classList.add('on');
  };
  tile.addEventListener('focus', () => {
    clearInterval(timer);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = window.setInterval(next, CYCLE_MS);
  });
  tile.addEventListener('blur', () => clearInterval(timer));
  // Only tiles near the screen spend calls.
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) {
      io.disconnect();
      void load();
    }
  }, { rootMargin: '400px' });
  io.observe(tile);
}

export async function pageCategories(ct: HTMLElement, openCat: (id: string) => void) {
  const canReq = !!(await app.canRequest()) || (await app.library.requests()).length > 0;
  await app.engine.refreshTaste().catch(() => undefined);
  const list = CATEGORIES.filter((c) => !c.needsRequests || canReq);
  // For you: your languages and the themes you like. Themes below are ordered by your taste too.
  const forYou = [...yourLanguages(), ...themesForYou(6)];
  const themes = themesByTaste();
  ct.innerHTML = `<div class="catpage"><div class="cscroll"><h1>${tr('Categories')}</h1><div class="cfeat">${list.filter((c) => c.featured).map(tileHtml).join('')}</div>${forYou.length ? `<h2 class="cgh">${tr('For you')}</h2><div class="cgrid">${forYou.map(tileHtml).join('')}</div><h2 class="cgh">${tr('Genres and languages')}</h2>` : ''}<div class="cgrid">${list.filter((c) => !c.featured && !c.theme).map(tileHtml).join('')}</div><h2 class="cgh">${tr('Themes')}</h2><div class="cgrid">${themes.map(tileHtml).join('')}</div></div></div>`;
  const scroll = $('.cscroll', ct);
  $$('.cat', ct).forEach((tile, i) => {
    const c = category(tile.dataset.cat!)!;
    animateTile(tile, c);
    tile.onclick = () => openCat(c.id);
    tile.addEventListener('focus', () => {
      if (nav.pointer) return;
      const y = tile.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      const s = tile.getBoundingClientRect().height / tile.offsetHeight;
      scroll.style.transform = `translateY(${-Math.max(0, y / s - 160)}px)`;
    });
    if (i < 11) A(tile, [{ opacity: 0, translate: '0 32px', scale: '.94' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 460, delay: i * 55 });
  });
}

export async function pageCategory(ct: HTMLElement, id: string) {
  const c = category(id);
  if (!c) return;
  const open = (it: Item, el: HTMLElement) => void openDetails(it.title, el, it.why, it.startSec);
  if (c.special === 'requested') {
    const list = (await app.library.requests()).map((r): Item => ({ title: r.title, state: r.state }));
    const p = await app.canRequest();
    if (p?.requestState) {
      const states = new Map<string, string>();
      await Promise.all(list.map(async (i) => {
        const s = await p.requestState!(i.title).catch(() => null);
        if (s) {
          states.set(i.title.key, s);
          i.state = s;
        }
      }));
      await app.library.setRequestStates(states);
    }
    ct.innerHTML = `<div class="pg"><h1>${esc(tr(c.name))}</h1>${list.length ? `<div class="grid">${list.map((i) => cardHtml(i)).join('')}</div>` : `<div class="empty"><b style="color:var(--text)">${tr("You haven't requested anything yet")}</b>${tr("Open a title your services don't have, and choose Request.")}</div>`}</div>`;
    bindCards(ct, list, open);
    A(ct.firstElementChild, RISE, { duration: 300 });
    go($('.card', ct));
    return;
  }
  const row = (q: CategoryQuery, id: string, first: boolean): RowDef => ({
    id, heading: heading(q), poster: c.id === 'upcoming' || c.id === 'new', big: c.id === 'new' && first, minCards: first ? 1 : undefined,
    load: async () => {
      // TV programmes have their own page: categories keep to films and series.
      const titles = (await app.catalog.discover(q.kind, q.params)).filter((x) => !app.catalog.isShow(x));
      await app.primeOffers(titles);
      // New Arrivals go by rating; the others by what this profile likes.
      if (c.id === 'new') return byRating(titles.map((title) => ({ title })));
      return app.engine.rank(titles, 20).map((s) => ({ title: s.title }));
    },
  });
  const defs: RowDef[] = c.queries(app.today(), profileLang()).map((q, i) => row(q, `q${i}`, true));
  // Then deeper rows as the page scrolls, like Home: until the category has none left.
  const batches = deeperQueries(c, app.today(), profileLang());
  let next = 0;
  const more = () => (next < batches.length ? batches[next++]!.map((q, i) => row(q, `d${next}-${i}`, false)) : []);
  ct.innerHTML = `<div class="scroller"><section class="hero chero" style="--tint:${c.tint}"><span class="cgrad"></span><h1>${esc(tr(c.name))}</h1>${c.blurb ? `<p>${esc(tr(c.blurb))}</p>` : ''}</section>${defs.map(rowSkeleton).join('')}</div>`;
  art(c).then((list) => {
    const hero = $('.chero', ct), t = list.find((x) => x.backdrop);
    if (hero && t) {
      hero.insertAdjacentHTML('afterbegin', artHtml(t, 'w1280'));
      A($('img', hero), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    }
  }).catch(() => undefined);
  A($('.chero h1', ct), RISE, { duration: 320 });
  // After the deeper rows: every title of the category in one grid, sorted for you or by grade.
  const lists = c.queries(app.today(), profileLang()).filter((q) => (q.params.sort_by ?? '').toString().startsWith('popularity'));
  const every = (page: number) => Promise.all(lists.map((q) => app.catalog.discover(q.kind, { ...q.params, page }))).then((l) => l.flat().filter((x) => !app.catalog.isShow(x)));
  loadRows(ct, defs, open, undefined, more, (end) => appendEverything($('.scroller', ct), end, every, open));
  const wait = setInterval(() => {
    const first = $('.card', ct);
    if (first) {
      clearInterval(wait);
      if (ct.contains(document.activeElement) === false && !document.activeElement?.closest('.rail')) go(first);
    }
  }, 60);
  setTimeout(() => clearInterval(wait), 8000);
}
