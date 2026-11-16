// Docs: docs/03 - Features/Home Rows.md
// Purpose: Home's section tiles (Series, Movies, Anime, TV Shows), always the second row, each pictured by its best title of the month.
import { profileLang } from '@/core/bands';
import { monthBest, monthQuery, type Section } from '@/core/monthbest';
import { isAnime } from '@/core/sources';
import type { Title } from '@/sdk/types';
import { app } from './app';
import { $, $$, A, esc, ico } from './dom';
import { t } from './i18n';
import { arrowsHtml, artHtml } from './rows';

/** The sections, with the sidebar's icon for each (the sidebar takes them from here). */
export const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'series', label: 'Series', icon: 'tv-minimal-play' },
  { id: 'movies', label: 'Movies', icon: 'film' },
  { id: 'anime', label: 'Anime', icon: 'origami' },
  { id: 'tvshows', label: 'TV Shows', icon: 'radio-tower' },
];

/** What fits each section once fetched: no anime among Series and Movies, only programmes among TV Shows. */
const fits = (s: Section, x: Title) => (s === 'anime' ? isAnime(x) : s === 'tvshows' ? true : !isAnime(x) && !app.catalog.isShow(x));

/** The month's best per section, per profile and day: worked out once, then kept until the day changes. */
const picked = new Map<string, Promise<Title | undefined>>();
function bestOf(s: Section): Promise<Title | undefined> {
  const key = `${app.profile.id}:${app.today()}:${s}`;
  let hit = picked.get(key);
  if (!hit) {
    hit = (async () => {
      const q = monthQuery(s, app.today(), profileLang());
      let list = (await app.catalog.discover(q.kind, q.params)).filter((x) => fits(s, x));
      // TV programmes in the profile's language may be few: any language then.
      if (!list.length && s === 'tvshows') list = await app.catalog.discover(q.kind, { ...q.params, with_original_language: undefined });
      return monthBest(list, await app.engine.affinity(list).catch(() => new Map<string, number>()));
    })();
    picked.set(key, hit);
    hit.catch(() => picked.delete(key));
  }
  return hit;
}

const tileHtml = (s: (typeof SECTIONS)[number]) => `<button class="f card sect" type="button" data-sect="${s.id}" aria-label="${esc(t(s.label))}"><span class="sscrim"></span><span class="sname">${ico(s.icon)}<b>${esc(t(s.label))}</b></span><span class="sbest muted"></span></button>`;

/** The row, as Home's rows are built: a `.row` of `.card`s, so the remote moves through it as through any row. */
export const sectionsHtml = () => `<section class="row sects s0 send" data-row="sections" data-start="0"><h2>${t('Explore')}</h2>${arrowsHtml()}<div class="track">${SECTIONS.map(tileHtml).join('')}</div></section>`;

/** Opens a section on OK, and puts each tile's picture in as its month's best arrives. */
export function bindSections(root: ParentNode, to: (route: string) => void) {
  const row = $('.row.sects', root as HTMLElement);
  if (!row) return;
  $$<HTMLElement>('[data-sect]', row).forEach((b) => {
    const s = SECTIONS.find((x) => x.id === b.dataset.sect)!;
    b.onclick = () => to(s.id);
    const plain = () => $('.sbest', b)?.remove();
    void bestOf(s.id).then((best) => {
      if (!b.isConnected) return;
      // Nothing this month (or TMDB didn't answer): the tile stays plain, its name on the surface.
      if (!best) return plain();
      const line = t('Best this month: {name}', { name: best.name });
      b.insertAdjacentHTML('afterbegin', artHtml(best, 'w780', 'backdrop'));
      $('.sbest', b).textContent = line;
      b.setAttribute('aria-label', `${t(s.label)}. ${line}`);
      const img = $('img', b);
      if (img) A(img, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    }).catch(plain);
  });
}

/**
 * Keeps the tiles the second row on Home, whichever row turns out first: Continue Watching hides itself when there is
 * nothing to continue, and the tiles then follow the next row that shows. Watches until the first rows have settled.
 */
export function keepSecond(scroller: HTMLElement) {
  const sect = $('.row.sects', scroller);
  if (!sect) return;
  const place = () => {
    const first = $$<HTMLElement>('.row', scroller).find((r) => r !== sect && !r.hidden);
    if (first && first.nextElementSibling !== sect && !sect.contains(document.activeElement)) first.after(sect);
  };
  const mo = new MutationObserver(place);
  mo.observe(scroller, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  setTimeout(() => mo.disconnect(), 20_000);
  place();
}
