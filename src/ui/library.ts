// Docs: docs/03 - Features/Library.md
// Purpose: the Library: every title of every service from the title index, one list, saved filters on top, letters at the side.
import { buildList, DEFAULT_FILTERS, LETTERS, letterOf, letterStarts, readFilters, type LibFilters } from '@/core/libraryview';
import type { IndexStatus } from '@/core/titleindex';
import type { Provider, Title } from '@/sdk/types';
import { app } from './app';
import { A, $, $$, cascade, esc, ico, leave, plogo, reduced, touch, TV } from './dom';
import { openDetails } from './details';
import { go, nav, setScroll } from './focus';
import { t } from './i18n';
import { bindCards, cardHtml, type Item } from './rows';

const KINDS = [['all', 'Movies and series'], ['movie', 'Movies'], ['series', 'Series']] as const;
const ERAS = [['any', 'Any period'], ['2020', '2020s'], ['2010', '2010s'], ['2000', '2000s'], ['1990', '1990s'], ['1980', '1980s'], ['older', 'Before 1980']] as const;
const STARS = [[0, 'Any rating'], [6, '6 and up'], [7, '7 and up'], [8, '8 and up']] as const;
const SORTS = [['az', 'A to Z'], ['za', 'Z to A'], ['best', 'Best rated'], ['worst', 'Lowest rated'], ['new', 'Newest'], ['old', 'Oldest']] as const;
const label = <T>(list: readonly (readonly [T, string])[], v: T) => t(list.find((x) => x[0] === v)![1]);
/** A poster's width and height, the gaps, on the 1080-high canvas. */
const CW = 240, CH = 360, GX = 20, GY = 28, RH = CH + GY;
/** On a touch screen the posters fill the width instead: three at least, about 200 wide each. */
const TOUCH_CW = 200, TOUCH_COLS = 3;
/** Rows drawn above and below those in view, so the remote always has a card to move to. */
const SPARE = 1;
const VIEW = 1080;

const filtersKey = () => `library:filters:${app.profile.id}`;

/**
 * A choice over the page: one value, or several (the services) with Done. Back, or a click beside it, closes it,
 * keeping what was chosen. Resolves with the values chosen, or `undefined` when nothing changed.
 */
function choose(opener: HTMLElement, title: string, options: { v: string; label: string; logo?: string }[], picked: string[], multi: boolean): Promise<string[] | undefined> {
  return new Promise((done) => {
    const now = new Set(picked);
    TV().insertAdjacentHTML('beforeend', `<div class="modal lchoose" role="dialog" aria-label="${esc(title)}"><div class="panel"><h2>${esc(title)}</h2><div class="lopts" role="${multi ? 'group' : 'radiogroup'}">${options.map((o, i) => `<button class="f lopt" type="button" data-i="${i}" ${multi ? `aria-pressed="${now.has(o.v)}"` : `role="radio" aria-checked="${now.has(o.v)}"`}>${o.logo ? `<span class="plogos">${plogo(o.logo)}</span>` : ''}<span>${esc(o.label)}</span>${ico('check', 's')}</button>`).join('')}</div>${multi ? `<button class="f btn lt" type="button" id="ldone">${t('Done')}</button>` : ''}</div></div>`);
    const m = $('.lchoose', TV());
    A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 220 });
    const close = () => {
      (window as unknown as { _mret?: () => void })._mret = undefined;
      leave(m);
      if (opener.isConnected) go(opener);
      const out = [...now];
      done(out.length === picked.length && out.every((x) => picked.includes(x)) ? undefined : out);
    };
    (window as unknown as { _mret?: () => void })._mret = close;
    $$('.lopt', m).forEach((b) => (b.onclick = () => {
      const v = options[Number(b.dataset.i)]!.v;
      if (!multi) {
        now.clear();
        now.add(v);
        return close();
      }
      if (now.has(v)) now.delete(v);
      else now.add(v);
      b.setAttribute('aria-pressed', String(now.has(v)));
    }));
    if (multi) $('#ldone', m).onclick = close;
    go($('.lopt[aria-checked="true"], .lopt', m));
  });
}

/** How a service's index stands, in a few words: for the line above the list. */
function standing(s: IndexStatus): string | null {
  if (s.state === 'running') return s.of ? t('Reading {name}\'s catalogue: {n}%', { name: s.name, n: Math.min(99, Math.round((s.pages / s.of) * 100)) }) : t('Reading {name}\'s catalogue', { name: s.name });
  if (s.state === 'error') return t("{name}'s catalogue couldn't be read: {why}", { name: s.name, why: t(s.error ?? '') });
  if (s.state === 'waiting') return t('{name}\'s catalogue is read in the background', { name: s.name });
  return null;
}

/** The Library page: the filter bar, the list, the letters. `to` goes to a route (Settings, when nothing is connected). */
export async function pageLibrary(ct: HTMLElement, to: (route: string) => void) {
  let f = readFilters(await app.store.get(filtersKey()).catch(() => null));
  ct.innerHTML = `<div class="lpage"><div class="lscroll"><header class="lhead"><h1>${t('Library')}</h1><span class="muted" id="lsum"></span></header><div class="lbar" role="toolbar" aria-label="${t('Filters')}"></div><p class="muted lwarn" id="lwarn" hidden></p><div class="lstate"><span class="btn" aria-busy="true">${t('Loading')}</span></div><div class="lvirt" role="list" aria-label="${t('Library')}"></div></div><nav class="letters" aria-label="${t('Jump to a letter')}" hidden><span class="lmark" aria-hidden="true"></span>${LETTERS.map((l) => `<button class="f lt1" type="button" data-l="${l}" aria-label="${t('Titles from {letter}', { letter: l })}"><span>${l}</span></button>`).join('')}</nav></div>`;
  const page = $('.lpage', ct), sc = $('.lscroll', ct), bar = $('.lbar', ct), state = $('.lstate', ct), virt = $('.lvirt', ct), letters = $('.letters', ct), mark = $('.lmark', ct), warn = $('#lwarn', ct);
  const open = (it: Item, el: HTMLElement) => void openDetails(it.title, el);

  const all = await app.index.services();
  if (!ct.isConnected) return;
  if (!all.length) {
    state.innerHTML = `<div class="empty"><b style="color:var(--text)">${t('No service connected yet')}</b>${t('Connect Jellyfin or turn on Netflix in Settings: what they have appears here.')}</div><div><button class="f btn" id="lset" type="button">${ico('settings', 's')}${t('Settings')}</button></div>`;
    $('#lset', state).onclick = () => to('settings');
    go($('#lset', state));
    return;
  }

  let list: Title[] = [], starts = new Map<string, number>(), y = 0, cols = 1, cw = CW, ch = CH, rh = RH;
  /** After a jump to a letter, the mark stays on it (its row may start with the letter before) until the list moves. */
  let pinned: number | undefined;
  const drawn = new Map<number, HTMLElement>();
  const save = () => void app.store.set(filtersKey(), f).catch(() => undefined);

  // ---- Scrolling: the page slides; only the rows near the screen have cards. ----
  // A touch screen scrolls the page natively (#ct): `y` follows it, and a jump sets it.
  const native = touch(), view = () => (native ? ct.clientHeight : VIEW);
  const top = () => virt.offsetTop;
  const maxY = () => Math.max(0, top() + Math.ceil(list.length / cols) * rh + 40 - view());
  const setY = (to: number, quick = false) => {
    y = Math.min(maxY(), Math.max(0, to));
    if (native) {
      ct.scrollTop = y;
      return draw();
    }
    sc.style.transition = quick ? 'transform 140ms ease-out' : '';
    sc.style.transform = `translateY(${-y}px)`;
    draw();
  };
  setScroll(page, { by: (dy) => {
    pinned = undefined;
    setY(y + dy, true);
  } });
  if (native) {
    const follow = () => {
      if (!virt.isConnected) return ct.removeEventListener('scroll', follow);
      // A jump's own scroll keeps the letter it went to; a finger's moves the mark with the list.
      if (Math.abs(ct.scrollTop - y) > 1) pinned = undefined;
      y = ct.scrollTop;
      draw();
    };
    ct.addEventListener('scroll', follow, { passive: true });
  }

  /** Adds the cards of the rows in view, and takes away those far from it (never the one with focus). */
  const draw = () => {
    if (native) {
      cols = Math.max(TOUCH_COLS, Math.floor((virt.clientWidth + GX) / (TOUCH_CW + GX)));
      cw = (virt.clientWidth - GX * (cols - 1)) / cols;
      ch = cw * 1.5;
      rh = ch + GY;
    } else cols = Math.max(1, Math.floor((virt.clientWidth + GX) / (cw + GX)));
    virt.style.height = `${Math.ceil(list.length / cols) * rh}px`;
    const r0 = Math.max(0, Math.floor((y - top()) / rh) - SPARE), r1 = Math.max(0, Math.ceil((y - top() + view()) / rh) + SPARE);
    const from = r0 * cols, upto = Math.min(list.length, (r1 + 1) * cols);
    for (const [i, el] of drawn) if ((i < from || i >= upto) && el !== document.activeElement) {
      el.remove();
      drawn.delete(i);
    }
    const fresh: number[] = [];
    for (let i = from; i < upto; i++) if (!drawn.has(i)) fresh.push(i);
    if (fresh.length) {
      const items = fresh.map((i): Item => ({ title: list[i]! }));
      const box = document.createElement('div');
      box.innerHTML = fresh.map((i) => cardHtml({ title: list[i]! }, `role="listitem" data-i="${i}" style="left:${(i % cols) * (cw + GX)}px;top:${Math.floor(i / cols) * rh}px${native ? `;width:${cw}px;height:${ch}px` : ''}"`, true, false, true)).join('');
      bindCards(box, items, open);
      ([...box.children] as HTMLElement[]).forEach((el, k) => {
        drawn.set(fresh[k]!, el);
        virt.append(el);
      });
    }
    markLetter(pinned);
  };

  // ---- Letters: those with titles stand out, the others are dimmed; the red mark follows where you are. ----
  const markLetter = (at?: number) => {
    if (letters.hidden || !list.length) return;
    const i = at ?? Math.min(list.length - 1, Math.max(0, Math.floor((y - top() + 40) / rh)) * cols);
    const b = $(`[data-l="${letterOf(list[i]!.name)}"]`, letters);
    if (!b) return;
    // With the letter, wherever the dock effect has pushed it.
    mark.style.transform = `translateY(${b.offsetTop + b.offsetHeight / 2 - 22 + Number(b.dataset.push ?? 0)}px)`;
    $$('.lt1', letters).forEach((x) => x.classList.toggle('cur', x === b));
  };
  /**
   * Like a dock: the letter under the pointer, or in focus, grows into a raised disc and its neighbours a little;
   * those around move apart by as much as they grew, so none overlaps.
   */
  const swell = (center: number | null) => {
    const items = $$('.lt1', letters);
    const grow = items.map((_, i) => (center === null || reduced() ? 0 : 0.75 * Math.max(0, 1 - Math.abs(i - center) / 3)));
    const c = center === null ? 0 : Math.round(center), h = 34;
    items.forEach((b, i) => {
      // Half the growth of the letters between it and the centre, on each side, pushes it away.
      let push = 0;
      if (center !== null && i !== c) {
        const dir = Math.sign(i - c);
        for (let j = c; j !== i; j += dir) push += (grow[j]! * h) / (j === c ? 2 : 1);
        push = dir * (push + (grow[i]! * h) / 2);
      }
      const s = 1 + grow[i]!;
      b.style.transform = s > 1.01 || push ? `translate(${-(s - 1) * 30}px, ${push.toFixed(1)}px) scale(${s.toFixed(3)})` : '';
      b.dataset.push = push.toFixed(1);
      b.classList.toggle('up', center !== null && i === c);
    });
    const cur = $('.lt1.cur', letters);
    if (cur) mark.style.transform = `translateY(${cur.offsetTop + cur.offsetHeight / 2 - 22 + Number(cur.dataset.push ?? 0)}px)`;
  };
  letters.addEventListener('mousemove', (e) => {
    const items = $$('.lt1', letters), r = letters.getBoundingClientRect();
    swell(Math.max(0, Math.min(items.length - 1, ((e.clientY - r.top) / r.height) * items.length - 0.5)));
  });
  letters.addEventListener('mouseleave', () => swell(letters.contains(document.activeElement) ? $$('.lt1', letters).indexOf(document.activeElement as HTMLElement) : null));
  letters.addEventListener('focusin', (e) => swell($$('.lt1', letters).indexOf(e.target as HTMLElement)));
  letters.addEventListener('focusout', (e) => {
    if (!letters.contains(e.relatedTarget as Node)) swell(null);
  });
  // A finger slides along the letters, as on a phone's contacts: the list follows the letter under it.
  if (native) {
    let held = '';
    const under = (e: PointerEvent) => {
      const items = $$<HTMLButtonElement>('.lt1', letters), r = letters.getBoundingClientRect();
      const at = Math.max(0, Math.min(items.length - 1, Math.floor(((e.clientY - r.top) / r.height) * items.length)));
      // The nearest letter with titles, downwards first.
      const b = items.slice(at).find((x) => !x.disabled) ?? items.slice(0, at).reverse().find((x) => !x.disabled);
      if (!b || b.dataset.l === held) return;
      held = b.dataset.l!;
      b.click();
      swell(items.indexOf(b));
    };
    letters.addEventListener('pointerdown', (e) => {
      letters.setPointerCapture(e.pointerId);
      held = '';
      under(e);
    });
    letters.addEventListener('pointermove', (e) => {
      if (letters.hasPointerCapture(e.pointerId)) under(e);
    });
    const end = () => swell(null);
    letters.addEventListener('pointerup', end);
    letters.addEventListener('pointercancel', end);
  }
  $$('.lt1', letters).forEach((b) => (b.onclick = () => {
    const i = starts.get(b.dataset.l!);
    if (i === undefined) return;
    pinned = i;
    setY(top() + Math.floor(i / cols) * rh - 24);
    // The remote goes on from the first title under the letter; the pointer stays on the letters.
    if (!nav.pointer) go(drawn.get(i));
  }));

  // ---- Focus by the remote keeps the card in view; the pointer leaves the page where it is. ----
  virt.addEventListener('focusin', (e) => {
    const i = Number((e.target as HTMLElement).dataset.i);
    if (Number.isNaN(i)) return;
    pinned = undefined;
    markLetter(i);
    if (nav.pointer) return;
    const rowTop = top() + Math.floor(i / cols) * rh;
    if (rowTop - y < 160) setY(rowTop - 160);
    else if (rowTop + ch - y > view() - 60) setY(rowTop + ch - view() + 60);
  });
  bar.addEventListener('focusin', () => {
    if (!nav.pointer) setY(0);
  });

  // ---- The list: from the index, under the filters. ----
  const rebuild = async (keepY = false) => {
    const on = all.filter((p) => !f.off.includes(p.id));
    const sources = await Promise.all(on.map(async (p: Provider) => ({ recs: await app.index.items(p), watchId: p.watchProviderId })));
    if (!ct.isConnected) return;
    list = buildList(sources, f);
    starts = letterStarts(list);
    const az = f.sort === 'az' || f.sort === 'za';
    letters.hidden = !az || !list.length;
    $$<HTMLButtonElement>('.lt1', letters).forEach((b) => {
      const has = starts.has(b.dataset.l!);
      b.disabled = !has;
      b.classList.toggle('none', !has);
    });
    drawn.forEach((el) => el.remove());
    drawn.clear();
    $('#lsum', ct).textContent = list.length ? t(list.length === 1 ? '{n} title' : '{n} titles', { n: list.length.toLocaleString() }) : '';
    const reading = (await app.index.statuses()).filter((s) => on.some((p) => p.id === s.id));
    const busy = reading.some((s) => s.state === 'running' || s.state === 'waiting');
    if (!list.length) {
      const none = on.length === 0;
      state.innerHTML = busy ? `<span class="btn" aria-busy="true">${t('Reading the catalogues')}</span>` : `<div class="empty"><b style="color:var(--text)">${t(none ? 'Every service is turned off' : 'Nothing fits these filters')}</b>${t(none ? 'Turn one on in Services.' : 'Try another period or rating, or Reset.')}</div>`;
    } else state.innerHTML = '';
    setY(keepY ? y : 0);
    if (!keepY) cascade([...drawn.values()].slice(0, 12), { from: 'pop', step: 25 });
    showReading(reading);
  };
  const showReading = (reading: IndexStatus[]) => {
    const lines = reading.map(standing).filter((x): x is string => !!x);
    warn.hidden = !lines.length;
    warn.innerHTML = lines.length ? `${ico('loader-circle', 's')}${esc(lines.join(' · '))}` : '';
  };

  /** The bar: each filter as a button showing its value; OK opens its choices. */
  const drawBar = () => {
    const shownServices = all.filter((p) => !f.off.includes(p.id));
    const btn = (id: string, name: string, value: string, extra = '') => `<button class="f btn lsel" type="button" id="${id}" aria-haspopup="dialog">${extra}<span class="muted">${esc(name)}</span><b>${esc(value)}</b>${ico('chevron-down', 's')}</button>`;
    const services = shownServices.length === all.length ? t('All') : shownServices.length ? shownServices.map((p) => p.name).join(', ') : t('None');
    const changed = JSON.stringify({ ...f, off: [] }) !== JSON.stringify({ ...DEFAULT_FILTERS, off: [] }) || f.off.length > 0;
    bar.innerHTML = btn('lsv', t('Services'), services, `<span class="plogos">${shownServices.slice(0, 3).map((p) => plogo(p.logos[0]!)).join('')}</span>`) + btn('lkd', t('Type'), label(KINDS, f.kind)) + btn('ler', t('Period'), label(ERAS, f.era)) + btn('lst', t('Rating'), label(STARS, f.stars)) + btn('lso', t('Order'), label(SORTS, f.sort)) + (changed ? `<button class="f btn lreset" type="button" id="lrs">${ico('rotate-ccw', 's')}${t('Reset')}</button>` : '');
    const pick = async (id: string, title: string, opts: { v: string; label: string; logo?: string }[], cur: string[], multi: boolean, set: (v: string[]) => void) => {
      const v = await choose($(`#${id}`, bar), title, opts, cur, multi);
      if (!v) return;
      set(v);
      save();
      drawBar();
      go($(`#${id}`, bar));
      await rebuild();
    };
    $('#lsv', bar).onclick = () => void pick('lsv', t('Services'), all.map((p) => ({ v: p.id, label: p.name, logo: p.logos[0] })), all.filter((p) => !f.off.includes(p.id)).map((p) => p.id), true, (v) => (f.off = all.filter((p) => !v.includes(p.id)).map((p) => p.id)));
    $('#lkd', bar).onclick = () => void pick('lkd', t('Type'), KINDS.map(([v, l]) => ({ v, label: t(l) })), [f.kind], false, ([v]) => (f.kind = v as LibFilters['kind']));
    $('#ler', bar).onclick = () => void pick('ler', t('Period'), ERAS.map(([v, l]) => ({ v, label: t(l) })), [f.era], false, ([v]) => (f.era = v as LibFilters['era']));
    $('#lst', bar).onclick = () => void pick('lst', t('Rating'), STARS.map(([v, l]) => ({ v: String(v), label: t(l) })), [String(f.stars)], false, ([v]) => (f.stars = Number(v) as LibFilters['stars']));
    $('#lso', bar).onclick = () => void pick('lso', t('Order'), SORTS.map(([v, l]) => ({ v, label: t(l) })), [f.sort], false, ([v]) => (f.sort = v as LibFilters['sort']));
    const reset = $('#lrs', bar);
    if (reset) reset.onclick = () => {
      f = { ...DEFAULT_FILTERS };
      save();
      drawBar();
      go($('#lsv', bar));
      void rebuild();
    };
  };

  // The index reads in the background: its progress shows above the list, and the list fills in when a service ends.
  let was = new Map((await app.index.statuses()).map((s) => [s.id, s.state]));
  let tick = 0;
  const off = app.index.onChange(() => {
    if (!ct.isConnected) return void off();
    clearTimeout(tick);
    tick = window.setTimeout(async () => {
      const now = await app.index.statuses();
      const ended = now.some((s) => s.state === 'done' && was.get(s.id) !== 'done');
      was = new Map(now.map((s) => [s.id, s.state]));
      if (ended) await rebuild(true);
      else showReading(now.filter((s) => !f.off.includes(s.id)));
    }, 250);
  });
  // A service never read yet starts now, rather than waiting for the next start of the app.
  for (const p of all) if (!(await app.index.items(p)).length && !app.index.isRunning(p.id)) void app.index.read(p);

  drawBar();
  await rebuild();
  if (!ct.contains(document.activeElement)) go(drawn.get(0) ?? $('#lsv', bar));
}
