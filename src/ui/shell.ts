// Docs: docs/03 - Features/Sidebar.md
// Purpose: the sidebar and the routing between its pages.
import type { Params } from '@/core/catalog';
import { appendEverything } from './everything';
import { bindSetup, setupHtml } from './setup';
import { linkServer, panelHtml, unlinkServer } from './serverlink';
import { animeRows, homeRows, likesAnime, tvShowRows, type Kinds } from '@/core/homerows';
import { SHOW_NETWORKS, SHOW_TYPES } from '@/core/tvshows';
import { profileLang } from '@/core/bands';
import { isAnime } from '@/core/sources';
import type { Title } from '@/sdk/types';
import { app, KEY_FIELDS } from './app';
import { A, $, $$, cascade, esc, ico, logoMark, plogo, TV, toast, FADE, FADE_OUT, RISE } from './dom';
import { closeDetails, openDetails } from './details';
import { focusables, go, nav } from './focus';
import { pageCategories, pageCategory } from './categories';
import { actionLabel, connectProvider } from './onboarding';
import { startPlay } from './play';
import { loadPrefs, savePrefs } from './player';
import { getLocale, LANGUAGES, setLocale, t, t as tr } from './i18n';
import { avatar, showLines } from './profiles';
import { setReturnContext } from './returning';
import { artHtml, bindCards, cardHtml, heroHtml, loadRows, rowSkeleton, type Item } from './rows';
import { bindKeyboard, keyboardHtml } from './textentry';

export interface Route { id: string }
const NAV: [string, string, string][] = [['search', 'search', 'Search'], ['home', 'house', 'Home'], ['series', 'tv', 'Series'], ['movies', 'clapperboard', 'Movies'], ['anime', 'sparkles', 'Anime'], ['tvshows', 'mic-vocal', 'TV Shows'], ['categories', 'layout-grid', 'Categories'], ['list', 'bookmark', 'My List'], ['history', 'history', 'History'], ['requests', 'inbox', 'Requests']];
let route = 'home';
let lastContent: HTMLElement | null = null;
let backArmed = 0;
let toProfiles: () => void = () => undefined;
let restart: () => void = () => undefined;

export function showShell(start = 'home', hooks: { profiles: () => void; onboarding: () => void }) {
  toProfiles = hooks.profiles;
  restart = hooks.onboarding;
  route = start;
  const p = app.profile;
  // The profile loader, if up, stays on top until Home has something to show.
  [...TV().children].forEach((c) => c.classList.contains('pload') || c.remove());
  TV().insertAdjacentHTML('afterbegin', `<div class="content" id="ct"></div><aside class="rail" aria-label="${t('Main menu')}" data-off="1"><span class="rpill" aria-hidden="true"></span><span class="rbar" aria-hidden="true"></span><div class="rmark"><span style="display:block;width:56px;flex:none">${logoMark('var(--surface)')}</span><span class="rname">dholphin</span></div><nav>${NAV.map(([id, ic, l]) => `<button class="f ni" type="button" data-go="${id}">${id === 'requests' ? plogo('seerr.svg') : ico(ic)}<span>${t(l)}</span></button>`).join('')}</nav><button class="f ni" type="button" data-go="settings">${ico('settings')}<span>${t('Settings')}</span></button><button class="f ni" type="button" data-go="who" aria-label="${t('Switch profile')}">${avatar(p)}<span>${esc(p.name)}</span></button></aside>`);
  $$('.ni', TV()).forEach((b) => (b.onclick = () => (b.dataset.go === 'who' ? toProfiles() : go2(b.dataset.go!))));
  // A plain page (History, My List, search results, Requests, Settings) slides to keep what has focus in view: these
  // pages used to stop at the bottom of the screen. Pages built of rows move on their own.
  $('#ct', TV()).addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement, pg = el.closest<HTMLElement>('.pg');
    if (!pg || el.closest('.row, .modal')) return;
    let y = 0, n: HTMLElement | null = el;
    while (n && n !== pg) {
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    const most = Math.max(0, pg.scrollHeight - 1080);
    pg.style.transform = `translateY(${-Math.min(most, Math.max(0, y - 360))}px)`;
  });
  // A highlight glides to whichever item has focus, rather than each item lighting up on its own.
  const rail = $('.rail', TV());
  rail.addEventListener('focusin', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.ni');
    if (b) rail.style.setProperty('--py', `${topIn(rail, b)}px`);
  });
  nav.openRail = openRail;
  nav.closeRail = () => closeRail(true);
  nav.onBack = onBack;
  setReturnContext(() => ({ route, profileId: app.profile.id }));
  void app.canRequest().then((q) => {
    if (!q) $('.ni[data-go="requests"]', TV())?.setAttribute('hidden', '');
  });
  mark();
  void render(true);
}

function onBack() {
  const m = $('.modal', TV());
  if (m) {
    const shut = (window as unknown as { _mret?: () => void })._mret;
    if (shut) shut();
    else m.remove();
    return;
  }
  if ($('.dlayer', TV())) return closeDetails();
  if ($('.rail.open', TV())) {
    if (route === 'home') {
      if (Date.now() - backArmed < 3000) return app.host.close();
      backArmed = Date.now();
      toast(t('Press Back again to close Dholphin'));
    }
    closeRail(true);
    return;
  }
  if (route.startsWith('cat:')) return go2('categories');
  if (route !== 'home') return go2('home');
  openRail();
}
function mark() {
  $$('.ni', TV()).forEach((b) => {
    const on = b.dataset.go === route || (route.startsWith('cat:') && b.dataset.go === 'categories');
    b.classList.toggle('cur', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // The red marker slides to the page you are on.
  const cur = $('.ni.cur', TV()), rail = $('.rail', TV());
  if (cur && rail) rail.style.setProperty('--by', `${topIn(rail, cur) + 12}px`);
}
/** An item's top inside the menu: the list is its own box (it moves with the menu), so offsets add up to the menu. */
function topIn(rail: HTMLElement, el: HTMLElement) {
  let y = el.offsetTop, p = el.offsetParent as HTMLElement | null;
  while (p && p !== rail) {
    y += p.offsetTop;
    p = p.offsetParent as HTMLElement | null;
  }
  return y;
}
function openRail() {
  const r = $('.rail', TV());
  if (!r || r.classList.contains('open')) return;
  lastContent = document.activeElement as HTMLElement;
  r.classList.add('open');
  r.removeAttribute('data-off');
  showLabels(r);
  go($('.ni.cur', r) ?? $('.ni', r));
}
/** The menu's text arrives as it opens: the name, then each label in turn. */
function showLabels(r: HTMLElement) {
  // The logo turns in, each icon gives a small lift, and each label follows its icon.
  A($('.rmark svg', r), [{ rotate: '-14deg', scale: '.82' }, { rotate: '0deg', scale: '1' }], { duration: 520 });
  $$('.rname,.ni>span:not(.av)', r).forEach((s, i) => A(s, [{ opacity: 0, translate: '-18px 0' }, { opacity: 1, translate: '0 0' }], { duration: 280, delay: 30 + i * 18 }));
  $$('.ni>.ic,.ni>.plogo,.ni>.av', r).forEach((s, i) => A(s, [{ scale: '.78' }, { scale: '1.08', offset: 0.6 }, { scale: '1' }], { duration: 380, delay: 20 + i * 18 }));
}
function closeRail(ret: boolean) {
  const r = $('.rail', TV());
  if (!r) return;
  r.classList.remove('open');
  r.setAttribute('data-off', '1');
  if (ret) go(lastContent?.isConnected ? lastContent : focusables($('#ct', TV()))[0]);
}
TVReady(() => {
  // A real pointer move, so a menu appearing under a still cursor doesn't reopen itself.
  TV().addEventListener('mousemove', (e) => {
    const r = (e.target as Element).closest?.<HTMLElement>('.rail');
    if (r && !r.classList.contains('open')) {
      lastContent = document.activeElement as HTMLElement;
      r.classList.add('open');
      r.removeAttribute('data-off');
      showLabels(r);
    }
  });
  TV().addEventListener('mouseout', (e) => {
    const r = $('.rail.open', TV());
    const to = e.relatedTarget as Element | null;
    if (r && (e.target as Element).closest?.('.rail') && !to?.closest?.('.rail') && !r.contains(document.activeElement)) closeRail(false);
    else if (r && (e.target as Element).closest?.('.rail') && !to?.closest?.('.rail') && nav.pointer) closeRail(true);
  });
});
function TVReady(fn: () => void) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

export function go2(id: string) {
  route = id;
  closeRail(false);
  mark();
  const ct = $('#ct', TV());
  if (ct.firstElementChild) A(ct.firstElementChild, FADE_OUT, { duration: 120, fill: 'forwards' });
  setTimeout(() => void render(false), 120);
}

async function render(first: boolean) {
  const ct = $('#ct', TV());
  const open = (it: Item, el: HTMLElement) => void openDetails(it.title, el, it.why, it.startSec);
  // Anime shows on Home, Series and Movies once the profile has picked, liked or watched one; the Anime page always has it.
  const noAnime = ['home', 'series', 'movies'].includes(route) && !(await likesAnime().catch(() => true));
  // TV programmes (talk shows, reality, the Palmashow...) live on their own page, never in the other lists.
  const anime = (x: Title) => !app.catalog.isShow(x) && (!noAnime || !isAnime(x));
  if (route === 'home') await rowsPage(ct, anime, first, 'all');
  else if (route === 'series') await rowsPage(ct, (x) => x.kind === 'series' && anime(x), false, 'series');
  else if (route === 'movies') await rowsPage(ct, (x) => x.kind === 'movie' && anime(x), false, 'movie');
  else if (route === 'tvshows') await rowsPage(ct, (x) => app.catalog.isShow(x), false, 'series', tvShowRows, async () => {
    // Programmes in the profile's language first; with none, any.
    const mine = await app.catalog.discover('tv', { with_type: SHOW_TYPES, with_original_language: profileLang(), sort_by: 'popularity.desc' });
    return mine.length ? mine : app.catalog.discover('tv', { with_networks: Object.keys(SHOW_NETWORKS).join('|'), sort_by: 'popularity.desc' });
  }, {},
    // All TV shows: by type and by channel.
    (page) => Promise.all([{ with_type: SHOW_TYPES }, { with_networks: Object.keys(SHOW_NETWORKS).join('|') }].map((q) => app.catalog.discover('tv', { sort_by: 'popularity.desc', ...q, page }))).then((l) => l.flat()));
  else if (route === 'anime') await rowsPage(ct, (x) => isAnime(x) && !app.catalog.isShow(x), false, 'all', animeRows, async () => (await Promise.all((['tv', 'movie'] as const).map((k) => app.catalog.discover(k, { with_genres: 16, with_original_language: 'ja', sort_by: 'popularity.desc' })))).flat(), { with_genres: 16, with_original_language: 'ja' });
  else if (route === 'categories') await pageCategories(ct, (id) => go2(`cat:${id}`));
  else if (route.startsWith('cat:')) await pageCategory(ct, route.slice(4));
  else await ({ search: pageSearch, list: pageList, history: pageHistory, requests: pageRequests, settings: pageSettings } as Record<string, (c: HTMLElement) => Promise<void> | void>)[route]!(ct);
  void open;
  // Other pages: the heading rises, then their items (results, list, history, providers) arrive one by one.
  if (!['home', 'series', 'movies', 'anime', 'tvshows'].includes(route) && !route.startsWith('cat:') && route !== 'categories') {
    const items = $$('.grid > *, .lst > *, .prov', ct);
    A($('h1', ct) ?? ct.firstElementChild, RISE, { duration: 380 });
    if (items.length) cascade(items, { delay: 80 });
    else A(ct.firstElementChild, FADE, { duration: 300 });
  }
  if (!$('.dlayer', TV()) && !ct.contains(document.activeElement)) go(focusables(ct)[0]);
}

async function rowsPage(ct: HTMLElement, filter: (t: Title) => boolean, first: boolean, kinds: Kinds, build: (f: (t: Title) => boolean, k: Kinds) => ReturnType<typeof homeRows> = homeRows, heroPool?: () => Promise<Title[]>, extra: Params = {}, source?: (page: number) => Promise<Title[]>) {
  const open = (it: Item, el: HTMLElement) => void openDetails(it.title, el, it.why, it.startSec);
  await app.engine.refreshTaste().catch(() => undefined); // Your genres decide the order of the rows.
  const { rows: defs, more: feed } = build(filter, kinds);
  // The rows end after four more batches (about fifty rows); then the page lists every title it covers.
  let batches = 0;
  const more = () => (batches++ < 4 ? feed() : []);
  const every = source ? (page: number) => source(page).then((l) => l.filter(filter)) : (page: number) => Promise.all((kinds === 'all' ? (['movie', 'tv'] as const) : kinds === 'series' ? (['tv'] as const) : (['movie'] as const))
    .map((k) => app.catalog.discover(k, { sort_by: 'popularity.desc', 'vote_count.gte': 20, ...extra, page }))).then((l) => l.flat().filter(filter));
  ct.innerHTML = `<div class="scroller"><section class="hero" aria-busy="true"></section>${defs.map(rowSkeleton).join('')}</div>`;
  const d = first ? 140 : 0;
  const scroller = $('.scroller', ct);
  // The hero is the best pick for this profile, and it won't appear again in a row below it.
  const heroPick = (async () => {
    await app.engine.refreshPool();
    const seen = [...(await app.library.resting())];
    await app.primeOffers(app.engine.topPicks(40, seen).map((s) => s.title));
    const pick = app.engine.topPicks(40, seen).find((s) => filter(s.title));
    if (pick || !heroPool) return pick;
    // A page whose titles Top Picks rarely holds (Anime): the one from its own pool this profile is most likely to like.
    const pool = (await heroPool().catch(() => [] as Title[])).filter((x) => filter(x) && !seen.includes(x.key) && x.backdrop);
    const best = (await app.engine.byAffinity(pool.map((title) => ({ title }))))[0];
    return best ? { title: best.title, reason: tr(route === 'tvshows' ? 'Popular TV shows' : 'Popular anime') } : undefined;
  })();
  loadRows(ct, defs, open, heroPick.then((x) => x?.title.key ?? null), more, (end) => appendEverything(scroller, end, every, open));
  try {
    const pick = await heroPick;
    if (!scroller.isConnected) return;
    // Nothing to feature: the page starts with its rows rather than an empty space.
    if (!pick) return void $('.hero', scroller)?.remove();
    let t = pick.title;
    t = await app.catalog.full(t).catch(() => t);
    const old = $('.hero', scroller);
    old.outerHTML = heroHtml(t);
    const hero = $('.hero', scroller);
    A($('.art,.noart', hero), FADE, { duration: 320, delay: d });
    $$('.htext>*', hero).forEach((e, i) => A(e, RISE, { duration: 320, delay: d + 60 + i * 40 }));
    const list = async () => (await app.library.inList(t.key));
    const hl = $('.hl', hero);
    const paint = async () => (hl.innerHTML = `${ico((await list()) ? 'check' : 'plus', 's')}${tr('My List')}`);
    await paint();
    hl.onclick = async () => {
      const on = await app.library.toggleList(t);
      await paint();
      toast(tr(on ? 'Added {name} to My List' : 'Removed {name} from My List', { name: t.name }));
    };
    $('.hi', hero).onclick = () => void openDetails(t, $('.hi', hero), pick.reason);
    $('.hp', hero).onclick = async () => {
      const offers = (await app.offers(t)).filter((o) => o.state === 'playable');
      if (offers[0]) await startPlay(offers[0].provider, t);
      else void openDetails(t, $('.hp', hero), pick.reason);
    };
    if (!ct.contains(document.activeElement) && !$('.dlayer', TV()) && !document.activeElement?.closest('.rail')) go($('.hp', hero));
  } catch (e) {
    showFailure(ct, e as Error);
  }
}

function showFailure(ct: HTMLElement, e: Error) {
  if ($('.card', ct)) {
    $('.hero', ct)?.remove();
    return;
  }
  ct.innerHTML = `<div class="pg cfail"><h1>${tr('Nothing could load')}</h1><p class="muted">${esc(t(e.message))}</p><div class="btns"><button class="f btn pri" id="rt" type="button">${ico('rotate-ccw', 's')}${tr('Try again')}</button><button class="f btn" id="tos" type="button">${tr('Settings')}</button></div></div>`;
  $('#rt', ct).onclick = () => void render(false);
  $('#tos', ct).onclick = () => go2('settings');
  go($('#rt', ct));
}

function pageSearch(ct: HTMLElement) {
  let q = '', kind: 'all' | 'movie' | 'series' = 'all', timer = 0, seq = 0;
  ct.innerHTML = `<div class="pg"><h1>${t('Search')}</h1><div class="srch"><div class="stack"><div class="nm" aria-live="polite"></div>${keyboardHtml(false)}<div class="btns" id="kf">${(['all', 'movie', 'series'] as const).map((k) => `<button class="f chip" type="button" data-k2="${k}" aria-pressed="${k === 'all'}">${t({ all: 'All', movie: 'Movies', series: 'Series' }[k])}</button>`).join('')}</div></div><div id="res" style="min-width:0"></div></div></div>`;
  const res = $('#res', ct);
  const draw = async () => {
    const me = ++seq, nm = $('.nm', ct) as HTMLElement | null;
    // Typed, then left Search before the pause ran out: nothing to draw into.
    if (!nm) return;
    nm.textContent = q;
    if (!q.trim()) {
      res.innerHTML = '<div class="empty"><b style="color:var(--text)">' + t('Try a title, a person or a genre') + '</b>' + t('Results appear as you type.') + '</div>';
      return;
    }
    res.setAttribute('aria-busy', 'true');
    try {
      const raw = (await app.catalog.search(q)).filter((t) => kind === 'all' || t.kind === kind);
      if (me !== seq) return;
      const ranked = app.engine.searchOrder(q, raw);
      const rest = raw.filter((t) => !ranked.includes(t));
      const list = [...ranked, ...rest].slice(0, 9).map((title): Item => ({ title }));
      res.innerHTML = list.length ? `<div class="grid" style="grid-template-columns:repeat(3,320px)">${list.map((i) => cardHtml(i)).join('')}</div>` : `<div class="empty"><b style="color:var(--text)">${esc(t('Nothing for "{q}"', { q }))}</b>${t('Check the spelling, or try a genre.')}</div>`;
      bindCards(res, list, (it, el) => void openDetails(it.title, el));
      cascade($$('.card', res), { from: 'pop', step: 45 });
    } catch (e) {
      res.innerHTML = `<div class="empty"><b style="color:var(--text)">${t("Search isn't working")}</b>${esc(t((e as Error).message))}</div>`;
    }
    res.removeAttribute('aria-busy');
  };
  bindKeyboard(ct, (k) => {
    q = k === 'del' ? q.slice(0, -1) : (q + k).slice(0, 40);
    $('.nm', ct).textContent = q;
    clearTimeout(timer);
    timer = window.setTimeout(() => void draw(), 250);
  });
  $$('[data-k2]', ct).forEach((c) => (c.onclick = () => {
    kind = c.dataset.k2 as typeof kind;
    $$('[data-k2]', ct).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    void draw();
  }));
  void draw();
}

async function pageList(ct: HTMLElement) {
  const list = (await app.library.list()).map((e): Item => ({ title: e.title }));
  ct.innerHTML = `<div class="pg"><h1>${t('My List')}</h1>${list.length ? `<div class="grid">${list.map((i) => cardHtml(i)).join('')}</div>` : `<div class="empty"><b style="color:var(--text)">${t('Your list is empty')}</b>${t('Open a title and choose My List to save it here.')}</div><div><button class="f btn" type="button" id="bh">${t('Browse Home')}</button></div>`}</div>`;
  bindCards(ct, list, (it, el) => void openDetails(it.title, el));
  $('#bh', ct)?.addEventListener('click', () => go2('home'));
}

/**
 * History: everything this profile watched, started or marked as seen, newest first, by day (Today, Yesterday,
 * the days of this week, then each month). Films or series only, more as it goes, and a download as CSV.
 */
async function pageHistory(ct: HTMLElement, kind: 'all' | 'movie' | 'series' = 'all', count = 40) {
  const all = await app.library.history();
  const h = all.filter((e) => kind === 'all' || e.title.kind === kind);
  const loc = getLocale(), day0 = new Date().setHours(0, 0, 0, 0), DAY = 86_400_000;
  const group = (at: number) => {
    if (at >= day0) return t('Today');
    if (at >= day0 - DAY) return t('Yesterday');
    if (at >= day0 - 6 * DAY) return new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(at).replace(/^./, (c) => c.toUpperCase());
    return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(at).replace(/^./, (c) => c.toUpperCase());
  };
  const time = (at: number) => new Intl.DateTimeFormat(loc, at >= day0 - 6 * DAY ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(at);
  const shown = h.slice(0, count);
  let last = '', i = -1;
  const rows = shown.map((e) => {
    i++;
    const g = group(e.at), head = g !== last ? `<h2 class="hgrp">${esc(g)}</h2>` : '';
    last = g;
    const state = e.seen ? `<span class="tag">${t('Seen')}</span>` : e.progress >= 0.9 ? `<span class="tag ok">${t('Finished')}</span>` : `<span class="hprog"><span class="ibar"><i style="transform:scaleX(${e.progress})"></i></span><span class="muted">${Math.round(e.progress * 100)}%</span></span>`;
    const sub = [t(e.title.kind === 'series' ? 'Series' : 'Movie'), e.label && !e.seen ? e.label : '', time(e.at), e.provider ? (app.provider(e.provider)?.name ?? '') : ''].filter(Boolean).join(' · ');
    return `${head}<div class="hrow"><button class="f li" type="button" data-i="${i}">${artHtml(e.title, 'w500')}<span class="g"><b>${esc(e.title.name)}</b><span>${esc(sub)}</span></span>${state}</button><button class="f btn" data-del="${i}" type="button" aria-label="${esc(t('Remove {name} from History', { name: e.title.name }))}" title="${esc(t('Remove from History'))}">${ico('trash-2', 's')}</button></div>`;
  }).join('');
  ct.innerHTML = `<div class="pg"><div class="hhead"><h1>${t('History')}</h1><span class="muted">${esc(t(h.length === 1 ? '{n} title' : '{n} titles', { n: h.length }))}</span></div>${all.length ? `<div class="btns">${(['all', 'movie', 'series'] as const).map((k) => `<button class="f chip" type="button" data-hk="${k}" aria-pressed="${k === kind}">${t({ all: 'All', movie: 'Movies', series: 'Series' }[k])}</button>`).join('')}<button class="f btn" id="csv" type="button">${ico('download', 's')}${t('Download as CSV')}</button></div><div class="lst">${rows}</div>${h.length > count ? `<div><button class="f btn" id="hmore" type="button">${t('Show more')}</button></div>` : ''}` : `<div class="empty"><b style="color:var(--text)">${t('Nothing watched yet')}</b>${t('What you watch on this profile appears here.')}</div>`}</div>`;
  $$('.li', ct).forEach((b) => (b.onclick = () => void openDetails(shown[Number(b.dataset.i)]!.title, b)));
  $$('[data-del]', ct).forEach((b) => (b.onclick = async () => {
    const n = Number(b.dataset.del);
    await app.library.removeHistory(shown[n]!.key);
    await pageHistory(ct, kind, count);
    go($$('[data-del]', ct)[Math.min(n, $$('[data-del]', ct).length - 1)] ?? focusables(ct)[0]);
  }));
  $$('[data-hk]', ct).forEach((b) => (b.onclick = async () => {
    await pageHistory(ct, b.dataset.hk as typeof kind);
    go($(`[data-hk="${b.dataset.hk}"]`, ct));
  }));
  const more = $('#hmore', ct);
  if (more) more.onclick = async () => {
    await pageHistory(ct, kind, count + 40);
    go($$('.li', ct)[count] ?? focusables(ct)[0]);
  };
  $('#csv', ct)?.addEventListener('click', async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await app.library.historyCsv()], { type: 'text/csv' }));
    a.download = 'dholphin-history.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

const pageRequests = (ct: HTMLElement) => pageCategory(ct, 'requested');

async function pageSettings(ct: HTMLElement) {
  const rows = await Promise.all(app.providers.map(async (p) => ({ p, s: await p.status(app.profile) })));
  const pp = await loadPrefs();
  ct.innerHTML = `<div class="pg" style="gap:20px"><h1>${t('Settings')}</h1><div class="stack">${rows.map(({ p, s }) => `<div class="prov"><span class="plogos">${p.logos.map(plogo).join('')}</span><div class="i"><b>${esc(p.name)}</b><span class="muted">${esc(t(p.onOff?.() ? s.detail ?? 'Off' : s.connected ? 'Connected' : s.detail ?? 'Not connected'))}</span></div><button class="f btn" type="button" data-p="${p.id}">${actionLabel(p, s.connected)}</button></div>`).join('')}<div class="prov"><span class="plogos">${ico('settings')}</span><div class="i"><b>${t('Film data keys')}</b><span class="muted">${esc(keySummary())}</span></div><button class="f btn" type="button" id="ks">${t('Change')}</button></div>${app.host.phoneForm ? `<div class="prov"><span class="plogos">${ico('settings')}</span><div class="i"><b>${t('Set up from your phone')}</b><span class="muted">${t('Keys, Jellyfin, Seerr and every profile, without starting setup again')}</span></div><button class="f btn" type="button" id="sph">${t('Show the code')}</button></div>` : ''}<div class="prov"><span class="plogos">${ico('globe')}</span><div class="i"><b>${t('Dholphin server')}</b><span class="muted">${esc(app.server ? (app.server.linked ? t('Linked to {origin}', { origin: app.server.origin }) : t('This app runs on your Dholphin server')) : t('Not linked: this device keeps its own data'))}</span></div><div class="btns">${app.server ? `<button class="f btn" type="button" id="srvp">${t('Server panel')}</button>${app.server.linked ? `<button class="f btn" type="button" id="srvu">${t('Unlink')}</button>` : ''}` : `<button class="f btn" type="button" id="srvl">${t('Link to a Dholphin server')}</button>`}</div></div><div class="prov"><span class="plogos">${ico('rotate-ccw')}</span><div class="i"><b>${t('Setup')}</b><span class="muted">${t('See the setup steps again')}</span></div><button class="f btn" type="button" id="ro">${t('Start again')}</button></div><div class="prov"><span class="plogos">${ico('globe')}</span><div class="i"><b>${t('Language')}</b><span class="muted">${t('For the interface, titles and summaries')}</span></div><div class="btns" id="lg">${LANGUAGES.map(([c, n]) => `<button class="f chip" type="button" data-l="${c}" aria-pressed="${c === app.profile.language}">${n}</button>`).join('')}</div></div><div class="prov"><span class="plogos">${ico('play')}</span><div class="i"><b>${t('Playback')}</b><span class="muted">${t('In the Jellyfin player')}</span></div><div class="btns" id="pb"><button class="f chip" type="button" data-pp="autoSkip" aria-pressed="${pp.autoSkip}">${t('Skip intros by themselves')}</button><button class="f chip" type="button" data-pp="autoNext" aria-pressed="${pp.autoNext}">${t('Play the next episode by itself')}</button></div></div></div><p class="muted" style="font-size:20px">Film data from TMDB and OMDb. This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability from JustWatch, through TMDB. Dholphin ${__VERSION__}.</p></div>`;
  $$('[data-p]', ct).forEach((b) => (b.onclick = async () => {
    const p = app.provider(b.dataset.p!)!;
    const connected = rows.find((r) => r.p === p)!.s.connected;
    if (connected) {
      await p.disconnect?.(app.profile);
      toast(t(p.onOff?.() ? 'Turned off {name}' : 'Disconnected {name}', { name: p.name }));
      await pageSettings(ct);
      go(focusables(ct)[0]);
    } else await connectProvider(p, app.profile, async () => {
      await pageSettings(ct);
      go(focusables(ct)[0]);
    });
  }));
  $$('[data-pp]', ct).forEach((b) => (b.onclick = async () => {
    const k = b.dataset.pp as 'autoSkip' | 'autoNext';
    pp[k] = !pp[k];
    b.setAttribute('aria-pressed', String(pp[k]));
    await savePrefs(pp);
  }));
  $('#ks', ct).onclick = () => editKeys(ct);
  // The server: link this TV, or its panel (opened here in a browser, shown as a code on a TV), or unlink.
  $('#srvl', ct)?.addEventListener('click', () => linkServer());
  $('#srvu', ct)?.addEventListener('click', () => {
    if (confirm(t('Unlink this TV? It goes back to keeping its own data.'))) void unlinkServer();
  });
  $('#srvp', ct)?.addEventListener('click', async () => {
    if (!app.server?.linked && app.host.id === 'browser') return void window.open(app.server!.panel, '_blank', 'noopener');
    const ret = $('#srvp', ct);
    TV().insertAdjacentHTML('beforeend', `<div class="modal"><div class="panel" style="gap:16px">${await panelHtml()}<div class="btns"><button class="f btn" id="spx" type="button">${t('Close')}</button></div></div></div>`);
    const m = $('.modal:last-child', TV());
    const shut = () => { m.remove(); (window as unknown as { _mret?: () => void })._mret = undefined; go(ret); };
    (window as unknown as { _mret?: () => void })._mret = shut;
    $('#spx', m).onclick = shut;
    go($('#spx', m));
  });
  const sph = $('#sph', ct);
  if (sph) sph.onclick = () => {
    TV().insertAdjacentHTML('beforeend', `<div class="modal"><div class="panel" style="gap:16px">${setupHtml()}<div class="btns"><button class="f btn" id="spc" type="button">${t('Close')}</button></div></div></div>`);
    const m = $('.modal:last-child', TV());
    const setup = bindSetup(m, (lines) => {
      shut();
      void pageSettings(ct).then(() => showLines(t('From your phone'), lines));
    });
    const shut = () => {
      void setup.then((stop) => stop());
      m.remove();
      (window as unknown as { _mret?: () => void })._mret = undefined;
      go(sph);
    };
    (window as unknown as { _mret?: () => void })._mret = shut;
    $('#spc', m).onclick = shut;
    go($('#spc', m));
  };
  $('#ro', ct).onclick = () => restart();
  $$('[data-l]', ct).forEach((b) => (b.onclick = async () => {
    app.profile.language = b.dataset.l!;
    await app.saveProfiles();
    await app.store.set('uiLang', b.dataset.l);
    setLocale(b.dataset.l!);
    app.catalog.use(app.profile);
    // Everything on screen, the menu included, is redrawn in the new language.
    showShell('settings', { profiles: toProfiles, onboarding: restart });
    setTimeout(() => go($(`[data-l="${b.dataset.l}"]`, TV())), 200);
  }));
}

function editKeys(ct: HTMLElement) {
  void connectProviderLikeKeys(ct);
}
async function connectProviderLikeKeys(ct: HTMLElement) {
  const fake = {
    id: 'keys', name: t('Film data keys'), logos: [],
    blurb: KEY_FIELDS.map((f) => `${t(f.label)}: ${f.where}`).join(' · '),
    fields: KEY_FIELDS.map((f) => ({ key: f.key, label: t(f.label), optional: f.optional })),
    values: async () => app.keyValues(),
    status: async () => ({ connected: true }),
    connect: async (_p: unknown, v: Record<string, string>) => {
      if (!(await app.catalog.checkTmdb(v.tmdb ?? ''))) throw new Error(t('TMDB refused this key'));
      await app.saveKeys(v);
    },
  };
  await connectProvider(fake as never, app.profile, () => void pageSettings(ct));
}

/** Which keys are set: "TMDB, Trakt set · OMDb, Google missing". */
function keySummary() {
  const v = app.keyValues(), name = (k: string) => ({ tmdb: 'TMDB', omdb: 'OMDb', trakt: 'Trakt', google: 'Google' })[k]!;
  const set = KEY_FIELDS.filter((f) => v[f.key]).map((f) => name(f.key)), unset = KEY_FIELDS.filter((f) => !v[f.key]).map((f) => name(f.key));
  return [set.length ? t('{list} set', { list: set.join(', ') }) : '', unset.length ? t('{list} missing', { list: unset.join(', ') }) : ''].filter(Boolean).join(' · ');
}

declare const __VERSION__: string;
