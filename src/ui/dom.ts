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

export function fitTv() {
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    TV().style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  addEventListener('resize', fit);
  fit();
}
export const tvScale = () => TV().getBoundingClientRect().width / 1920;

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
