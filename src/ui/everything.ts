// Docs: docs/03 - Features/Home Rows.md
// Purpose: the end of a rows page: every title it covers in one grid, sorted for you or by grade, loading as you go.
import type { Title } from '@/sdk/types';
import { rankGrade } from '@/core/grades';
import { app } from './app';
import { A, $, $$, cascade, esc, RISE, touch } from './dom';
import { t as tr } from './i18n';
import { bindCards, cardHtml, type Item } from './rows';

export type Sort = 'you' | 'grade' | 'name' | 'new';
const SORT_LABEL: Record<Sort, string> = { you: 'For you', grade: 'Best rated', name: 'A to Z', new: 'Recently added' };
/**
 * `heading` replaces "All titles"; `sorts` are the orders offered, the first one on; `added` dates a title for
 * Recently added (else its release); `bare` keeps titles without a picture (a home video).
 */
export interface EverythingOptions { heading?: string; sorts?: Sort[]; added?: (t: Title) => number; bare?: boolean }
/** How many titles show at once, and how many source pages are asked for each time the list runs low. */
const CHUNK = 40, PAGES = 4;

/**
 * Adds the grid after `after`, inside the page's `scroller`. `source(page)` gives one page of the titles the page is
 * about (Home: films and series; Series; Movies; Anime; a category's own lists). Titles come once each. Sorting
 * applies to what is loaded; titles loaded later are sorted among themselves and added below, so nothing above moves.
 */
export function appendEverything(scroller: HTMLElement, after: Element, source: (page: number) => Promise<Title[]>, open: (it: Item, el: HTMLElement) => void, o: EverythingOptions = {}) {
  if ($('.every', scroller)) return;
  const sorts = o.sorts ?? ['you', 'grade'], heading = o.heading ?? tr('All titles');
  after.insertAdjacentHTML('afterend', `<section class="every" aria-label="${esc(heading)}"><div class="every-head"><h2>${esc(heading)}</h2><div class="btns" role="group" aria-label="${esc(tr('Sort'))}">${sorts.map((s, i) => `<button class="f chip" type="button" data-sort="${s}" aria-pressed="${i === 0}">${tr(SORT_LABEL[s])}</button>`).join('')}</div></div><div class="grid every-grid"></div><p class="muted every-end" hidden>${tr("That's everything")}</p></section>`);
  const sec = $('.every', scroller), grid = $('.every-grid', sec);
  A($('.every-head', sec), RISE, { duration: 380 });
  let sort: Sort = sorts[0]!, page = 1, done = false, busy = false;
  const seen = new Set<string>();
  // Sorted blocks: each one loaded at once and sorted on its own; shown block after block.
  const blocks: Title[][] = [];
  let shown = 0;

  const order = async (list: Title[]): Promise<Title[]> => {
    if (sort === 'you') return (await app.engine.byAffinity(list.map((title) => ({ title })))).map((i) => i.title);
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    if (sort === 'new') {
      const at = (x: Title) => o.added?.(x) ?? (Date.parse(x.release ?? '') || (x.year ? Date.UTC(x.year, 0) : 0));
      return [...list].sort((a, b) => at(b) - at(a));
    }
    // By grade, weighed by votes: a 10 from one vote doesn't come before a 8.5 from a hundred thousand.
    const g = (x: Title) => rankGrade(x, app.catalog.overall(x)?.value);
    return [...list].sort((a, b) => g(b) - g(a));
  };
  const fetchBlock = async () => {
    if (done || busy) return;
    busy = true;
    const got = (await Promise.all(Array.from({ length: PAGES }, (_, i) => source(page + i).catch(() => [] as Title[])))).flat();
    page += PAGES;
    const fresh = got.filter((x) => !seen.has(x.key) && (o.bare || x.backdrop || x.poster) && seen.add(x.key));
    if (!fresh.length) done = true;
    else blocks.push(await order(fresh));
    busy = false;
  };
  const all = () => blocks.flat();
  /** Shows the next titles, asking the source for more when the loaded ones run out. */
  const grow = async () => {
    if (all().length - shown < CHUNK) await fetchBlock();
    const list = all().slice(shown, shown + CHUNK);
    if (!list.length) {
      $('.every-end', sec).hidden = !done;
      return;
    }
    const items: Item[] = list.map((title) => ({ title }));
    // Bound in a holder of their own, so each card meets its title, then moved into the grid.
    const holder = document.createElement('div');
    holder.innerHTML = items.map((i) => cardHtml(i)).join('');
    bindCards(holder, items, open);
    const cards = [...holder.children];
    grid.append(...cards);
    cascade(cards.slice(0, 10), { from: 'pop', step: 35 });
    shown += list.length;
  };
  /** Sorting again sorts every loaded title as one list and starts the grid over. */
  const resort = async (s: Sort) => {
    sort = s;
    $$('[data-sort]', sec).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === s)));
    const one = await order(all());
    blocks.length = 0;
    blocks.push(one);
    grid.innerHTML = '';
    shown = 0;
    await grow();
  };
  $$<HTMLButtonElement>('[data-sort]', sec).forEach((b) => (b.onclick = () => void resort(b.dataset.sort as Sort)));

  // The page moves to keep the focused card in view; near the last cards, more are added.
  sec.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    let y = 0, n: HTMLElement | null = el;
    while (n && n !== scroller) {
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    if (!touch()) scroller.style.transform = `translateY(${-Math.max(0, y - 220)}px)`;
    const cards = $$('.card', grid);
    if (el.classList.contains('card') && cards.indexOf(el) > cards.length - 11) void grow();
  });
  void grow();
}
