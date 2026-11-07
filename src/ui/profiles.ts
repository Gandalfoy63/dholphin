// Docs: docs/03 - Features/Profiles.md
// Purpose: who's watching: choose, PIN, edit, add. Choosing runs the profile transition.
import type { Profile } from '@/sdk/types';
import { Library } from '@/core/library';
import { app, COLORS } from './app';
import { A, $, $$, cascade, DOL, esc, ico, plogo, leave, reduced, tvScale, TV, FADE, FADE_OUT, RISE } from './dom';
import { go, nav } from './focus';
import { t } from './i18n';
import { bindKeyboard, keyboardHtml } from './textentry';
import { pickActor } from './actors';
import { bindSetup, setupHtml } from './setup';
import { connectProvider } from './onboarding';

let managing = false;
/** The profile's picture: the actor chosen for it, over its colour and initial (which show if the photo can't load). */
export const avatar = (p: Pick<Profile, 'name' | 'color' | 'photo'>, cls = '') => `<span class="av ${cls}" style="background:${p.color}">${esc(p.name[0] ?? '?')}${p.photo ? `<img class="avp" src="${esc(app.catalog.image(p.photo, 'w185') ?? '')}" alt="" loading="lazy">` : ''}</span>`;

let stopSetup: () => void = () => undefined;

/** A short report: what the phone's setup changed, or didn't. OK or Back closes it. */
export function showLines(title: string, lines: string[]) {
  const ret = document.activeElement as HTMLElement | null;
  TV().insertAdjacentHTML('beforeend', `<div class="modal"><div class="panel" style="justify-items:start;gap:16px"><h2 style="font-size:32px">${esc(title)}</h2><ul class="lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><div class="btns"><button class="f btn pri" id="lok" type="button">${t('OK')}</button></div></div></div>`);
  const m = $('.modal:last-child', TV());
  A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  const shut = () => {
    m.remove();
    (window as unknown as { _mret?: () => void })._mret = undefined;
    if (ret?.isConnected) go(ret);
  };
  (window as unknown as { _mret?: () => void })._mret = shut;
  $('#lok', m).onclick = shut;
  go($('#lok', m));
}

export function showProfiles(onPick: (p: Profile) => void, onAdd: () => void) {
  const canAdd = app.profiles.length < 8;
  TV().innerHTML = `<div class="ctr"><div class="who"><h1>${t(managing ? 'Manage profiles' : "Who's watching?")}</h1><div class="plist">${app.profiles.map((p, i) => `<button class="f pf" data-i="${i}" type="button" aria-label="${esc(p.name)}${p.pin ? ', PIN required' : ''}${p.kids ? ', Kids' : ''}">${avatar(p).replace('</span>', managing ? `<span class="ed">${ico('pencil')}</span></span>` : '</span>')}<span class="n">${esc(p.name)}${p.kids ? `<span class="kid">${t('Kids')}</span>` : ''}${p.pin ? ico('lock', 's') : ''}</span></button>`).join('')}${canAdd ? `<button class="f pf" id="addp" type="button"><span class="av addp">${ico('plus')}</span><span class="n">${t('Add profile')}</span></button>` : ''}</div><button class="f btn" id="mng" type="button">${managing ? `${ico('check', 's')}${t('Done')}` : `${ico('pencil', 's')}${t('Manage profiles')}`}</button>${setupHtml()}</div></div>`;
  const who = $('.who', TV());
  // On a TV that can serve it, the QR at the bottom sets everything up from a phone; the screen shows what changed.
  stopSetup();
  const setup = bindSetup(who, (lines) => {
    showProfiles(onPick, onAdd);
    showLines(t('From your phone'), lines);
  });
  stopSetup = () => void setup.then((stop) => stop());
  nav.onBack = () => undefined;
  A($('h1', who), RISE, { duration: 320 });
  cascade($$('.pf', who), { from: 'pop', step: 90, delay: 100 });
  $$('.pf', who).forEach((el) => {
    el.onclick = () => {
      if (el.id === 'addp') return onAdd();
      const p = app.profiles[Number(el.dataset.i)]!;
      if (managing) {
        stopSetup();
        return editor(p, () => showProfiles(onPick, onAdd));
      }
      if (p.pin) return pin(el, p, () => transition(el, p, onPick));
      transition(el, p, onPick);
    };
  });
  A($('#mng', who), FADE, { duration: 240, delay: 320 });
  $('#mng', who).onclick = () => {
    managing = !managing;
    showProfiles(onPick, onAdd);
    go($('#mng', TV()));
  };
  go($('.pf', who));
}

function transition(el: HTMLElement, p: Profile, onPick: (p: Profile) => void) {
  stopSetup();
  const who = $('.who', TV());
  $$('.pf,h1,#mng', who).forEach((e) => {
    if (e !== el) A(e, FADE_OUT, { duration: 160, fill: 'forwards' });
  });
  const r = el.getBoundingClientRect(), tv = TV().getBoundingClientRect(), s = tvScale();
  const dx = (tv.left + tv.width / 2 - (r.left + r.width / 2)) / s, dy = (tv.top + tv.height / 2 - (r.top + r.height / 2)) / s;
  el.style.transform = 'none';
  const a = A(el, [{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(1.3)` }], { duration: 420, fill: 'forwards' });
  const next = () => onPick(p);
  if (a) a.finished.then(next, next);
  else next();
}

function pin(el: HTMLElement, p: Profile, ok: () => void) {
  let v = '';
  TV().insertAdjacentHTML('beforeend', `<div class="modal"><div class="panel"><h2 style="font-size:36px">${esc(t('PIN for {name}', { name: p.name }))}</h2><div class="dots">${'<i></i>'.repeat(4)}</div><div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="f key" type="button">${n}</button>`).join('')}<span></span><button class="f key" type="button">0</button><button class="f key" type="button" aria-label="${t('Delete')}">${ico('delete', 's')}</button></div><div class="err" role="alert"></div></div></div>`);
  const m = $('.modal', TV());
  A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  $$('.key', m).forEach((k) => (k.onclick = () => {
    v = k.getAttribute('aria-label') ? v.slice(0, -1) : v + k.textContent;
    $$('.dots i', m).forEach((d, n) => d.classList.toggle('on', n < v.length));
    if (v.length === 4) {
      if (v === p.pin) {
        m.remove();
        ok();
      } else {
        v = '';
        $$('.dots i', m).forEach((d) => d.classList.remove('on'));
        $('.err', m).textContent = t('That PIN is not right');
      }
    }
  }));
  (window as unknown as { _mret: () => void })._mret = () => {
    m.remove();
    go(el);
  };
  go($('.key', m));
}

function editor(p: Profile, done: () => void) {
  let name = p.name, color = p.color, kids = !!p.kids, pinValue = p.pin ?? '', photo = p.photo, photoOf = p.photoOf;
  TV().innerHTML = `<div class="onb"><div class="obody" style="justify-content:center"><h1>${esc(t('Edit {name}', { name: p.name }))}</h1><div class="two"><div class="stack"><div class="nm">${esc(name)}</div>${keyboardHtml(false)}</div><div class="stack">${avatar({ name, color, photo }).replace('class="av ', 'id="pa" class="av ')}${actorButton(photoOf)}<span class="muted">${t('Colour')}</span><div class="swatches">${COLORS.map((c) => `<button class="f sw" type="button" aria-label="Colour" style="background:${c}" aria-pressed="${c === color}" data-c="${c}"></button>`).join('')}</div><button class="f chip" id="kids" type="button" aria-pressed="${kids}">${t('Kids profile')}</button><div class="btns" id="accts">${app.providers.filter((q) => q.fields?.length && q.connect).map((q) => `<button class="f btn" type="button" data-acct="${q.id}">${plogo(q.logos[0]!)}${esc(q.name)}</button>`).join('')}</div><div class="btns" style="margin-top:32px"><button class="f btn pri" id="sv" type="button">${t('Save')}</button><button class="f btn" id="cn" type="button">${t('Cancel')}</button><button class="f btn" id="rm" type="button" ${app.profiles.length < 2 ? 'disabled' : ''}>${ico('trash-2', 's')}${t('Delete')}</button></div></div></div></div></div>`;
  const tv = TV();
  bindKeyboard(tv, (k) => {
    name = k === 'del' ? name.slice(0, -1) : (name + k).slice(0, 14);
    $('.nm', tv).textContent = name;
    preview();
    $<HTMLButtonElement>('#sv', tv).disabled = !name.trim();
  });
  const preview = () => ($('#pa', tv).outerHTML = avatar({ name: name || p.name, color, photo }).replace('class="av ', 'id="pa" class="av '));
  $$('.sw', tv).forEach((s) => (s.onclick = () => {
    color = s.dataset.c!;
    $$('.sw', tv).forEach((x) => x.setAttribute('aria-pressed', String(x === s)));
    preview();
  }));
  $('#act', tv).onclick = async () => {
    const a = await pickActor($('#act', tv), photo);
    if (a === undefined) return;
    photo = a?.photo;
    photoOf = a?.name;
    preview();
    $('#act', tv).innerHTML = actorLabel(photoOf);
  };
  // Each service this profile signs in to on its own (Jellyfin: its own user), connected from here.
  const paintAccts = () => $$<HTMLButtonElement>('[data-acct]', tv).forEach(async (b) => {
    const q = app.provider(b.dataset.acct!)!;
    const s = await q.status(p).catch(() => ({ connected: false }));
    if (b.isConnected) b.innerHTML = `${plogo(q.logos[0]!)}${esc(t(s.connected ? '{name}: connected' : '{name}: connect', { name: q.name }))}`;
  });
  paintAccts();
  $$<HTMLButtonElement>('[data-acct]', tv).forEach((b) => (b.onclick = () => void connectProvider(app.provider(b.dataset.acct!)!, p, () => {
    paintAccts();
    go(b);
  })));
  $('#kids', tv).onclick = () => {
    kids = !kids;
    $('#kids', tv).setAttribute('aria-pressed', String(kids));
  };
  $('#sv', tv).onclick = async () => {
    Object.assign(p, { name: name[0]!.toUpperCase() + name.slice(1), color, kids, pin: pinValue || undefined, photo, photoOf });
    await app.saveProfiles();
    done();
  };
  $('#cn', tv).onclick = done;
  $('#rm', tv).onclick = async () => {
    app.profiles = app.profiles.filter((x) => x !== p);
    await app.saveProfiles();
    await new Library(app.store, p.id).remove();
    done();
  };
  nav.onBack = done;
  A($('.obody', tv), RISE, { duration: 320 });
  go($('#sv', tv));
}

/** The button that opens the actor picker: says whose photo is used, if any. */
export const actorLabel = (photoOf?: string) => `${ico('user-round', 's')}${esc(photoOf ? t('Photo: {name}', { name: photoOf }) : t('Choose an actor'))}`;
export const actorButton = (photoOf?: string) => `<button class="f btn" id="act" type="button">${actorLabel(photoOf)}</button>`;

/**
 * While a profile's Home loads: its picture in the middle, two arcs turning around it at different speeds, its name
 * under. `done` waits until Home shows something (or 8 s), at least 900 ms in all so it never flashes, then the
 * picture grows a little as everything fades onto Home.
 */
/**
 * A small sea in shades of red under the picture: a back and a front wave rolling sideways at their own pace, and the
 * logo's dolphin leaping out between them, arcing over and diving back, a splash where it leaves and where it lands.
 * The front wave is opaque, so the dolphin is hidden while under water.
 */
const CREST = 'M0 40 Q 90 4 180 40 T 360 40 T 540 40 T 720 40 T 900 40 T 1080 40 T 1260 40 T 1440 40';
const WAVE = `${CREST} V 220 H 0 Z`;
/** A wave: its body, deep red fading into the dark below, and a light crest along its top. */
const waveSvg = (cls: string, top: string, deep: string, crest: string) => `<svg class="pl-w ${cls}" viewBox="0 0 1440 220" preserveAspectRatio="none"><defs><linearGradient id="g-${cls}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".45" stop-color="${deep}"/><stop offset="1" stop-color="#0E0E10"/></linearGradient></defs><path d="${WAVE}" fill="url(#g-${cls})"/><path d="${CREST}" fill="none" stroke="${crest}" stroke-width="3"/></svg>`;
const seaHtml = () => `<div class="pl-sea" aria-hidden="true">${waveSvg('pl-wb', '#B91C1C', '#5B0F14', 'rgba(248,113,113,.45)')}<span class="pl-splash pl-s1"></span><span class="pl-splash pl-s2"></span><svg class="pl-dol" viewBox="60 70 140 110"><defs><linearGradient id="g-dol" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A8F"/><stop offset=".55" stop-color="#F23B44"/><stop offset="1" stop-color="#B91C1C"/></linearGradient></defs><path d="${DOL}" fill="url(#g-dol)"/></svg>${waveSvg('pl-wf', '#7F1D1D', '#3B0A0D', '#F87171')}</div>`;

export function profileLoader(p: Profile): { done: () => Promise<void> } {
  $('.pload', TV())?.remove();
  TV().insertAdjacentHTML('beforeend', `<div class="pload" role="status" aria-label="${esc(t('Loading {name}', { name: p.name }))}"><div class="pl-ring"><span class="pl-glow" aria-hidden="true"></span><span class="pl-band" aria-hidden="true"></span>${avatar(p, 'pl-av')}</div>${seaHtml()}<span class="pl-name">${esc(p.name)}</span></div>`);
  const el = $('.pload', TV()), since = performance.now();
  A($('.pl-av', el), [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 360 });
  // The auroras appear one after another, each growing out from behind the picture.
  // The ring draws itself in, then the halo glows up behind it. `scale`, not `transform`, so the turning never stops.
  A($('.pl-band', el), reduced() ? FADE : [{ opacity: 0, scale: '.86' }, { opacity: 1, scale: '1' }], { duration: 700, delay: 80 });
  A($('.pl-glow', el), reduced() ? FADE : [{ opacity: 0, scale: '.7' }, { opacity: 1, scale: '1' }], { duration: 1100, delay: 200 });
  A($('.pl-sea', el), [{ opacity: 0, translate: '0 24px' }, { opacity: 1, translate: '0 0' }], { duration: 600, delay: 160 });
  A($('.pl-name', el), RISE, { duration: 360, delay: 140 });
  return {
    done: async () => {
      const ready = () => !!document.querySelector('#tv .hero .hp, #tv .row:not([hidden]) .card, #tv .pg h1');
      while (!ready() && performance.now() - since < 8000) await new Promise((ok) => setTimeout(ok, 60));
      const wait = 900 - (performance.now() - since);
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
      if (!el.isConnected) return;
      A($('.pl-ring', el), [{ transform: 'none' }, { transform: 'scale(1.08)' }], { duration: 420, fill: 'forwards' });
      A($('.pl-sea', el), [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      $$('.pl-band, .pl-glow', el).forEach((x) => A(x, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '1.3' }], { duration: 420, fill: 'forwards' }));
      await new Promise<void>((ok) => leave(el, ok));
    },
  };
}
