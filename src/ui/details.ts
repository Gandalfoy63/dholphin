// Docs: docs/03 - Features/Title Details.md
// Purpose: a title's full view: reason, source logo and name, play, episodes menu, request, list, ratings, cast, more like this.
import type { Provider, Title } from '@/sdk/types';
import type { Person } from '@/core/cast';
import type { Grade } from '@/core/catalog';
import { app } from './app';
import { A, $, $$, cascade, esc, ico, plogo, tvScale, TV, toast, FADE, FADE_OUT, RISE } from './dom';
import { go } from './focus';
import { getLocale, reasonText, t as tr } from './i18n';
import { artHtml, bindCards, cardHtml, scoresHtml, type Item } from './rows';
import { startPlay } from './play';
import { openEpisodes } from './episodes';
import { openPerson } from './person';

let returnTo: HTMLElement | null = null;

const provMark = (p: Provider) => `<span class="pvd">${plogo(p.logos[0]!)}${esc(p.name)}</span>`;

export async function openDetails(input: Title, from?: HTMLElement | null, why?: string, startSec?: number) {
  returnTo = from ?? (document.activeElement as HTMLElement);
  $('.dlayer', TV())?.remove();
  const tv = TV();
  tv.insertAdjacentHTML('beforeend', `<div class="layer dlayer" style="z-index:10"><div class="dback">${artHtml(input, 'w1280')}<div class="scrim"></div></div><div class="dscroll"><div class="dtop"><div class="dtext"></div></div><div class="dsecs"><section data-sec="cast"></section><section data-sec="voices"></section><section data-sec="more"></section><section data-sec="grades"></section></div></div></div>`);
  const L = $('.dlayer', tv), back = $('.dback', L), text = $('.dtext', L), scroll = $('.dscroll', L);
  // The page moves with focus, as Home does: the top for the buttons, a section's heading near the top for the rest.
  L.addEventListener('focusin', (e) => {
    const sec = (e.target as HTMLElement).closest<HTMLElement>('[data-sec]');
    const most = Math.max(0, scroll.scrollHeight - 1080);
    scroll.style.transform = `translateY(${-(sec ? Math.min(most, Math.max(0, sec.offsetTop - 96)) : 0)}px)`;
    L.classList.toggle('down', !!sec);
  });
  if (from) {
    const r = from.getBoundingClientRect(), o = tv.getBoundingClientRect(), s = tvScale();
    A(back, [{ transform: `translate(${(r.left - o.left) / s}px,${(r.top - o.top) / s}px) scale(${r.width / s / 1920},${r.height / s / 1080})` }, { transform: 'none' }], { duration: 340 });
    back.style.transformOrigin = '0 0';
  } else A(back, FADE, { duration: 300 });
  A($('.scrim', back), FADE, { duration: 300, delay: 60 });

  const draw = (t: Title, extra = '') => {
    text.innerHTML = `<h1>${esc(t.name)}</h1>${why ? `<span class="why">${esc(reasonText(why))}</span>` : ''}<div class="meta" style="font-size:22px">${scoresHtml(t, true)}<span>${t.year ?? ''}</span>${t.certification ? `<span class="tag">${esc(t.certification)}</span>` : ''}<span>${t.kind === 'series' ? (t.seasons ? tr(t.seasons > 1 ? '{n} seasons' : '{n} season', { n: t.seasons }) : tr('Series')) : t.runtime ? `${Math.floor(t.runtime / 60)} h ${t.runtime % 60} min` : ''}</span><span>${esc((t.genreLabels?.length ? t.genreLabels : t.genres).slice(0, 4).join(', '))}</span></div><p>${esc(t.overview)}</p>${extra}`;
  };
  draw(input, `<div class="btns"><span class="btn" aria-busy="true">${tr('Loading')}</span></div>`);
  // The text follows the picture in, line by line.
  [...text.children].forEach((e, i) => A(e, RISE, { duration: 380, delay: 120 + i * 50 }));

  let t = input;
  try {
    t = await app.catalog.full(input);
  } catch (e) {
    console.warn(e);
  }
  if (!L.isConnected) return;
  const [offers, inList, ratings, requests, canReq] = await Promise.all([app.offers(t), app.library.inList(t.key), app.library.ratings(), app.library.requests(), app.canRequest()]);
  if (!L.isConnected) return;
  const playable = offers.filter((o) => o.state === 'playable');
  const requested = requests.find((r) => r.key === t.key);
  const hist = (await app.library.history()).find((h) => h.key === t.key);
  const resume = startSec ?? (hist && hist.progress < 0.9 ? hist.positionSec : undefined);
  const source = playable.length ? `<div class="offers">${playable.map((o) => provMark(o.provider)).join('')}</div>` : requested || (canReq && t.tmdbId) ? `<div class="offers">${canReq!.requestBrand ? `<span class="pvd">${plogo(canReq!.requestBrand.logo)}${esc(canReq!.requestBrand.name)}</span>` : provMark(canReq!)}</div>` : `<div class="dnone">${tr('Not on your services yet')}</div>`;
  const rating = ratings[t.key];
  const btn = (id: string, icon: string, label: string, on = false) => `<button class="f btn" id="${id}" type="button" aria-pressed="${on}">${ico(icon, 's')}${label}</button>`;
  // My List and the ratings: round icons that fill when on, named by a tip under them, so the row stays on one line.
  const mark = (id: string, icon: string, label: string, on = false) => `<button class="f btn io" id="${id}" type="button" aria-pressed="${on}" aria-label="${esc(label)}">${ico(icon)}<span class="tip">${esc(label)}</span></button>`;
  const actions = playable.map((o, i) => `<button class="f btn ${i === 0 ? 'lt' : ''}" data-play="${o.provider.id}" type="button">${ico('play', 's')}${playable.length > 1 ? esc(tr('Play on {name}', { name: o.provider.name })) : tr(resume ? 'Resume' : 'Play')}</button>`).join('');
  const req = !playable.length && canReq && t.tmdbId ? `<button class="f btn pri" id="dq" type="button" ${requested && t.kind !== 'series' ? 'disabled' : ''}>${requested && t.kind !== 'series' ? `${ico('check', 's')}${esc(tr(requested.state))}` : tr(requested ? 'Request more seasons' : 'Request')}</button>` : '';
  // A series' episodes open as their own menu, from the provider that plays it, else TMDB's list.
  const withEpisodes = playable.find((o) => o.provider.seasons)?.provider ?? null;
  const eps = t.kind === 'series' && (withEpisodes || t.seasonList?.length) ? btn('de', 'list-video', tr('Episodes')) : '';
  draw(t, `${source}<div class="btns">${actions}${eps}${req}<span class="marks">${mark('dl', inList ? 'check' : 'plus', tr('My List'), inList)}${mark('dy', 'thumbs-up', tr('Like'), rating === 'like')}${mark('dv', 'heart', tr('Love'), rating === 'love')}${mark('dn', 'thumbs-down', tr('Not for me'), rating === 'dislike')}${mark('ds', 'eye', tr('Already seen'), !!hist && (hist.seen || hist.progress >= 0.9))}</span></div>`);
  // How likely this profile is to like it, once it has told anything about its taste.
  void app.engine.affinity([t]).then((a) => {
    const v = a.get(t.key);
    if (v === undefined || !app.engine.knows() || !text.isConnected) return;
    $('.meta', text)?.insertAdjacentHTML('afterbegin', `<span class="match" title="${esc(tr('How likely you are to like it, from your taste'))}">${esc(tr('{n}% for you', { n: Math.round(v * 100) }))}</span>`);
  }).catch(() => undefined);

  $$<HTMLButtonElement>('[data-play]', text).forEach((b) => (b.onclick = () => startPlay(app.provider(b.dataset.play!)!, t, undefined, resume)));
  const de = $('#de', text);
  if (de) de.onclick = () => void openEpisodes(t, withEpisodes, de);
  const q = $<HTMLButtonElement>('#dq', text);
  if (q) q.onclick = async () => {
    if (t.kind === 'series' && (t.seasonList?.length ?? 0) > 1) return seasonPicker(t, canReq!, q);
    q.disabled = true;
    try {
      const seasons = t.kind === 'series' ? t.seasonList?.map((s) => s.number) : undefined;
      const state = await canReq!.request!(t, app.profile, { seasons });
      await app.library.addRequest(t, state, seasons);
      q.innerHTML = `${ico('check', 's')}${esc(tr(state))}`;
      toast(tr('Requested {name}', { name: t.name }));
    } catch (e) {
      q.disabled = false;
      toast((e as Error).message);
    }
  };
  $('#dl', text).onclick = async () => {
    const on = await app.library.toggleList(t);
    const b = $('#dl', text);
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('use')!.setAttribute('href', `./icons.svg#i-${on ? 'check' : 'plus'}`);
    toast(tr(on ? 'Added {name} to My List' : 'Removed {name} from My List', { name: t.name }));
  };
  // Like, Love and Not for me: one rating at a time; pressing the one that is on takes it off.
  const rate = (id: string, v: 'like' | 'love' | 'dislike') => ($(id, text).onclick = async () => {
    const off = (await app.library.ratings())[t.key] === v;
    await app.library.rate(t, off ? null : v);
    $$('#dy,#dv,#dn', text).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (!off) $(id, text).setAttribute('aria-pressed', 'true');
    toast(off ? tr('Removed your rating') : v === 'dislike' ? tr("Won't suggest {name} again", { name: t.name }) : tr('More like {name} coming up', { name: t.name }));
  });
  rate('#dy', 'like');
  rate('#dv', 'love');
  rate('#dn', 'dislike');
  // Already seen: into History, out of the lists for 15 days; pressed again, taken back.
  $('#ds', text).onclick = async () => {
    const b = $('#ds', text), on = b.getAttribute('aria-pressed') !== 'true';
    if (on) await app.library.markSeen(t);
    else await app.library.unmarkSeen(t.key);
    b.setAttribute('aria-pressed', String(on));
    toast(on ? tr('Marked as seen: in History, and out of your lists for a while') : tr('No longer marked as seen'));
  };
  go($('.btns .f:not(:disabled)', text));

  // Below: the cast, the voices in the profile's language, more like this, the ratings.
  if (t.tmdbId) {
    void castSections(L, t);
    moreLike(L, t);
    void gradesTable(L, t);
  }
}

/**
 * Every source's score for the title, as a table at the bottom: source, score, votes, a bar. The scores already known
 * show at once; each other source's row joins when it answers, so a slow one holds nothing up.
 */
async function gradesTable(L: HTMLElement, t: Title) {
  const g = await app.catalog.grades(t).catch(() => null);
  if (!g || !L.isConnected) return;
  const sec = $('[data-sec="grades"]', L), num = new Intl.NumberFormat(getLocale());
  const score = (x: Grade) => (x.source === 'Rotten Tomatoes' ? `${Math.round(x.value)}%` : `${x.outOf === 10 ? x.value.toFixed(1) : Math.round(x.value)} / ${x.outOf}`);
  const row = (x: Grade) => `<tr class="f" tabindex="0" aria-label="${esc(`${x.source}, ${score(x)}`)}"><th scope="row">${esc(x.source)}</th><td>${esc(score(x))}</td><td>${x.votes ? esc(num.format(x.votes)) : '–'}</td><td><span class="gbar"><i style="transform:scaleX(${Math.max(0, Math.min(1, x.value / x.outOf))})"></i></span></td></tr>`;
  const add = (x: Grade) => {
    if (!L.isConnected) return;
    if (!sec.firstChild) {
      sec.className = 'grades';
      sec.innerHTML = `<h2>${tr('Ratings')}</h2><table><thead><tr><th scope="col">${tr('Source')}</th><th scope="col">${tr('Score')}</th><th scope="col">${tr('Votes')}</th><th scope="col"><span class="vh">${tr('Score')}</span></th></tr></thead><tbody></tbody></table>`;
      A(sec, RISE, { duration: 280 });
    }
    $('tbody', sec).insertAdjacentHTML('beforeend', row(x));
    // Each source's row slides in as it answers, after the ones already there.
    const rows = $$('tbody tr', sec);
    cascade(rows.slice(-1), { from: 'right', delay: Math.min(rows.length - 1, 8) * 50 });
  };
  g.now.forEach(add);
  g.later.forEach((p) => void p.then((x) => x && add(x)));
}

/** Choose which seasons to request. Seasons already asked for or available are shown, and can't be chosen again. */
async function seasonPicker(t: Title, p: Provider, opener: HTMLButtonElement) {
  const states = await p.seasonStates?.(t).catch(() => null) ?? new Map<number, string>();
  const own = (await app.library.requests()).find((r) => r.key === t.key)?.seasons ?? [];
  for (const n of own) if (!states.has(n)) states.set(n, 'Requested');
  const seasons = t.seasonList!;
  const open = seasons.filter((s) => !states.has(s.number));
  TV().insertAdjacentHTML('beforeend', `<div class="modal"><div class="panel seasons"><h2 style="font-size:36px">${esc(tr('Which seasons of {name}?', { name: t.name }))}</h2>${open.length > 1 ? `<button class="f chip" id="sall" type="button" aria-pressed="false">${tr('All seasons')}</button>` : ''}<div class="sgrid">${seasons.map((s) => {
    const state = states.get(s.number);
    return `<button class="f sopt" type="button" data-n="${s.number}" aria-pressed="false" ${state ? 'disabled' : ''}><span class="sbox">${ico('check', 's')}</span><span class="st2"><b>${esc(s.name)}</b><span>${state ? esc(tr(state)) : tr(s.episodes === 1 ? '{n} episode' : '{n} episodes', { n: s.episodes })}</span></span></button>`;
  }).join('')}</div><div class="err" role="alert"></div><div class="btns"><button class="f btn pri" id="sgo" type="button" disabled>${tr('Request')}</button><button class="f btn" id="scn" type="button">${tr('Cancel')}</button></div></div></div>`);
  const m = $('.modal', TV()), go2 = $<HTMLButtonElement>('#sgo', m), opts = $$<HTMLButtonElement>('.sopt:not(:disabled)', m);
  A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  const chosen = () => opts.filter((o) => o.getAttribute('aria-pressed') === 'true').map((o) => Number(o.dataset.n));
  const paint = () => {
    const n = chosen().length;
    go2.disabled = !n;
    go2.textContent = n ? tr(n === 1 ? 'Request {n} season' : 'Request {n} seasons', { n }) : tr('Request');
    $('#sall', m)?.setAttribute('aria-pressed', String(n === opts.length));
  };
  opts.forEach((o) => {
    o.onclick = () => {
      o.setAttribute('aria-pressed', String(o.getAttribute('aria-pressed') !== 'true'));
      paint();
    };
    o.addEventListener('focus', () => o.scrollIntoView({ block: 'nearest' }));
  });
  const all = $('#sall', m);
  if (all) all.onclick = () => {
    const on = chosen().length !== opts.length;
    opts.forEach((o) => o.setAttribute('aria-pressed', String(on)));
    paint();
  };
  const shut = () => {
    m.remove();
    go(opener);
  };
  (window as unknown as { _mret: () => void })._mret = shut;
  $('#scn', m).onclick = shut;
  go2.onclick = async () => {
    const list = chosen();
    go2.disabled = true;
    go2.innerHTML = `${ico('loader-circle', 's spin')}${tr('Requesting')}`;
    try {
      const state = await p.request!(t, app.profile, { seasons: list });
      await app.library.addRequest(t, state, list);
      shut();
      opener.textContent = open.length > list.length ? tr('Request more seasons') : tr(state);
      if (open.length <= list.length) opener.disabled = true;
      go(opener.disabled ? $('.btns .f:not(:disabled)', opener.parentElement!) : opener);
      toast(tr(list.length === 1 ? 'Requested {n} season of {name}' : 'Requested {n} seasons of {name}', { n: list.length, name: t.name }));
    } catch (e) {
      $('.err', m).textContent = (e as Error).message;
      paint();
    }
  };
  go(opts[0] ?? $('#scn', m));
}

function moreLike(L: HTMLElement, t: Title) {
  app.catalog.recommendations(t).then(async (rec) => {
    if (!L.isConnected || !rec.length) return;
    // The five the profile is most likely to like, best first.
    const list: Item[] = (await app.engine.byAffinity(rec.map((title) => ({ title })))).slice(0, 5);
    if (!L.isConnected) return;
    const more = $('[data-sec="more"]', L);
    more.className = 'more';
    more.innerHTML = `<h2>${tr('More like this')}</h2><div>${list.map((i) => cardHtml(i)).join('')}</div>`;
    bindCards(more, list, (it) => openDetails(it.title, returnTo));
    A($('h2', more), RISE, { duration: 360 });
    cascade($$('.card', more), { step: 70, delay: 60 });
  }).catch(() => undefined);
}

export function closeDetails() {
  const L = $('.dlayer', TV());
  if (!L) return;
  const done = () => {
    L.remove();
    if (returnTo?.isConnected) go(returnTo);
  };
  const a = A(L, FADE_OUT, { duration: 160, fill: 'forwards' });
  if (a) a.finished.then(done, done);
  else done();
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const face = (src: string | null, name: string, cls: string) => (src ? `<img class="pci ${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="pci ${cls} ini" aria-hidden="true">${esc(initials(name))}</span>`);
const ROLE: Record<string, string> = { producer: 'Producer', creator: 'Creator' };

/**
 * One person: the character's picture and the actor's face side by side, the same size, when a picture of the
 * character exists (animation, make-up, costumes); otherwise the actor's face alone, bigger. Name, then role.
 */
function personHtml(p: Person): string {
  const role = ROLE[p.kind] ? tr(ROLE[p.kind]!) : p.role;
  const pics = p.character ? `${face(p.character, p.role, 'two')}${face(p.photo, p.name, 'two')}` : face(p.photo, p.name, 'one');
  return `<button class="f pc" type="button" role="listitem" aria-label="${esc(role ? `${p.name}, ${role}` : p.name)}"><span class="pcf">${pics}</span><b>${esc(p.name)}</b>${role ? `<span class="muted">${esc(role)}</span>` : ''}</button>`;
}

/** A row of people that slides with focus, like the episodes. */
function fillPeople(sec: HTMLElement, heading: string, people: Person[], note = '') {
  sec.className = 'dcast';
  sec.innerHTML = `<h2>${esc(heading)}</h2><div class="cclip"><div class="ctrack" role="list">${people.map(personHtml).join('')}</div></div>${note}`;
  const track = $('.ctrack', sec);
  $$('.pc', track).forEach((el, i) => {
    el.addEventListener('focus', () => {
      const room = 1920 - 96 - 64, end = el.offsetLeft + el.offsetWidth;
      track.style.transform = `translateX(${-Math.max(0, end - room + 40)}px)`;
    });
    // OK on a person opens their page; a title picked there opens in place of this one.
    el.onclick = () => void openPerson({ id: people[i]!.id, name: people[i]!.name }, el, (it) => void openDetails(it.title, returnTo));
  });
  // The heading, then each person, one by one.
  A($('h2', sec), RISE, { duration: 360 });
  cascade($$('.pc', track), { step: 80, delay: 80, max: 9 });
}

async function castSections(L: HTMLElement, t: Title) {
  const info = await app.catalog.cast(t).catch(() => null);
  if (!info || !L.isConnected) return;
  // Under the last row: where the voices come from (CC BY-SA asks for it), and who made each Commons picture.
  const lines = [info.sources.length ? tr(info.sources.includes('AniList') ? 'Voices from {list}' : 'Voices from {list}, under CC BY-SA', { list: info.sources.join(', ') }) : '', info.photoSources?.length ? tr('More photos from {list}', { list: info.photoSources.join(', ') }) : '', info.credits.length ? tr('Pictures from Wikimedia Commons: {list}', { list: info.credits.join('; ') }) : ''].filter(Boolean);
  const note = lines.map((l) => `<p class="ccred">${esc(l)}</p>`).join('');
  if (info.people.length) fillPeople($('[data-sec="cast"]', L), tr('Cast'), info.people, info.voices.length ? '' : note);
  if (info.voices.length) fillPeople($('[data-sec="voices"]', L), tr('English voices'), info.voices, note);
}
