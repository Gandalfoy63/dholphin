// Docs: docs/03 - Features/Episodes.md
// Purpose: a series' episodes as their own menu: seasons with where each stands, the season's episodes, requests by season.
import type { Episode, Provider, Title } from '@/sdk/types';
import { mergeEpisodes, mergeSeasons, type EpisodeRow, type SeasonRow } from '@/core/episodes';
import { app } from './app';
import { A, $, $$, cascade, esc, ico, leave, TV, toast } from './dom';
import { getLocale, t as tr } from './i18n';
import { go } from './focus';
import { startPlay } from './play';

/** Where a season stands, as the season column says it. */
interface Standing { label: string; tone: 'ok' | 'part' | 'asked' | 'none' }

/**
 * Opens the episodes menu. `p` is the provider that plays the series, if any: its seasons and episodes play, and
 * TMDB adds pictures, summaries and lengths, and the episodes it doesn't have. A season, or an episode, no service has
 * can be asked for through Seerr: Seerr takes whole seasons, so an episode asks for its season. Up and down move in a
 * column, left and right between seasons and episodes, Back closes onto `opener`.
 */
export async function openEpisodes(t: Title, p: Provider | null, opener: HTMLElement) {
  $('.epm', TV())?.remove();
  TV().insertAdjacentHTML('beforeend', `<div class="modal epm" role="dialog" aria-label="${esc(tr('Episodes of {name}', { name: t.name }))}"><div class="epm-in"><header><h2>${esc(t.name)}</h2><span class="muted">${tr('Episodes')}</span></header><div class="epm-body"><div class="epm-s"><div class="epm-sl" role="tablist" aria-label="${tr('Seasons')}"><span class="btn" aria-busy="true">${tr('Loading')}</span></div></div><div class="epm-right"><div class="epm-head"></div><div class="epm-clip"><div class="epm-list" role="list"></div></div></div></div></div></div>`);
  const m = $('.epm', TV()), side = $('.epm-sl', m), head = $('.epm-head', m), list = $('.epm-list', m);
  A($('.epm-in', m), [{ opacity: 0, transform: 'translateX(48px)' }, { opacity: 1, transform: 'none' }], { duration: 340 });
  A(m, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
  const shut = () => {
    leave(m);
    (window as unknown as { _mret?: () => void })._mret = undefined;
    if (opener.isConnected) go(opener);
  };
  (window as unknown as { _mret?: () => void })._mret = shut;

  const asker = t.tmdbId ? await app.canRequest() : null;
  const [fromProvider, seerr, own] = await Promise.all([
    p?.seasons ? p.seasons(t, app.profile).catch(() => []) : Promise.resolve([]),
    asker?.seasonStates ? asker.seasonStates(t).catch(() => new Map<number, string>()) : Promise.resolve(new Map<number, string>()),
    app.library.requests().then((r) => r.find((x) => x.key === t.key)?.seasons ?? []),
  ]);
  const seasons = mergeSeasons(fromProvider, t.seasonList ?? []);
  if (!m.isConnected) return;
  if (!seasons.length) {
    side.innerHTML = `<p class="muted">${tr('No episodes listed')}</p>`;
    return;
  }
  // What is known per season: how many episodes the provider has, the year, and what Seerr says.
  const have = new Map<number, number>(), years = new Map<number, string>(), watched = new Map<number, number>();
  const asked = new Set(own);
  const standing = (s: SeasonRow): Standing => {
    const n = have.get(s.number);
    if (s.provider && (n === undefined || !s.count || n >= s.count)) return { label: tr('On {name}', { name: p!.name }), tone: 'ok' };
    const st = seerr.get(s.number) ?? (asked.has(s.number) ? 'Requested' : null);
    const part = s.provider ? tr('{n} of {total} on {name}', { n: n!, total: s.count!, name: p!.name }) : '';
    // Asked for already: says so, and isn't offered again.
    if (st && st !== 'Available') return { label: part ? `${part} · ${tr(st)}` : tr(st), tone: 'asked' };
    if (part) return { label: part, tone: 'part' };
    if (st) return { label: tr(st), tone: 'ok' };
    return { label: tr('Not on your services yet'), tone: 'none' };
  };
  const askable = (s: SeasonRow) => !!asker && standing(s).tone !== 'ok' && standing(s).tone !== 'asked';
  const missing = () => seasons.filter((s) => s.number > 0 && askable(s));

  const paintSide = () => {
    const keep = document.activeElement as HTMLElement | null;
    const at = keep?.closest('.es') ? Number(keep.dataset.i) : keep?.id === 'eall' ? -2 : -1;
    const all = missing().length > 1 ? `<button class="f btn eall" id="eall" type="button">${ico('plus', 's')}${tr('Request {n} missing seasons', { n: missing().length })}</button>` : '';
    side.innerHTML = all + seasons.map((s, i) => {
      const st = standing(s), bits = [s.count ? tr(s.count === 1 ? '{n} episode' : '{n} episodes', { n: s.count }) : '', years.get(s.number) ?? '', watched.get(s.number) ? tr('{n} watched', { n: watched.get(s.number)! }) : ''].filter(Boolean).join(' · ');
      return `<button class="f es" type="button" role="tab" data-i="${i}" aria-selected="${i === shown}"><b>${esc(seasonName(s))}</b>${bits ? `<span class="muted">${esc(bits)}</span>` : ''}<span class="est ${st.tone}">${ico({ ok: 'check', part: 'circle-dashed', asked: 'clock', none: 'inbox' }[st.tone], 's')}${esc(st.label)}</span></button>`;
    }).join('');
    $$<HTMLButtonElement>('.es', side).forEach((b) => {
      b.addEventListener('focus', () => {
        slide(side, b);
        void show(Number(b.dataset.i));
      });
      b.onclick = () => go($('.er', list) ?? $('#eask', head) ?? b);
    });
    const ea = $('#eall', side);
    if (ea) {
      ea.onclick = () => void ask(missing());
      ea.addEventListener('focus', () => slide(side, ea));
    }
    if (at >= 0) go($$('.es', side)[at]!);
    else if (at === -2) go($('#eall', side) ?? $$('.es', side)[0]!);
  };

  /** Asks Seerr for seasons, then says so on each, and on the episodes listed. */
  const ask = async (want: SeasonRow[]) => {
    if (!asker?.request || !want.length) return;
    const nums = want.map((s) => s.number);
    try {
      const state = await asker.request(t, app.profile, { seasons: nums });
      await app.library.addRequest(t, state, nums);
      nums.forEach((n) => { asked.add(n); seerr.set(n, state); });
      toast(nums.length === 1 ? tr('Requested season {n} of {name}', { n: nums[0]!, name: t.name }) : tr('Requested {n} seasons of {name}', { n: nums.length, name: t.name }));
    } catch (e) {
      toast((e as Error).message);
    }
    const now = shown;
    shown = -1;
    paintSide();
    await show(now);
    go($('.er', list) ?? $$('.es', side)[now]!);
  };

  let shown = -1, ask2 = 0;
  const show = async (i: number) => {
    if (i === shown) return;
    shown = i;
    const n = ++ask2, s = seasons[i]!;
    $$('.es', side).forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    list.style.transform = 'none';
    head.innerHTML = '';
    list.innerHTML = `<span class="btn" aria-busy="true">${tr('Loading')}</span>`;
    const [mine, tmdb] = await Promise.all([
      s.provider && p?.episodes ? p.episodes(t, s.provider, app.profile).catch(() => [] as Episode[]) : Promise.resolve([] as Episode[]),
      app.catalog.season(t, s.number).catch(() => [] as Episode[]),
    ]);
    if (n !== ask2 || !m.isConnected) return;
    const eps = mergeEpisodes(mine, tmdb);
    // Now known: how many the provider has against how many there are, the year, how many you finished.
    const before = JSON.stringify([have.get(s.number), years.get(s.number), watched.get(s.number), s.count]);
    if (s.provider) have.set(s.number, eps.filter((e) => e.playable).length);
    if (!s.count && eps.length) s.count = eps.length;
    const y = eps.map((e) => e.airDate?.slice(0, 4)).find(Boolean);
    if (y) years.set(s.number, y);
    const done = eps.filter((e) => (e.progress ?? 0) >= 0.9).length;
    if (done) watched.set(s.number, done);
    if (before !== JSON.stringify([have.get(s.number), years.get(s.number), watched.get(s.number), s.count])) paintSide();
    const st = standing(s);
    head.innerHTML = `<div class="eh"><b>${esc(seasonName(s))}</b><span class="est ${st.tone}">${esc(st.label)}</span></div>${askable(s) ? `<button class="f btn pri" id="eask" type="button">${ico('plus', 's')}${tr('Request season {n}', { n: s.number })}</button>` : ''}`;
    const ea = $('#eask', head);
    if (ea) ea.onclick = () => void ask([s]);
    fillList(t, p, eps, list, shut, askable(s) ? () => ask([s]) : null, s.number);
  };
  paintSide();
  cascade($$('.es, .eall', side), { from: 'right', step: 70 });
  const start = Math.max(0, seasons.findIndex((s) => s.number >= 1));
  go($$('.es', side)[start]!);
  await show(start);
}

/** A provider's or TMDB's plain "Season 2" or "Episode 3", in any language, said in the profile's. */
const PLAIN_SEASON = /^(season|saison|temporada|staffel|stagione)\s*\d+$/i, PLAIN_EPISODE = /^(episode|épisode|episodio|folge|ep\.?)\s*\d+$/i;
const seasonName = (s: SeasonRow) => (!s.name || PLAIN_SEASON.test(s.name.trim()) ? (s.number === 0 ? tr('Specials') : tr('Season {n}', { n: s.number })) : s.name);
const episodeName = (e: EpisodeRow) => (!e.name || PLAIN_EPISODE.test(e.name.trim()) ? tr('Episode {n}', { n: e.number }) : e.name);

/** Keeps the focused entry in view in a column that slides instead of scrolling. */
function slide(col: HTMLElement, b: HTMLElement) {
  const clip = col.parentElement as HTMLElement, cs = getComputedStyle(clip);
  const room = clip.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  col.style.transform = `translateY(${-Math.max(0, Math.min(col.scrollHeight - room, b.offsetTop - room / 3))}px)`;
}

const date = (d?: string | null) => {
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T12:00:00`));
  } catch {
    return d;
  }
};

/** The season's episodes. One no service has asks for its season, when Seerr is there (`askSeason`). */
function fillList(t: Title, p: Provider | null, eps: EpisodeRow[], list: HTMLElement, shut: () => void, askSeason: (() => Promise<void>) | null, season: number) {
  if (!eps.length) {
    list.innerHTML = `<p class="muted">${tr('No episodes listed')}</p>`;
    return;
  }
  const off = askSeason ? tr('Not here yet: OK requests season {n}', { n: season }) : tr('Not on your services yet');
  list.innerHTML = eps.map((e, i) => {
    const meta = [e.runtime ? tr('{n} min', { n: e.runtime }) : '', date(e.airDate)].filter(Boolean).join(' · ');
    return `<button class="f er ${e.playable ? '' : 'off'}" type="button" role="listitem" data-i="${i}" aria-label="${esc(`${e.number}. ${episodeName(e)}${e.playable ? '' : `, ${off}`}`)}"><span class="ers">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy"${e.alt ? ` data-alt="${esc(e.alt)}"` : ''}>` : ''}${ico('tv')}${e.playable ? `<span class="erp">${ico('play', 's')}</span>` : ''}${e.progress ? `<span class="prog"><i style="transform:scaleX(${e.progress})"></i></span>` : ''}</span><span class="ert"><b>${e.number}. ${esc(episodeName(e))}</b>${meta ? `<span class="muted">${esc(meta)}</span>` : ''}<span class="ero">${esc(e.overview || tr('No summary yet'))}</span>${e.playable ? '' : `<span class="tag">${esc(off)}</span>`}</span></button>`;
  }).join('');
  // A picture that doesn't load gives way to TMDB's, else to the plain tile under it.
  $$<HTMLImageElement>('.ers img', list).forEach((img) => img.addEventListener('error', () => {
    if (img.dataset.alt) {
      img.src = img.dataset.alt;
      delete img.dataset.alt;
    } else img.remove();
  }));
  $$<HTMLButtonElement>('.er', list).forEach((b) => {
    const e = eps[Number(b.dataset.i)]!;
    // Keep the focused episode in view: the list slides, the page doesn't scroll.
    b.addEventListener('focus', () => slide(list, b));
    b.onclick = () => {
      if (e.playable && p) {
        shut();
        return void startPlay(p, t, e);
      }
      if (askSeason) return void askSeason();
      toast(tr('Not on your services yet'));
    };
  });
  cascade($$('.er', list), { from: 'right', step: 60, max: 6 });
}
