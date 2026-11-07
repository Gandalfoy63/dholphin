// Docs: docs/03 - Features/Cast.md
// Purpose: a person's page from the cast: photo, biography, dates, Like, Love and Not for me, known for, photos.
import type { PersonPage } from '@/core/catalog';
import type { Rating } from '@/core/library';
import { app } from './app';
import { A, $, $$, cascade, esc, ico, leave, TV, toast, RISE } from './dom';
import { go } from './focus';
import { getLocale, t as tr } from './i18n';
import { bindCards, cardHtml, type Item } from './rows';

const JOB: Record<string, string> = { Acting: 'Actor', Directing: 'Director', Writing: 'Writer', Production: 'Producer', Sound: 'Composer', Camera: 'Cinematographer', Editing: 'Editor' };

const day = (d: string) => {
  try {
    return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00`));
  } catch {
    return d;
  }
};
const years = (from: string, to?: string | null) => {
  const a = new Date(`${from}T12:00:00`), b = to ? new Date(`${to}T12:00:00`) : new Date();
  return b.getFullYear() - a.getFullYear() - (b < new Date(b.getFullYear(), a.getMonth(), a.getDate()) ? 1 : 0);
};

/**
 * Opens a person's page over the title. `open` plays a title from it: the person's page closes and that title's
 * details open. Back closes onto `opener`.
 */
export async function openPerson(ref: { id?: number; name: string }, opener: HTMLElement, open: (it: Item, el: HTMLElement) => void) {
  $('.ppl', TV())?.remove();
  TV().insertAdjacentHTML('beforeend', `<div class="modal ppl" role="dialog" aria-label="${esc(ref.name)}"><div class="ppl-scroll"><div class="ppl-top"><span class="btn" aria-busy="true">${tr('Loading')}</span></div><div class="ppl-secs"></div></div></div>`);
  const m = $('.ppl', TV()), scroll = $('.ppl-scroll', m), top = $('.ppl-top', m), secs = $('.ppl-secs', m);
  A(m, [{ opacity: 0, transform: 'scale(1.015)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
  const shut = () => {
    leave(m);
    (window as unknown as { _mret?: () => void })._mret = undefined;
    if (opener.isConnected) go(opener);
  };
  (window as unknown as { _mret?: () => void })._mret = shut;
  // The page moves with focus: the top for the buttons, a section's heading near the top for the rest.
  m.addEventListener('focusin', (e) => {
    const sec = (e.target as HTMLElement).closest<HTMLElement>('section');
    const most = Math.max(0, scroll.scrollHeight - 1080);
    scroll.style.transform = `translateY(${-(sec ? Math.min(most, Math.max(0, sec.offsetTop - 96)) : 0)}px)`;
  });

  const p = await app.catalog.person(ref).catch(() => null);
  if (!m.isConnected) return;
  if (!p) {
    top.innerHTML = `<div class="ppl-text"><h1>${esc(ref.name)}</h1><p class="muted">${tr('TMDB has no page for this person')}</p></div>`;
    return;
  }
  const rated = (await app.library.people())[p.id]?.rating;
  const mark = (id: string, icon: string, label: string, on: boolean, cls = '') => `<button class="f btn io ${cls}" id="${id}" type="button" aria-pressed="${on}" aria-label="${esc(label)}">${ico(icon)}<span class="tip">${esc(label)}</span></button>`;
  const life = [
    tr(JOB[p.job] ?? p.job),
    p.born ? (p.died ? tr('{from} – {to}', { from: day(p.born), to: day(p.died) }) : tr('Born {date}', { date: day(p.born) })) : '',
    p.born ? tr('{n} years', { n: years(p.born, p.died) }) : '',
    p.place ?? '',
  ].filter(Boolean);
  const long = p.bio.length > 700;
  top.innerHTML = `<div class="ppl-ph">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span class="ini">${esc(p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>`}</div><div class="ppl-text"><h1>${esc(p.name)}</h1><div class="meta">${life.map((x) => `<span>${esc(x)}</span>`).join('')}</div>${p.bio ? `<p class="ppl-bio ${long ? 'clip' : ''}">${esc(p.bio)}</p>${p.bioInEnglish ? `<span class="muted ppl-note">${tr('Biography in English: TMDB has none in your language yet')}</span>` : ''}` : `<p class="muted">${tr('No biography yet')}</p>`}<div class="btns">${long ? `<button class="f btn" id="pbio" type="button" aria-expanded="false">${ico('info', 's')}${tr('Full biography')}</button>` : ''}<span class="marks">${mark('pdy', 'thumbs-up', tr('Like'), rated === 'like')}${mark('pdv', 'heart', tr('Love'), rated === 'love', 'love')}${mark('pdn', 'thumbs-down', tr('Not for me'), rated === 'dislike')}</span></div></div>`;
  // Photo first, then the text, line by line.
  A($('.ppl-ph', top), [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 380 });
  $$('.ppl-text > *', top).forEach((e, i) => A(e, RISE, { duration: 360, delay: 60 + i * 45 }));

  const bio = $('#pbio', top);
  if (bio) bio.onclick = () => {
    const open = $('.ppl-bio', top).classList.toggle('clip') === false;
    bio.setAttribute('aria-expanded', String(open));
    bio.innerHTML = `${ico('info', 's')}${tr(open ? 'Shorter biography' : 'Full biography')}`;
  };
  // One rating at a time; pressing the one that is on takes it off. Not for me leaves their titles out of Top Picks.
  const rate = (id: string, v: Rating) => ($(`#${id}`, top).onclick = async () => {
    const off = (await app.library.people())[p.id]?.rating === v;
    await app.library.ratePerson({ id: p.id, name: p.name, photo: p.photo, keys: p.known.map((x) => x.key) }, off ? null : v);
    $$('#pdy,#pdv,#pdn', top).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (!off) $(`#${id}`, top).setAttribute('aria-pressed', 'true');
    toast(off ? tr('Removed your rating') : v === 'dislike' ? tr('Fewer titles with {name}', { name: p.name }) : tr('More with {name} on Home', { name: p.name }));
  });
  rate('pdy', 'like');
  rate('pdv', 'love');
  rate('pdn', 'dislike');

  secs.innerHTML = '';
  if (p.known.length) {
    const list: Item[] = p.known.map((title) => ({ title }));
    secs.insertAdjacentHTML('beforeend', `<section class="ppl-known"><h2>${tr('Known for')}</h2><div class="cclip"><div class="ctrack ppl-track">${list.map((i) => cardHtml(i)).join('')}</div></div></section>`);
    const track = $('.ppl-track', secs);
    bindCards(track, list, (it, el) => {
      shut();
      open(it, el);
    });
    $$('.card', track).forEach((el) => el.addEventListener('focus', () => {
      const room = 1920 - 96 - 64, end = el.offsetLeft + el.offsetWidth;
      track.style.transform = `translateX(${-Math.max(0, end - room + 40)}px)`;
    }));
  }
  if (p.photos.length > 1) {
    secs.insertAdjacentHTML('beforeend', `<section class="ppl-photos"><h2>${tr('Photos')}</h2><div class="cclip"><div class="ctrack ppl-ptrack" role="list">${p.photos.map((src, i) => `<div class="f ppl-pic" tabindex="0" role="listitem" aria-label="${esc(tr('Photo {n} of {name}', { n: i + 1, name: p.name }))}"><img src="${esc(src)}" alt="" loading="lazy"></div>`).join('')}</div></div><p class="ccred">${tr('Photos and biography from TMDB')}</p></section>`);
    const track = $('.ppl-ptrack', secs);
    $$('.ppl-pic', track).forEach((el) => el.addEventListener('focus', () => {
      const room = 1920 - 96 - 64, end = el.offsetLeft + el.offsetWidth;
      track.style.transform = `translateX(${-Math.max(0, end - room + 40)}px)`;
    }));
    $$<HTMLImageElement>('.ppl-pic img', track).forEach((img) => img.addEventListener('error', () => img.closest('.ppl-pic')?.remove()));
  }
  $$('section', secs).forEach((s, n) => {
    A($('h2', s), RISE, { duration: 360, delay: 200 + n * 120 });
    cascade($$('.card, .ppl-pic', s), { step: 60, delay: 260 + n * 120 });
  });
  go($('.marks .btn', top));
}
