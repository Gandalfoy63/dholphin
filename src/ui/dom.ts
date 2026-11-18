// Docs: docs/05 - UI-UX/Motion.md
// Purpose: small DOM helpers, and the one function every animation goes through.
export const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** An icon from the sprite, which `loadIcons` puts in the page once (an outside sprite was fetched again and again). */
export const ico = (n: string, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
export async function loadIcons() {
  const svg = await fetch('./icons.svg').then((r) => (r.ok ? r.text() : ''), () => '');
  if (!svg || document.getElementById('icons')) return;
  document.body.insertAdjacentHTML('afterbegin', svg.replace('<svg ', '<svg id="icons" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" '));
}
export const plogo = (file: string) => `<img class="plogo" src="./providers/${file}" alt="">`;
export const TV = () => $('#tv');

/** The Android app's page is https; a server at home is often plain http, and the WebView may block or upgrade its pictures. */
const IN_APP = typeof window !== 'undefined' && location.protocol === 'https:' && location.host === 'appassets.androidplatform.net';
/** A picture's address as the page should load it: on Android, an http one goes through the app (MainActivity.httpImage). */
export const viaApp = (u: string): string => (IN_APP ? throughApp(u, location.origin) : u);
/** `http://host:port/path?q` as `<app>/http-image/<encoded http://host:port>/path?q`; anything else as it is. */
export function throughApp(u: string, app: string): string {
  if (!u.startsWith('http://')) return u;
  const x = new URL(u);
  return `${app}/http-image/${encodeURIComponent(x.origin)}${x.pathname === '/' ? '' : x.pathname}${x.search}`;
}

// A long, soft ease out: quick to answer the key, then a slow settle. Every duration is stretched by K, as CSS does
// with --k, so the whole app keeps one tempo.
const OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const K = 1.35;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const RISE: Keyframe[] = [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }];
export const FADE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
export const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

/** Only transform and opacity, interruptible. Reduced motion keeps fades and drops movement. */
export function A(el: Element | null | undefined, frames: Keyframe[], o: KeyframeAnimationOptions & { duration?: number; delay?: number } = {}): Animation | null {
  if (!el) return null;
  let fr = frames;
  const r = reduced();
  if (r) {
    fr = frames.map((f) => {
      const c = { ...f };
      delete c.transform;
      delete c.translate;
      delete c.scale;
      delete c.rotate;
      return c;
    });
    if (!fr.some((f) => 'opacity' in f)) return null;
  }
  return el.animate(fr, { easing: OUT, fill: 'backwards', ...o, duration: r ? Math.min(o.duration ?? 300, 200) : (o.duration ?? 300) * K, delay: r ? 0 : (o.delay ?? 0) * K });
}

/** How items arrive in a cascade: rising, from the right, or growing in place. */
const ARRIVE: Record<'up' | 'right' | 'pop', Keyframe[]> = {
  up: [{ opacity: 0, translate: '0 32px', scale: '.94' }, { opacity: 1, translate: '0 0', scale: '1' }],
  right: [{ opacity: 0, translate: '40px 0', scale: '.97' }, { opacity: 1, translate: '0 0', scale: '1' }],
  pop: [{ opacity: 0, scale: '.82' }, { opacity: 1, scale: '1' }],
};

/**
 * Items arrive one by one, each a little after the one before: the same movement for cards, people, tiles, lists
 * and seasons, so the whole app moves alike. It uses the `translate` and `scale` properties, not `transform`, so it
 * never holds back a focus zoom or a row's slide. Past `max` items the rest come together.
 */
export function cascade(els: Element[], o: { from?: 'up' | 'right' | 'pop'; step?: number; delay?: number; max?: number; duration?: number } = {}) {
  const step = o.step ?? 55, max = o.max ?? 10;
  els.forEach((e, i) => A(e, ARRIVE[o.from ?? 'up'], { duration: o.duration ?? 460, delay: (o.delay ?? 0) + Math.min(i, max) * step }));
}

/** A layer leaves: it fades and settles back a little, then is removed. `then` runs once it is gone. */
export function leave(el: HTMLElement, then?: () => void) {
  el.style.pointerEvents = 'none';
  const a = A(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.985)' }], { duration: 200, fill: 'forwards', easing: 'cubic-bezier(.4,0,1,1)' });
  const done = () => {
    el.remove();
    then?.();
  };
  if (a) a.finished.then(done, done);
  else done();
}

export function toast(message: string) {
  $('.toast', TV())?.remove();
  TV().insertAdjacentHTML('beforeend', `<div class="toast" role="status">${esc(message)}</div>`);
  const e = $('.toast', TV());
  A(e, FADE, { duration: 200 });
  setTimeout(() => e.remove(), 3200);
}

/** The widest the canvas grows, for a wide window (21:9). */
const MAX_W = 2560;

/**
 * What the app runs on. `tv`: a remote, or a computer's mouse and keys, on the 1080-high canvas. `phone` and `tablet`:
 * a touch screen, whose primary pointer is a finger (Touch Layout).
 */
export type Form = 'tv' | 'phone' | 'tablet';
let form: Form = 'tv';
/** CSS pixels per design pixel on a touch screen: the design's sizes, read at arm's length rather than at 3 m. */
export const TOUCH_SCALE: Record<Exclude<Form, 'tv'>, number> = { phone: 0.6, tablet: 0.75 };
/** A phone's shorter side is under this many CSS pixels; a tablet's is not. */
const PHONE_MAX = 600;
/**
 * The form, from the primary pointer and the screen: a finger on a short screen is a phone. A TV's WebView has no
 * pointer, and a computer's is fine, so both stay `tv`. `?form=phone` (or tablet, tv) asks for one, for a test.
 */
export function detectForm(): Form {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('form');
  if (asked === 'tv' || asked === 'phone' || asked === 'tablet') return asked;
  if (typeof matchMedia === 'undefined' || !matchMedia('(pointer: coarse)').matches) return 'tv';
  return Math.min(innerWidth, innerHeight) < PHONE_MAX ? 'phone' : 'tablet';
}
/** The form chosen at start. */
export const formOf = () => form;
/** A touch screen: pages scroll natively, nothing moves with focus, nothing waits for a hover. */
export const touch = () => form !== 'tv';

/**
 * Fits the canvas to the window.
 *
 * On a TV it is 1080 high. A TV is 16:9, so 1920 wide. A computer's browser window is often wider (a laptop with its
 * toolbars): the canvas then widens to fill it, instead of black bars at the sides. A taller one keeps 1920 and
 * centres it.
 *
 * On a touch screen it is the screen itself, in design pixels: a phone held upright is about 650 by 1400. The
 * navigation is a bar at the bottom when the screen is upright, a rail at the left when it lies sideways.
 */
export function fitTv() {
  form = detectForm();
  const tv = TV();
  if (form !== 'tv') tv.dataset.form = form;
  const fit = () => {
    if (form !== 'tv') {
      const s = TOUCH_SCALE[form], w = innerWidth / s, h = innerHeight / s;
      tv.style.width = `${w}px`;
      tv.style.height = `${h}px`;
      tv.style.setProperty('--tvw', `${w}px`);
      tv.style.setProperty('--tvh', `${h}px`);
      tv.style.setProperty('--s', String(s));
      tv.style.transform = `scale(${s})`;
      tv.dataset.nav = innerWidth > innerHeight ? 'rail' : 'bar';
      return;
    }
    const w = Math.round(Math.min(MAX_W, Math.max(1920, (1080 * innerWidth) / innerHeight)));
    const s = Math.min(innerWidth / w, innerHeight / 1080);
    tv.style.width = `${w}px`;
    tv.style.setProperty('--tvw', `${w}px`);
    tv.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  addEventListener('resize', fit);
  fit();
}
/** The canvas's width: 1920 on a TV, up to 2560 in a wide browser window, the screen's on a touch screen. */
export const tvW = () => TV().offsetWidth || 1920;
/** The canvas's height: 1080, except on a touch screen. */
export const tvH = () => TV().offsetHeight || 1080;
export const tvScale = () => TV().getBoundingClientRect().height / tvH();

/**
 * A layer's Close button, shown on a touch screen only (a remote and a computer have Back): pinned at the top right,
 * it does what Back does (`installKeys`). `label` is already translated.
 */
export const closeHtml = (label: string) => `<button class="f xbtn" type="button" aria-label="${esc(label)}">${ico('x')}<span>${esc(label)}</span></button>`;

/** The Dholphin mark and wordmark, with its start animation. */
const D = 'M40 32H120A96 96 0 0 1 120 224H40Z';
/** The dolphin of the logo, alone: also the one leaping on the profile loader. */
export const DOL = 'M68 170A63 63 0 0 1 103.6 113.3C107.7 104.2 106.4 90.5 99.5 78C117.3 83.7 132.4 94.6 144.7 108.5A63 63 0 0 1 194 170A86 86 0 0 0 68 170Z';
let clip = 0;
export function logoMark(cut = 'var(--bg)') {
  const id = `lc${++clip}`;
  return `<svg class="lg" viewBox="0 0 256 256" aria-hidden="true" style="overflow:visible"><defs><clipPath id="${id}"><path d="${D}"/></clipPath></defs><path class="lg-d" d="${D}" fill="var(--accent)" style="transform-box:fill-box;transform-origin:center"/><g clip-path="url(#${id})"><path class="lg-dol" fill="${cut}" style="transform-box:fill-box;transform-origin:center" d="${DOL}"/><g transform="skewX(-20)"><rect class="lg-sh" x="-40" width="44" height="256" fill="#fff" opacity=".28"/></g></g></svg>`;
}
export function logoStart(r: ParentNode) {
  A($('.lg-d', r), [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
  A($('.lg-dol', r), [{ transform: 'translate(-64px,132px) rotate(-40deg)', easing: 'cubic-bezier(.2,.7,.4,1)' }, { transform: 'translate(-6px,-12px) rotate(5deg)', offset: 0.68, easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: 'none' }], { duration: 500, delay: 180, fill: 'both' });
  const sh = $('.lg-sh', r);
  if (reduced()) sh.style.opacity = '0';
  else A(sh, [{ transform: 'translateX(0)' }, { transform: 'translateX(320px)' }], { duration: 420, delay: 640, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
}
