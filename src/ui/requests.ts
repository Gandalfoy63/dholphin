// Docs: docs/03 - Features/Requests.md
// Purpose: the Requests page: every request of the household from Seerr, grouped by where it stands, with the download's progress and time left.
import type { RequestEntry, RequestStage, Title } from '@/sdk/types';
import { app } from './app';
import { openDetails } from './details';
import { $, $$, cascade, esc, ico } from './dom';
import { focusables, go } from './focus';
import { getLocale, t } from './i18n';
import { artHtml } from './rows';

/** The groups, in the order a person cares about: what is coming soon first. */
const GROUPS: { id: 'downloading' | 'waiting' | 'available' | 'off'; label: string; stages: RequestStage[] }[] = [
  { id: 'downloading', label: 'Downloading', stages: ['downloading'] },
  { id: 'waiting', label: 'Waiting', stages: ['pending', 'approved', 'searching'] },
  { id: 'available', label: 'Available', stages: ['available', 'partly'] },
  { id: 'off', label: 'Not coming', stages: ['declined', 'failed', 'deleted'] },
];
const STAGE: Record<RequestStage, [string, string]> = {
  pending: ['Waiting for approval', 'warn'], approved: ['Approved, in the queue', ''], searching: ['Looking for a download', ''],
  downloading: ['Downloading', 'warn'], partly: ['Partly available', 'ok'], available: ['Available', 'ok'],
  declined: ['Declined', 'err'], failed: ['Failed', 'err'], deleted: ['Removed', 'err'],
};
/** While the page is open, Seerr is asked again this often: downloads move. */
const REFRESH_MS = 15_000;
const SHOWN = 40;

type Who = 'all' | 'mine';
let who: Who = 'all';

/** Time left until `eta`, as "2 h 21 min", or null once past. */
export function timeLeft(eta: string | null, now = Date.now()): string | null {
  if (!eta) return null;
  const min = Math.round((Date.parse(eta) - now) / 60_000);
  if (!(min >= 0)) return null;
  if (min < 1) return t('less than a minute');
  const h = Math.floor(min / 60), m = min % 60;
  return h ? t('{h} h {m} min', { h, m }) : t('{m} min', { m });
}

const seasonsText = (s?: number[]) => {
  if (!s?.length) return '';
  const run = s.length > 1 && s.every((n, i) => !i || n === s[i - 1]! + 1);
  return s.length === 1 ? t('Season {n}', { n: s[0]! }) : run ? t('Seasons {a} to {b}', { a: s[0]!, b: s.at(-1)! }) : t('Seasons {list}', { list: s.join(', ') });
};

/**
 * A request as a poster box: the band at its bottom holds the name and where it stands. A download shows its
 * percentage and time left there, and its bar along the box's bottom edge.
 */
function boxHtml(e: RequestEntry, tl: Title, when: string) {
  const who = [e.requestedBy ?? '', when].filter(Boolean).join(' · ');
  let state: string, bar = '';
  if (e.stage === 'downloading' && e.download) {
    const pct = Math.round(e.download.progress * 100), left = timeLeft(e.download.eta);
    const at = e.download.eta ? new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(Date.parse(e.download.eta)) : '';
    state = `<span class="rqd"><b>${pct}%</b>${esc(left ? t('{time} left', { time: left }) : e.download.eta ? t('Almost done') : '')}</span>${left && at ? `<span class="rqw">${esc(t('ready at {time}', { time: at }))}</span>` : ''}`;
    bar = `<span class="prog rqbar"><i style="transform:scaleX(${e.download.progress})"></i></span>`;
  } else {
    const [label, tone] = STAGE[e.stage];
    state = `<span class="tag ${tone}">${esc(t(label))}</span>`;
  }
  const seasons = seasonsText(e.seasons);
  const label = [tl.name, t(STAGE[e.stage][0]), seasons, e.requestedBy ? t('asked by {name}', { name: e.requestedBy }) : ''].filter(Boolean).join(', ');
  return `<button class="f card poster rqc" type="button" data-rq="${esc(e.id)}" aria-label="${esc(label)}">${artHtml(tl, 'w300', 'poster')}${seasons ? `<span class="state">${esc(seasons)}</span>` : ''}<span class="rqb"><b class="rqn">${esc(tl.name)}</b>${state}${who ? `<span class="rqw">${esc(who)}</span>` : ''}</span>${bar}</button>`;
}

/**
 * Builds the page in `ct`, and keeps it current while it stays open. Titles come from the film data (in the
 * profile's language); a request whose title can't be found is left out.
 */
export async function pageRequests(ct: HTMLElement) {
  const q = app.providers.find((p) => p.requestList);
  if (!q) {
    ct.innerHTML = `<div class="pg"><h1>${t('Requests')}</h1><div class="empty"><b style="color:var(--text)">${t('No request service')}</b>${t('Connect Jellyfin with Seerr in Settings to ask for what your services don\'t have.')}</div></div>`;
    return;
  }
  ct.innerHTML = `<div class="pg rqpg"><div class="hhead"><h1>${t('Requests')}</h1><span class="muted" id="rqs">${ico('loader-circle', 's spin')}${t('Asking Seerr')}</span></div><div class="grid rqgrid">${'<div class="skc tall"></div>'.repeat(6)}</div></div>`;
  const titles = new Map<string, Title | null>();
  let entries: RequestEntry[] = [], failed = '', first = true, count = SHOWN;
  const load = async () => {
    try {
      entries = await q.requestList!(app.profile);
      failed = '';
    } catch (e) {
      failed = (e as Error).message;
    }
    const want = entries.slice(0, 200).filter((e) => !titles.has(`${e.kind}:${e.tmdbId}`));
    await Promise.all(want.map(async (e) => titles.set(`${e.kind}:${e.tmdbId}`, (await app.catalog.byIds([e.tmdbId], e.kind).catch(() => []))[0] ?? null)));
  };
  const draw = () => {
    if (!ct.isConnected || !$('.rqpg', ct)) return false;
    const keep = (document.activeElement as HTMLElement | null)?.dataset?.rq ?? (document.activeElement as HTMLElement | null)?.dataset?.rw;
    const shown = entries.filter((e) => titles.get(`${e.kind}:${e.tmdbId}`) && (who === 'all' || e.mine));
    const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(Date.now());
    const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(Date.parse(iso)) : '');
    let n = 0;
    const groups = GROUPS.map((g) => {
      const list = shown.filter((e) => g.stages.includes(e.stage));
      if (!list.length || n >= count) return '';
      const boxes = list.slice(0, Math.max(0, count - n)).map((e) => {
        n++;
        return boxHtml(e, titles.get(`${e.kind}:${e.tmdbId}`)!, day(e.requestedAt));
      }).join('');
      return `<h2 class="hgrp">${esc(t(g.label))} <span class="muted">${list.length}</span></h2><div class="grid rqgrid">${boxes}</div>`;
    }).join('');
    const mine = entries.filter((e) => e.mine).length;
    ct.innerHTML = `<div class="pg rqpg"><div class="hhead"><h1>${t('Requests')}</h1><span class="muted" id="rqs">${esc(failed ? t('Seerr could not be reached: {why}', { why: t(failed) }) : t('{n} requests · updated at {time}', { n: entries.length, time }))}</span></div><div class="btns" role="group" aria-label="${t('Whose requests')}"><button class="f chip" type="button" data-rw="all" aria-pressed="${who === 'all'}">${t('Everyone')}</button><button class="f chip" type="button" data-rw="mine" aria-pressed="${who === 'mine'}" ${mine ? '' : 'disabled'}>${t('Mine')}</button></div>${groups ? `<div class="rqgroups">${groups}</div>${shown.length > count ? `<div><button class="f btn" id="rqmore" type="button">${t('Show more')}</button></div>` : ''}` : `<div class="empty"><b style="color:var(--text)">${t(failed ? 'Requests could not load' : 'No requests yet')}</b>${t(failed ? 'Check Seerr in the server panel or in Settings.' : "Open a title your services don't have, and choose Request.")}</div>`}</div>`;
    $$<HTMLButtonElement>('[data-rq]', ct).forEach((b) => (b.onclick = () => {
      const e = entries.find((x) => x.id === b.dataset.rq)!;
      void openDetails(titles.get(`${e.kind}:${e.tmdbId}`)!, b);
    }));
    $$<HTMLButtonElement>('[data-rw]', ct).forEach((b) => (b.onclick = () => {
      who = b.dataset.rw as Who;
      draw();
      go($(`[data-rw="${who}"]`, ct));
    }));
    const more = $('#rqmore', ct);
    if (more) more.onclick = () => {
      count += SHOWN;
      draw();
      go($$('[data-rq]', ct)[count - SHOWN] ?? focusables(ct)[0]);
    };
    if (first) {
      first = false;
      cascade($$('.rqc', ct));
      go($('[data-rq]', ct) ?? focusables(ct)[0]);
    } else if (keep) go($(`[data-rq="${CSS.escape(keep)}"], [data-rw="${CSS.escape(keep)}"]`, ct) ?? focusables(ct)[0]);
    return true;
  };
  await load();
  if (!draw()) return;
  const timer = window.setInterval(async () => {
    if (!ct.isConnected || !$('.rqpg', ct)) return clearInterval(timer);
    // Not while a title is open over the page: its own view is in front.
    if (document.querySelector('.dlayer')) return;
    await load();
    if (!draw()) clearInterval(timer);
  }, REFRESH_MS);
}
