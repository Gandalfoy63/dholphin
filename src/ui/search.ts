// Docs: docs/03 - Features/Search.md
// Purpose: the Search page: a line to type in, filters, people, and titles ordered by match, then by what fits the profile.
import type { Actor } from '@/core/catalog';
import { GENRE_IDS } from '@/core/bands';
import { category } from '@/core/categories';
import type { Title } from '@/sdk/types';
import { app } from './app';
import { $, $$, cascade, esc, ico } from './dom';
import { openDetails } from './details';
import { go } from './focus';
import { t } from './i18n';
import { openPerson } from './person';
import { artHtml, bindCards, cardHtml, type Item } from './rows';
import { bindLine, lineHtml, nativeTyping } from './textentry';

type Kind = 'all' | 'movie' | 'series' | 'mine';
const FILTERS: [Kind, string][] = [['all', 'All'], ['movie', 'Movies'], ['series', 'Series'], ['mine', 'Available to me']];
/** Titles shown at once; Show more adds as many. */
const STEP = 12;
const RECENT = 8;
const recentKey = () => `search:recent:${app.profile.id}`;

async function remember(q: string) {
  const s = q.trim();
  if (s.length < 2) return;
  const was = (await app.store.get<string[]>(recentKey())) ?? [];
  await app.store.set(recentKey(), [s, ...was.filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, RECENT));
}

/** The page. `openCategory` goes to a genre's category, from the suggestions. */
export function pageSearch(ct: HTMLElement, openCategory: (id: string) => void) {
  let q = '', kind: Kind = 'all', timer = 0, seq = 0, shown = STEP;
  let found: Title[] = [], people: Actor[] = [];
  const native = nativeTyping();
  ct.innerHTML = `<div class="pg"><h1>${t('Search')}</h1><div class="srch${native ? ' native' : ''}"><div class="stack">${lineHtml({ label: t('Titles, people, genres'), max: 40, type: 'search' })}<div class="btns" id="kf" role="group" aria-label="${esc(t('Show'))}">${FILTERS.map(([k, l]) => `<button class="f chip" type="button" data-k2="${k}" aria-pressed="${k === 'all'}">${t(l)}</button>`).join('')}</div></div><div id="res" style="min-width:0" aria-live="polite"></div></div></div>`;
  const res = $('#res', ct);
  const open = (it: Item, el: HTMLElement) => {
    void remember(q);
    void openDetails(it.title, el);
  };
  const chip = (attr: string, label: string, icon: string) => `<button class="f chip" type="button" ${attr}>${ico(icon, 's')}${esc(label)}</button>`;
  /** Recent searches and the profile's top genres: something to start from, before typing or when nothing matched. */
  const suggestions = async (head: string, sub: string) => {
    const recent = (await app.store.get<string[]>(recentKey())) ?? [];
    const genres = app.engine.topGenres(4).map((g) => GENRE_IDS[g]).filter((id): id is string => !!id && !!category(id));
    res.innerHTML = `<div class="empty"><b style="color:var(--text)">${esc(head)}</b>${esc(sub)}</div>${recent.length ? `<h2 class="sh">${t('Recent searches')}</h2><div class="btns">${recent.map((r, i) => chip(`data-rq="${i}"`, r, 'history')).join('')}</div>` : ''}${genres.length ? `<h2 class="sh">${t('Your genres')}</h2><div class="btns">${genres.map((id) => chip(`data-cat="${id}"`, t(category(id)!.name), 'layout-grid')).join('')}</div>` : ''}`;
    $$('[data-rq]', res).forEach((b) => (b.onclick = () => {
      setLine(recent[Number(b.dataset.rq)]!);
      go($('input.line', ct) ?? b);
    }));
    $$('[data-cat]', res).forEach((b) => (b.onclick = () => openCategory(b.dataset.cat!)));
  };
  const visible = () => found.filter((x) => kind === 'all' || (kind === 'mine' ? app.availabilityOf(x) === 'playable' : x.kind === kind));
  /**
   * Categories the results point to, for "Categories you might like": the genres of what was found (the first results
   * weigh most), then the profile's own; four, each pictured by a title found in it.
   */
  const likelyCategories = (list: Title[]) => {
    const weight = new Map<string, number>();
    list.slice(0, 24).forEach((x, i) => x.genres.forEach((g) => {
      const id = GENRE_IDS[g];
      if (id && category(id)) weight.set(id, (weight.get(id) ?? 0) + 1 / (1 + i / 6));
    }));
    for (const g of app.engine.topGenres(6)) {
      const id = GENRE_IDS[g];
      if (id && category(id) && !weight.has(id)) weight.set(id, 0.01);
    }
    return [...weight].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => ({ id, pic: list.find((x) => x.backdrop && x.genres.some((g) => GENRE_IDS[g] === id)) }));
  };
  /** Draws what was found: four people, four categories, then titles (people and categories only under All). */
  const paint = (animate: boolean) => {
    const list = visible(), items = list.slice(0, shown).map((title): Item => ({ title }));
    const all = kind === 'all';
    const ppl = all ? people.slice(0, 4) : [];
    const cats = all && list.length ? likelyCategories(list) : [];
    if (!items.length && !ppl.length) {
      const why = kind === 'mine' && found.length ? t('None of these play on your services. Try All.') : t('Check the spelling, or try a genre.');
      return void suggestions(t('Nothing for "{q}"', { q }), why);
    }
    const head = (label: string) => `<h2 class="sh">${esc(label)}</h2>`;
    res.innerHTML = `${ppl.length ? `${head(t('People'))}<div class="sppl" role="list">${ppl.map((p, i) => `<button class="f sp" type="button" role="listitem" data-p="${i}" aria-label="${esc(p.name)}"><span class="spic">${p.photo ? `<img src="${esc(app.catalog.image(p.photo, 'w185') ?? '')}" alt="" loading="lazy">` : ''}${ico('user-round')}</span><span class="stx"><b>${esc(p.name)}</b>${p.known.length ? `<span class="muted">${esc(p.known.join(', '))}</span>` : ''}</span></button>`).join('')}</div>` : ''}${cats.length ? `${head(t('Categories you might like'))}<div class="scats" role="list">${cats.map((c) => `<button class="f scat" type="button" role="listitem" data-cat="${c.id}">${c.pic ? artHtml(c.pic, 'w780', 'backdrop') : ''}<span class="sscrim"></span><b>${esc(t(category(c.id)!.name))}</b></button>`).join('')}</div>` : ''}${items.length ? `${all && (ppl.length || cats.length) ? head(t('Titles')) : ''}<div class="grid sgrid">${items.map((i) => cardHtml(i)).join('')}</div>` : ''}${list.length > shown ? `<div><button class="f btn" id="smore" type="button">${t('Show more')}</button></div>` : ''}`;
    bindCards($('.sgrid', res) ?? res, items, open);
    $$<HTMLImageElement>('.sp img', res).forEach((img) => img.addEventListener('error', () => img.remove()));
    $$('[data-p]', res).forEach((b) => (b.onclick = () => {
      void remember(q);
      const p = ppl[Number(b.dataset.p)]!;
      void openPerson({ id: p.id, name: p.name }, b, (it, el) => void openDetails(it.title, el));
    }));
    $$('.scat', res).forEach((b) => (b.onclick = () => {
      void remember(q);
      openCategory(b.dataset.cat!);
    }));
    const more = $('#smore', res);
    if (more) more.onclick = () => {
      const at = shown;
      shown += STEP;
      paint(false);
      go($$('.sgrid .card', res)[at] ?? $('#smore', res));
    };
    if (animate) cascade($$('.sp, .scat, .sgrid .card', res), { from: 'pop', step: 40 });
  };
  const draw = async () => {
    const me = ++seq;
    // Typed, then left Search before the pause ran out: nothing to draw into.
    if (!res.isConnected) return;
    shown = STEP;
    if (!q.trim()) {
      found = [];
      people = [];
      return void suggestions(t('Try a title, a person or a genre'), t('Results appear as you type.'));
    }
    res.setAttribute('aria-busy', 'true');
    try {
      const [{ titles: raw, loose }, ppl] = await Promise.all([app.search(q), app.catalog.searchPeople(q).catch(() => [] as Actor[])]);
      if (me !== seq) return;
      // Where each plays, then the order: text match, then how likely the profile likes it and can play it here.
      await app.primeOffers(raw).catch(() => undefined);
      const ordered = await app.engine.searchOrder(q, raw, loose);
      if (me !== seq || !res.isConnected) return;
      found = ordered;
      people = ppl;
      paint(true);
    } catch (e) {
      res.innerHTML = `<div class="empty"><b style="color:var(--text)">${t("Search isn't working")}</b>${esc(t((e as Error).message))}</div>`;
    }
    res.removeAttribute('aria-busy');
  };
  const setLine = bindLine(ct, { max: 40, onValue: (v) => {
    q = v;
    clearTimeout(timer);
    timer = window.setTimeout(() => void draw(), 250);
  } });
  // The system keyboard's Search key: on to the results.
  $<HTMLInputElement>('input.line', ct)?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    void draw().then(() => go($('.sp, .card', res) ?? $('[data-k2]', ct)));
  });
  $$('[data-k2]', ct).forEach((c) => (c.onclick = () => {
    kind = c.dataset.k2 as Kind;
    $$('[data-k2]', ct).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    shown = STEP;
    if (q.trim()) paint(true);
  }));
  void draw();
}
