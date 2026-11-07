// Docs: docs/03 - Features/Profiles.md
// Purpose: picks a famous actor as a profile's picture: TMDB's most popular actors, or a search by name.
import type { Actor } from '@/core/catalog';
import { app } from './app';
import { A, $, $$, cascade, esc, ico, leave, TV } from './dom';
import { go } from './focus';
import { t } from './i18n';
import { bindKeyboard, keyboardHtml } from './textentry';

/**
 * Opens the actor picker over the page. Resolves with the actor chosen, `null` for no photo (colour and initial),
 * or `undefined` when closed with Back. `current` is the photo the profile has now, marked in the grid.
 */
export function pickActor(opener: HTMLElement, current?: string): Promise<Actor | null | undefined> {
  return new Promise((done) => {
    TV().insertAdjacentHTML('beforeend', `<div class="modal acm" role="dialog" aria-label="${t('Choose an actor')}"><div class="acm-in"><header><h2>${t('Choose an actor')}</h2><span class="muted">${t('Most popular on TMDB, or search by name')}</span></header><div class="acm-body"><div class="stack"><div class="nm" aria-live="polite"></div>${keyboardHtml(false)}</div><div class="acm-clip"><div class="acm-grid" role="list"><span class="btn" aria-busy="true">${t('Loading')}</span></div></div></div></div></div>`);
    const m = $('.acm', TV()), grid = $('.acm-grid', m);
    A($('.acm-in', m), [{ opacity: 0, transform: 'translateY(32px)' }, { opacity: 1, transform: 'none' }], { duration: 340 });
    A(m, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    const close = (v: Actor | null | undefined) => {
      leave(m);
      (window as unknown as { _mret?: () => void })._mret = undefined;
      if (opener.isConnected) go(opener);
      done(v);
    };
    (window as unknown as { _mret?: () => void })._mret = () => close(undefined);

    let q = '', seq = 0, timer = 0, first = true;
    const draw = async () => {
      const me = ++seq;
      grid.setAttribute('aria-busy', 'true');
      const list = await app.catalog.actors(q).catch(() => [] as Actor[]);
      if (me !== seq || !m.isConnected) return;
      grid.removeAttribute('aria-busy');
      grid.style.transform = 'none';
      const none = q ? '' : `<button class="f ac none" type="button" role="listitem" data-i="-1" aria-pressed="${!current}"><span class="acp">${ico('circle-dashed')}</span><b>${t('No photo')}</b><span class="muted">${t('Colour and initial')}</span></button>`;
      grid.innerHTML = list.length || none ? none + list.map((a, i) => `<button class="f ac" type="button" role="listitem" data-i="${i}" aria-pressed="${a.photo === current}" aria-label="${esc(a.name)}"><span class="acp"><img src="${esc(app.catalog.image(a.photo, 'w185') ?? '')}" alt="" loading="lazy"></span><b>${esc(a.name)}</b>${a.known.length ? `<span class="muted">${esc(a.known.join(', '))}</span>` : ''}</button>`).join('') : `<p class="muted">${esc(t('No actor named "{q}"', { q }))}</p>`;
      $$<HTMLButtonElement>('.ac', grid).forEach((b) => {
        const i = Number(b.dataset.i);
        b.onclick = () => close(i < 0 ? null : list[i]!);
        // Keep the focused actor in view: the grid slides, the page doesn't scroll.
        b.addEventListener('focus', () => {
          const room = (grid.parentElement as HTMLElement).clientHeight - 24;
          grid.style.transform = `translateY(${-Math.max(0, Math.min(grid.scrollHeight - room, b.offsetTop - room / 3))}px)`;
        });
      });
      // A picture that doesn't load leaves the actor out rather than an empty frame.
      $$<HTMLImageElement>('.ac img', grid).forEach((img) => img.addEventListener('error', () => img.closest('.ac')?.remove()));
      cascade($$('.ac', grid), { from: 'pop', step: 40, max: 12 });
      if (first) {
        first = false;
        go((current ? $('.ac[aria-pressed="true"]', grid) : null) ?? $('.ac:not(.none)', grid) ?? $('.ac', grid) ?? $('.kb .key', m));
      }
    };
    bindKeyboard(m, (k) => {
      q = k === 'del' ? q.slice(0, -1) : (q + k).slice(0, 30);
      $('.nm', m).textContent = q;
      clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), 300);
    });
    void draw();
  });
}
