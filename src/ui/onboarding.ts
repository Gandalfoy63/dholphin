// Docs: docs/03 - Features/Onboarding.md
// Purpose: first run: film data keys, profile, services, taste, preferences. Every step works with the remote.
import { newId } from '@/core/id';
import type { Profile, Provider, Title } from '@/sdk/types';
import { app, COLORS, KEY_FIELDS } from './app';
import { A, $, $$, esc, ico, logoMark, logoStart, plogo, TV, toast } from './dom';
import { focusables, go, nav } from './focus';
import { getLocale, LANGUAGES, setLocale, t } from './i18n';
import { artHtml } from './rows';
import { bindFields, bindKeyboard, fieldsHtml, keyboardHtml } from './textentry';
import { saveReturn, setReturnContext } from './returning';
import { bindPhone, phoneHtml } from './phone';
import { actorButton, actorLabel, avatar } from './profiles';
import { linkServer } from './serverlink';
import { pickActor } from './actors';

export interface ObState { name: string; color: string; photo?: string; photoOf?: string; picks: Title[]; language: string; region: string; maturity: string; addOnly?: boolean }
const REGIONS: [string, string][] = [['FR', 'France'], ['US', 'United States'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['ES', 'Spain'], ['BE', 'Belgium'], ['CA', 'Canada']];
const MATURITY = ['All', '12+', '16+', '18+'];
const newOb = (): ObState => {
  return { name: '', color: COLORS[2]!, picks: [], language: getLocale(), region: navigator.language.split('-')[1]?.toUpperCase() ?? 'US', maturity: '18+' };
};
let ob = newOb();
const STEPS = 6;
let finishCb: (p: Profile, picks: Title[]) => void = () => undefined;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : '');

export function startOnboarding(done: (p: Profile, picks: Title[]) => void, opts: { addOnly?: boolean; resume?: { step: number; ob: ObState } } = {}) {
  finishCb = done;
  ob = opts.resume?.ob ?? { ...newOb(), addOnly: opts.addOnly };
  render(opts.resume?.step ?? (opts.addOnly ? 2 : 0), 1);
}

function render(n: number, dir: number) {
  const body = [welcome, keys, who, services, taste, prefs][n]!;
  setReturnContext(() => ({ onboardingStep: n, ob }));
  TV().innerHTML = `<div class="onb"><div class="steps"><span style="width:48px;display:block">${logoMark()}</span><div class="pbar"><i style="transform:scaleX(${n / (STEPS - 1)})"></i></div><span>${n ? t('Step {n} of {total}', { n, total: STEPS - 1 }) : ''}</span></div><div class="obody"></div></div>`;
  const o = $('.obody', TV());
  body(o, n);
  A(o, [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 320 });
  go($('[data-first]', o) ?? focusables(o)[0]);
  nav.onBack = () => {
    const prev = n === 4 && ob.addOnly ? 2 : n - 1;
    if (n > (ob.addOnly ? 2 : 0)) step(n, prev);
  };
}
function step(from: number, to: number) {
  const b = $('.obody', TV());
  A(b, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${to > from ? -24 : 24}px)` }], { duration: 140, fill: 'forwards' });
  setTimeout(() => render(to, to > from ? 1 : -1), 140);
}
const foot = (enabled = true, label = t('Continue')) => `<div class="ofoot"><button class="f btn pri" id="nx" type="button" ${enabled ? '' : 'disabled'}>${label}</button></div>`;

function welcome(o: HTMLElement, n: number) {
  o.style.alignItems = 'center';
  o.style.justifyContent = 'center';
  o.innerHTML = `<div style="display:flex;gap:32px;align-items:center" id="wl"><span style="width:220px;display:block">${logoMark()}</span><span style="font-size:112px;font-weight:700;letter-spacing:-.01em">dholphin</span></div><p class="lead" style="text-align:center">${t('Everything you can watch, in one place, starting with what fits your taste.')}</p><div class="btns" role="group" aria-label="${t('Language')}">${LANGUAGES.map(([c, l]) => `<button class="f chip" type="button" data-lang="${c}" aria-pressed="${c === ob.language}">${l}</button>`).join('')}</div>${app.server ? '' : `<p class="muted" style="text-align:center">${t('Have a Dholphin server at home? It can keep the profiles and keys for every device.')} <button class="f btn" id="lnk" type="button">${ico('globe', 's')}${t('Link to a Dholphin server')}</button></p>`}${foot(true, t('Get started'))}`;
  const lnk = $('#lnk', o);
  if (lnk) lnk.onclick = () => linkServer();
  $$('[data-lang]', o).forEach((c) => (c.onclick = async () => {
    await chooseLanguage(c.dataset.lang!);
    render(n, 1);
    go($(`[data-lang="${c.dataset.lang}"]`, TV()));
  }));
  $('#nx', o).dataset.first = '1'; // OK moves on. The languages are one press up.
  logoStart($('#wl', o));
  A($('#wl span:last-child', o), [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 560 });
  $('#nx', o).onclick = () => step(n, app.hasKeys() ? 2 : 1);
}

async function chooseLanguage(code: string) {
  ob.language = code;
  setLocale(code);
  await app.store.set('uiLang', code);
}

function keys(o: HTMLElement, n: number) {
  const vals = app.keyValues();
  const fields = KEY_FIELDS.map((f) => ({ key: f.key, label: t(f.label), value: vals[f.key] }));
  o.innerHTML = `<h1>${t('Connect the film data')}</h1><p class="lead">${t('Only TMDB is needed; the others add scores, lists and photos. All are free:')}</p><ul class="kwhere">${KEY_FIELDS.map((f) => `<li><b>${esc(t(f.label))}</b> ${esc(f.where)}</li>`).join('')}</ul><div class="${app.host.phoneForm ? 'withphone' : ''}"><div class="stack"><div class="kfields">${fieldsHtml(fields)}</div>${keyboardHtml()}</div>${phoneHtml()}</div><div class="err" role="alert"></div>${foot(!!app.catalog.tmdbKey)}`;
  const read = bindFields(o, () => {
    $<HTMLButtonElement>('#nx', o).disabled = !read().tmdb;
  });
  // Keys from the phone are checked straight away, as if Continue had been chosen.
  const stopPhone = bindPhone(o, t('Connect the film data'), fields.map(({ key, label }) => ({ key, label })), () => {
    $<HTMLButtonElement>('#nx', o).disabled = !read().tmdb;
    if (read().tmdb) $('#nx', o).click();
  });
  $('#nx', o).onclick = async () => {
    const b = $<HTMLButtonElement>('#nx', o), v = read();
    b.disabled = true;
    b.textContent = t('Checking');
    if (await app.catalog.checkTmdb(v.tmdb!)) {
      await app.saveKeys(v);
      void stopPhone.then((stop) => stop());
      step(n, n + 1);
    } else {
      $('.err', o).textContent = t('TMDB refused this key. Check it and try again.');
      b.disabled = false;
      b.textContent = t('Continue');
    }
  };
}

function who(o: HTMLElement, n: number) {
  o.innerHTML = `<h1>${t('Who is this profile for?')}</h1><div class="two"><div class="stack"><div class="nm" aria-live="polite">${esc(cap(ob.name))}</div>${keyboardHtml(false)}</div><div class="stack">${face()}${actorButton(ob.photoOf)}<span class="muted">${t('Colour')}</span><div class="swatches">${COLORS.map((c) => `<button class="f sw" type="button" aria-label="Colour" style="background:${c}" aria-pressed="${c === ob.color}" data-c="${c}"></button>`).join('')}</div></div></div>${foot(!!ob.name.trim())}`;
  $('.kb .key', o).dataset.first = '1'; // Start on the letters; the script tabs are one press up.
  bindKeyboard(o, (k) => {
    ob.name = k === 'del' ? ob.name.slice(0, -1) : (ob.name + k).slice(0, 14);
    $('.nm', o).textContent = cap(ob.name);
    $('#pa', o).outerHTML = face();
    $<HTMLButtonElement>('#nx', o).disabled = !ob.name.trim();
  });
  $$('.sw', o).forEach((s) => (s.onclick = () => {
    ob.color = s.dataset.c!;
    $('#pa', o).outerHTML = face();
    $$('.sw', o).forEach((x) => x.setAttribute('aria-pressed', String(x === s)));
  }));
  $('#act', o).onclick = async () => {
    const a = await pickActor($('#act', o), ob.photo);
    if (a === undefined) return;
    ob.photo = a?.photo;
    ob.photoOf = a?.name;
    $('#pa', o).outerHTML = face();
    $('#act', o).innerHTML = actorLabel(ob.photoOf);
  };
  $('#nx', o).onclick = () => step(n, ob.addOnly ? 4 : n + 1);
}
/** The profile's picture as set so far: the actor's photo, else the colour and initial. */
const face = () => avatar({ name: cap(ob.name) || '?', color: ob.color, photo: ob.photo }).replace('class="av ', 'id="pa" class="av ');

/** A panel with a provider's fields, or the jump to its own sign-in. Shared with Settings. */
export async function connectProvider(p: Provider, profile: Profile, after: () => void) {
  if (!p.fields && p.onOff?.()) {
    await p.connect!(profile, {}).then(after, (e: Error) => toast(t(e.message)));
    return;
  }
  if (!p.fields) {
    saveReturn();
    await p.connect!(profile, {}).catch((e: Error) => toast(t(e.message)));
    return;
  }
  const values = (await p.values?.()) ?? {};
  const ret = document.activeElement as HTMLElement;
  TV().insertAdjacentHTML('beforeend', `<div class="modal"><div class="panel" style="justify-items:start;gap:16px"><h2 style="font-size:36px;display:flex;gap:12px;align-items:center">${p.logos.map(plogo).join('')}${esc(p.name)}</h2><div class="${app.host.phoneForm ? 'withphone' : ''}"><div class="stack">${fieldsHtml(p.fields.map((f) => ({ ...f, value: values[f.key] })))}${keyboardHtml()}</div>${phoneHtml()}</div><div class="err" role="alert"></div><div class="btns"><button class="f btn pri" id="cg" type="button">${t('Connect')}</button><button class="f btn" id="cc" type="button">${t('Cancel')}</button></div></div></div>`);
  const m = $('.modal', TV());
  A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  const read = bindFields(m);
  // What the phone sends connects straight away, as if Connect had been chosen.
  const stopPhone = bindPhone(m, p.name, p.fields.map((f) => ({ key: f.key, label: t(f.label), secret: f.secret })), () => $('#cg', m).click());
  const shut = () => {
    void stopPhone.then((stop) => stop());
    m.remove();
    if (ret?.isConnected) go(ret);
  };
  (window as unknown as { _mret: () => void })._mret = shut;
  $('#cc', m).onclick = shut;
  $('#cg', m).onclick = async () => {
    const b = $<HTMLButtonElement>('#cg', m);
    b.disabled = true;
    b.innerHTML = `${ico('loader-circle', 's spin')}${t('Connecting')}`;
    try {
      await p.connect!(profile, read());
      shut();
      after();
    } catch (e) {
      $('.err', m).textContent = t((e as Error).message);
      b.disabled = false;
      b.textContent = t('Connect');
    }
  };
  go($('input', m));
}

/** What a service's button says: connecting for accounts, switching for a service whose own app holds the account. */
export const actionLabel = (p: Provider, connected: boolean) => t(p.onOff?.() ? (connected ? 'Turn off' : 'Turn on') : connected ? 'Disconnect' : 'Connect');

/** Who connects services during setup: a provisional profile that the real one reuses. */
export const provisional = (): Profile => ({ id: 'setup', name: cap(ob.name.trim()) || 'You', color: ob.color, photo: ob.photo, photoOf: ob.photoOf, language: ob.language, region: ob.region, maturity: ob.maturity });
function services(o: HTMLElement, n: number) {
  o.innerHTML = `<h1>${t('Connect your services')}</h1><p class="lead">${t('Connect what you use. You can skip this and do it later in Settings.')}</p><div class="stack">${app.providers.map((p) => `<div class="prov" data-p="${p.id}"><span class="plogos">${p.logos.map(plogo).join('')}</span><div class="i"><b>${esc(p.name)}</b><span class="muted">${esc(t(p.blurb))}</span></div><span class="st"></span><button class="f btn" type="button" data-c="${p.id}">${t(p.onOff?.() ? 'Turn on' : 'Connect')}</button></div>`).join('')}</div>${foot()}`;
  const paint = async () => {
    await Promise.all(app.providers.map(async (p) => {
      const s = await p.status(provisional());
      const row = $(`.prov[data-p="${p.id}"]`, o);
      if (!row) return;
      $('.st', row).innerHTML = s.connected ? `${ico('check', 's')}${t(p.onOff?.() ? 'On' : 'Connected')}` : p.onOff?.() && s.detail && s.detail !== 'Off' ? esc(t(s.detail)) : '';
      $('[data-c]', row).textContent = actionLabel(p, s.connected);
      $('[data-c]', row).onclick = async () => {
        if (s.connected) {
          await p.disconnect?.(provisional());
          void paint();
        } else await connectProvider(p, provisional(), () => void paint());
      };
    }));
  };
  void paint();
  $('#nx', o).onclick = () => step(n, n + 1);
}

function taste(o: HTMLElement, n: number) {
  const picks = new Map(ob.picks.map((t) => [t.key, t]));
  o.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:32px"><div style="display:grid;gap:8px"><h1 style="font-size:48px">${t('Pick what you like')}</h1><p class="lead">${t('Choose at least three. This shapes your first Home.')}</p></div><div id="cnt" class="muted" style="font-size:26px;font-weight:600;font-variant-numeric:tabular-nums"></div></div><div class="taste" aria-busy="true">${'<div class="tc" style="background:var(--raised)"></div>'.repeat(18)}</div><div class="err" role="alert"></div>${foot(picks.size >= 3)}`;
  const up = () => {
    $('#cnt', o).textContent = t('{n} chosen', { n: picks.size });
    $<HTMLButtonElement>('#nx', o).disabled = picks.size < 3;
  };
  up();
  $('#nx', o).onclick = () => {
    ob.picks = [...picks.values()];
    step(n, ob.addOnly ? 5 : n + 1);
  };
  tasteTitles().then((list) => {
    if (!o.isConnected) return;
    const grid = $('.taste', o);
    grid.removeAttribute('aria-busy');
    grid.innerHTML = list.slice(0, 18).map((t) => `<button class="f tc ${picks.has(t.key) ? 'sel' : ''}" type="button" data-t="${esc(t.key)}" aria-pressed="${picks.has(t.key)}" aria-label="${esc(t.name)}">${artHtml(t)}<span class="ct" style="font-size:20px">${esc(t.name)}</span><span class="ok">${ico('check', 's')}</span></button>`).join('');
    const byKey = new Map(list.map((t) => [t.key, t]));
    $$('.tc', grid).forEach((c, i) => {
      A(c, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: Math.min(i, 10) * 20 });
      c.onclick = () => {
        const k = c.dataset.t!;
        if (picks.has(k)) picks.delete(k);
        else picks.set(k, byKey.get(k)!);
        c.classList.toggle('sel');
        c.setAttribute('aria-pressed', String(picks.has(k)));
        if (picks.has(k)) A($('.ok', c), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 180 });
        up();
      };
    });
    if (document.activeElement === document.body || !o.contains(document.activeElement)) go($('.tc', grid));
    else if (!$('.tc:focus', grid)) go($('.tc', grid));
  }).catch((e) => {
    $('.err', o).textContent = `${t((e as Error).message)}. ${t('Press Back to check your keys.')}`;
  });
}

/** A varied grid: the best of several genres and decades. */
export async function tasteTitles(): Promise<Title[]> {
  app.catalog.language = ob.language;
  app.catalog.region = ob.region;
  const gs: ['movie' | 'tv', number][] = [['movie', 28], ['movie', 35], ['movie', 878], ['movie', 18], ['movie', 27], ['tv', 18], ['tv', 35], ['tv', 80], ['movie', 16]];
  const lists = await Promise.all(gs.map(([k, g]) => app.catalog.discover(k, { with_genres: g, sort_by: 'vote_count.desc' })));
  const out: Title[] = [], seen = new Set<string>();
  for (let i = 0; out.length < 18 && i < 6; i++) for (const l of lists) {
    const t = l[i];
    if (t && !seen.has(t.key) && out.length < 18) {
      seen.add(t.key);
      out.push(t);
    }
  }
  return out;
}

function regionLabel(code: string, fallback: string) {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) ?? fallback;
  } catch {
    return fallback;
  }
}

function prefs(o: HTMLElement) {
  const group = (k: 'language' | 'region' | 'maturity', label: string, opts: readonly (readonly [string, string])[]) => `<div class="stack"><span class="muted">${t(label)}</span><div class="btns" data-g="${k}">${opts.map(([v, l]) => `<button class="f chip" type="button" data-v="${v}" aria-pressed="${ob[k] === v}">${l}</button>`).join('')}</div></div>`;
  o.innerHTML = `<h1>${t('A few preferences')}</h1>${group('language', 'Language', LANGUAGES)}${group('region', 'Region, for what is available', REGIONS.map(([c, l]) => [c, regionLabel(c, l)] as const))}${group('maturity', 'Show titles up to', MATURITY.map((m) => [m, t(m)] as const))}${foot(true, t('Finish'))}`;
  $$('[data-g]', o).forEach((g) => $$('.chip', g).forEach((c) => (c.onclick = () => {
    ob[g.dataset.g as 'language'] = c.dataset.v!;
    $$('.chip', g).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    if (g.dataset.g === 'language') {
      void chooseLanguage(c.dataset.v!).then(() => {
        render(5, 1);
        go($(`[data-v="${c.dataset.v}"]`, TV()));
      });
    }
  })));
  $('#nx', o).onclick = () => {
    const p: Profile = { id: newId(4), name: cap(ob.name.trim()) || 'You', color: ob.color, photo: ob.photo, photoOf: ob.photoOf, language: ob.language, region: ob.region, maturity: ob.maturity };
    finishCb(p, ob.picks);
    if (!ob.name.trim()) toast(t('Profile saved'));
  };
}
