// Docs: docs/03 - Features/Playback.md
// Purpose: the app's own player: tracks, subtitles, speed, quality, skipping, seeking with previews, next episode.
import Hls from 'hls.js/dist/hls.light.mjs';
import type { Episode, InternalSession, Provider, StreamChoice, StreamTrack, Title } from '@/sdk/types';
import { clock, cuesAt, nextAt, parseCues, seekStep, segmentAt, trickplaySpot, type Cue } from '@/core/playback';
import { app } from './app';
import { A, $, $$, esc, ico, TV, toast, FADE } from './dom';
import { BACK_KEYS, go, nav } from './focus';
import { getLocale, t } from './i18n';

export interface PlayerPrefs { autoSkip: boolean; autoNext: boolean; subSize: 's' | 'm' | 'l'; audioLang?: string; subtitleLang?: string | null; maxBitrate?: number }
const DEFAULTS: PlayerPrefs = { autoSkip: false, autoNext: true, subSize: 'm' };
const prefsKey = () => `player:${app.profile.id}`;
export const loadPrefs = async (): Promise<PlayerPrefs> => ({ ...DEFAULTS, ...((await app.store.get<Partial<PlayerPrefs>>(prefsKey())) ?? {}) });
export const savePrefs = (p: PlayerPrefs) => app.store.set(prefsKey(), p);

/** Quality choices, as the most the stream may use: the server converts down to it. */
export const QUALITIES: [label: string, bps: number | undefined][] = [['Auto', undefined], ['Best', 120_000_000], ['1080p', 20_000_000], ['720p', 8_000_000], ['480p', 3_000_000]];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SKIP_LABEL: Record<string, string> = { intro: 'Skip intro', recap: 'Skip recap', preview: 'Skip preview', commercial: 'Skip ad' };
const SKIPPED: Record<string, string> = { intro: 'Intro skipped', recap: 'Recap skipped', preview: 'Preview skipped', commercial: 'Ad skipped' };
/** How long a seek waits for another press before it goes: held keys add up, then the video jumps once. */
const SEEK_WAIT = 650;
const NEXT_COUNTDOWN = 10;

const epLabel = (e?: Episode) => (e ? `S${e.season}:E${e.number} · ${e.name}` : '');

export async function player(p: Provider, title: Title, first: InternalSession, prefs: PlayerPrefs) {
  const ret = document.activeElement as HTMLElement | null;
  const btn = (a: string, icon: string, label: string, wide = false) =>
    `<button class="f pb${wide ? '' : ' io'}" type="button" data-a="${a}" aria-label="${t(label)}">${ico(icon)}<span class="${wide ? '' : 'tip'}">${t(label)}</span></button>`;
  TV().insertAdjacentHTML('beforeend', `<div class="player" role="dialog" aria-label="${esc(title.name)}"><video playsinline></video>
<div class="psub ${prefs.subSize}" aria-hidden="true"></div><div class="pspin" hidden>${ico('loader-circle', 'spin')}</div><div class="pflash" aria-hidden="true"></div><div class="pmsg" hidden></div><div class="pprompt"></div>
<div class="pctl"><div class="phead"><b>${esc(title.name)}</b><span class="pe muted"></span></div>
<div class="pscrub f" tabindex="0" role="slider" aria-label="${t('Position')}" aria-valuemin="0"><div class="pbar"><i class="pbuf"></i><i class="pplay"></i><span class="pmarks"></span><i class="pknob"></i></div><div class="pthumb" hidden><div class="pimg"></div><span class="ptt"></span><span class="pch"></span></div></div>
<div class="ptime"><span class="pn">0:00</span><span class="pst"></span><span class="psp"></span><span class="pend muted"></span><span class="pd">0:00</span></div>
<div class="prow">${btn('back', 'rotate-ccw', 'Back 10 seconds')}${btn('toggle', 'pause', 'Pause')}${btn('fwd', 'rotate-cw', 'Forward 10 seconds')}<span class="psp"></span>${btn('tracks', 'captions', 'Audio and subtitles', true)}${btn('speed', 'gauge', 'Speed', true)}${btn('quality', 'monitor-play', 'Quality', true)}${btn('episodes', 'list-video', 'Episodes', true)}${btn('next', 'skip-forward', 'Next episode', true)}</div></div>
<div class="ppanel" role="menu" hidden></div></div>`);
  const L = $('.player', TV()), v = L.querySelector('video')!, msg = $('.pmsg', L), bar = $('.pscrub', L), sub = $('.psub', L), prompt = $('.pprompt', L), panel = $('.ppanel', L), spin = $('.pspin', L);
  A(L, FADE, { duration: 200 });

  let s = first, episode = first.episode, hls: Hls | null = null, closing = false, idle = 0, ticker = 0, spinT = 0;
  let audioId = s.source.audioId, subId = s.source.subtitleId ?? -1, cues: Cue[] = [], subOffset = 0, shownCues = '';
  let rate = 1, maxBitrate = prefs.maxBitrate;
  let scrubAt: number | null = null, presses = 0, lastPress = 0, scrubT = 0;
  const skipped = new Set<string>();
  let nextShown = false, nextDismissed = false, countdown = 0, countT = 0, panelFrom: HTMLElement | null = null, busy = false;

  // ---- drawing ----
  const dur = () => (Number.isFinite(v.duration) ? v.duration : 0);
  const shown = () => !L.classList.contains('idle');
  const fmtEnd = (sec: number) => new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(Date.now() + sec * 1000);
  const paint = () => {
    const d = dur(), at = scrubAt ?? v.currentTime, f = d ? at / d : 0;
    $('.pplay', L).style.transform = `scaleX(${f})`;
    $('.pknob', L).style.left = `${f * 100}%`;
    const buf = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    $('.pbuf', L).style.transform = `scaleX(${d ? buf / d : 0})`;
    $('.pn', L).textContent = clock(at);
    $('.pd', L).textContent = d ? `-${clock(d - at)}` : '';
    $('.pend', L).textContent = d ? t('Ends at {time}', { time: fmtEnd((d - at) / (rate || 1)) }) : '';
    bar.setAttribute('aria-valuemax', String(Math.round(d)));
    bar.setAttribute('aria-valuenow', String(Math.round(at)));
    bar.setAttribute('aria-valuetext', clock(at));
  };
  const head = () => {
    $('.pe', L).textContent = epLabel(episode);
    const tracks = (s.source.audio?.length ?? 0) > 1 || (s.source.subtitles?.length ?? 0) > 0;
    $('[data-a="tracks"]', L).hidden = !tracks;
    $('[data-a="quality"]', L).hidden = !s.reload;
    $('[data-a="episodes"]', L).hidden = !(title.kind === 'series' && p.seasons && p.episodes && episode);
    $('[data-a="next"]', L).hidden = !s.next;
    $('.pmarks', L).innerHTML = (s.source.chapters ?? []).slice(1).map((c) => `<b style="left:${dur() ? (c.startSec / dur()) * 100 : 0}%"></b>`).join('');
  };
  const flash = (html: string) => {
    const f = $('.pflash', L);
    f.innerHTML = html;
    A(f, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 700 });
  };
  const wake = () => {
    L.classList.remove('idle');
    clearTimeout(idle);
    idle = window.setTimeout(() => {
      if (!v.paused && scrubAt === null && panel.hidden) {
        L.classList.add('idle');
        // Hidden controls keep no focus: OK then answers a skip button that is showing.
        const pb = $('.pprompt .f', L) as HTMLElement | null;
        if (pb) go(pb);
        else bar.focus({ preventScroll: true });
      }
    }, 4000);
  };
  const toggleIcon = () => {
    const b = $('[data-a="toggle"]', L);
    const label = t(v.paused ? 'Play' : 'Pause');
    b.innerHTML = `${ico(v.paused ? 'play' : 'pause')}<span class="tip">${label}</span>`;
    b.setAttribute('aria-label', label);
  };
  const waiting = (on: boolean) => {
    clearTimeout(spinT);
    if (on) spinT = window.setTimeout(() => (spin.hidden = false), 300);
    else spin.hidden = true;
  };
  const fail = (text: string) => {
    msg.hidden = false;
    msg.textContent = `${t(text)} ${t('Press Back to return.')}`;
  };

  // ---- subtitles: drawn by the page, so their size and timing can change ----
  const drawSubs = () => {
    const html = subId >= 0 ? cuesAt(cues, v.currentTime - subOffset).map((c) => `<span>${c.html}</span>`).join('<br>') : '';
    if (html !== shownCues) sub.innerHTML = shownCues = html;
  };
  const loadCues = async (tr?: StreamTrack) => {
    cues = [];
    drawSubs();
    if (!tr?.url) return;
    try {
      const r = await fetch(tr.url);
      if (r.ok && subId === tr.id) cues = parseCues(await r.text());
    } catch {
      toast(t('These subtitles could not load'));
    }
    drawSubs();
  };
  const track = (list: StreamTrack[] | undefined, id: number) => list?.find((x) => x.id === id);
  /** The track the server draws in, if one is. */
  const burned = () => {
    const tr = track(s.source.subtitles, s.source.subtitleId ?? -1);
    return tr && !tr.url ? tr : undefined;
  };

  // ---- the stream ----
  const report = (type: 'start' | 'progress' | 'stop') => s.report({ type, positionSec: v.currentTime || 0, paused: v.paused, audioId, subtitleId: subId }).catch(() => undefined);
  const attach = (at: number, autoplay = true) => {
    hls?.destroy();
    hls = null;
    msg.hidden = true;
    const src = s.source;
    if (src.hls && !v.canPlayType('application/vnd.apple.mpegurl')) {
      hls = new Hls({ enableWorker: false, startPosition: at || -1 });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) fail('The stream stopped.');
      });
      hls.loadSource(src.url);
      hls.attachMedia(v);
    } else {
      v.src = src.url;
      if (at) v.currentTime = at;
    }
    v.defaultPlaybackRate = v.playbackRate = rate;
    audioId = src.audioId;
    subId = src.subtitleId ?? -1;
    void loadCues(track(src.subtitles, subId));
    head();
    if (autoplay) v.play().catch(() => wake());
    void report('start');
  };
  /** A new stream of the same video: audio, drawn-in subtitles or quality. Playing goes on where it was. */
  const reload = async (choice: StreamChoice) => {
    if (!s.reload || busy) return;
    busy = true;
    waiting(true);
    const at = v.currentTime || 0, wasPaused = v.paused;
    try {
      s = await s.reload({ ...choice, maxBitrate, startSec: at });
      attach(at, !wasPaused);
    } catch (e) {
      toast(t((e as Error).message));
    } finally {
      busy = false;
      waiting(false);
    }
  };
  /** Ends this video's turn: the server and History learn where it stopped. */
  const finish = async () => {
    const positionSec = v.currentTime || 0, d = dur();
    await report('stop');
    if (d) await app.library.watched(title, { progress: positionSec / d, positionSec, durationSec: d, provider: p.id, label: episode?.name, episodeId: episode?.id });
  };
  const playEpisode = async (ep: Episode) => {
    if (busy) return;
    busy = true;
    closePanel();
    hidePrompt();
    waiting(true);
    await finish();
    try {
      const n = await p.play!({ title, episode: ep, choice: choiceNow() }, app.profile);
      if (n.kind !== 'internal') throw new Error('This video could not play.');
      s = n;
      episode = n.episode ?? ep;
      skipped.clear();
      nextShown = nextDismissed = false;
      cues = [];
      attach(n.source.startSec ?? 0);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      busy = false;
      waiting(false);
    }
  };
  /** What carries over to the next episode: the languages, not the track numbers. */
  const choiceNow = (): StreamChoice => {
    const tr = track(s.source.subtitles, subId);
    return { audioLang: track(s.source.audio, audioId ?? -1)?.lang, subtitleLang: subId < 0 ? null : tr?.url ? tr.lang : undefined, maxBitrate };
  };

  // ---- tracks ----
  const setAudio = async (id: number) => {
    if (id === audioId) return;
    const tr = track(s.source.audio, id);
    prefs.audioLang = tr?.lang;
    void savePrefs(prefs);
    await reload({ audioId: id, subtitleId: subId });
    toast(t('Audio: {name}', { name: tr?.label ?? '' }));
  };
  const setSub = async (id: number) => {
    const tr = track(s.source.subtitles, id);
    prefs.subtitleLang = id < 0 ? null : tr?.lang;
    void savePrefs(prefs);
    // Text is drawn here at once. Pictures are drawn in by the server: a new stream, and one without them to stop.
    if (burned() || (tr && !tr.url)) await reload({ audioId, subtitleId: id });
    else {
      subId = id;
      await loadCues(tr);
      void report('progress');
    }
    toast(id < 0 ? t('Subtitles off') : t('Subtitles: {name}', { name: tr?.label ?? '' }));
  };
  const cycle = (kind: 'audio' | 'sub') => {
    if (kind === 'audio') {
      const list = s.source.audio ?? [];
      if (list.length < 2) return toast(t('Only one audio track'));
      const at = list.findIndex((x) => x.id === audioId);
      return void setAudio(list[(at + 1) % list.length]!.id);
    }
    const list = s.source.subtitles ?? [];
    if (!list.length) return toast(t('No subtitles for this title'));
    const ids = [-1, ...list.map((x) => x.id)];
    void setSub(ids[(ids.indexOf(subId) + 1) % ids.length]!);
  };
  const setRate = (r: number) => {
    rate = r;
    v.playbackRate = v.defaultPlaybackRate = r;
    flash(`${ico('gauge')}<span>${r === 1 ? t('Normal') : `${r}x`}</span>`);
    paint();
  };

  // ---- seeking: presses add up, with a preview picture, then one jump ----
  const preview = (at: number) => {
    const th = $('.pthumb', L), d = dur();
    th.hidden = false;
    const tp = s.source.trickplay, img = $('.pimg', th);
    img.hidden = !tp;
    if (tp) {
      const spot = trickplaySpot(tp, at);
      Object.assign(img.style, { width: `${tp.width}px`, height: `${tp.height}px`, backgroundImage: `url("${tp.tile(spot.tile)}")`, backgroundPosition: `-${spot.x}px -${spot.y}px`, backgroundSize: `${tp.cols * tp.width}px ${tp.rows * tp.height}px` });
    }
    $('.ptt', th).textContent = clock(at);
    const ch = [...(s.source.chapters ?? [])].reverse().find((c) => c.startSec <= at);
    $('.pch', th).textContent = ch?.name ?? '';
    $('.pch', th).hidden = !ch;
    const w = bar.clientWidth, half = (tp?.width ?? 120) / 2;
    th.style.left = `${Math.max(half, Math.min(w - half, d ? (at / d) * w : 0))}px`;
  };
  const scrub = (dir: 1 | -1, least = 10) => {
    const now = performance.now();
    presses = now - lastPress < SEEK_WAIT ? presses + 1 : 0;
    lastPress = now;
    const d = dur();
    scrubAt = Math.max(0, Math.min(Math.max(0, d - 1), (scrubAt ?? v.currentTime) + dir * seekStep(presses, least)));
    const delta = scrubAt - v.currentTime;
    flash(`${ico(delta < 0 ? 'rotate-ccw' : 'rotate-cw')}<span>${delta < 0 ? '-' : '+'}${clock(Math.round(Math.abs(delta)))}</span>`);
    preview(scrubAt);
    paint();
    clearTimeout(scrubT);
    scrubT = window.setTimeout(commit, SEEK_WAIT);
  };
  const commit = () => {
    clearTimeout(scrubT);
    if (scrubAt === null) return;
    v.currentTime = scrubAt;
    scrubAt = null;
    $('.pthumb', L).hidden = true;
    paint();
    wake();
  };
  const cancelScrub = () => {
    clearTimeout(scrubT);
    scrubAt = null;
    $('.pthumb', L).hidden = true;
    paint();
  };
  const seekTo = (sec: number) => {
    cancelScrub();
    v.currentTime = Math.max(0, Math.min(dur() - 1, sec));
    paint();
  };
  const toggle = () => {
    if (v.paused) void v.play();
    else v.pause();
    flash(ico(v.paused ? 'pause' : 'play'));
  };

  // ---- skip and next episode ----
  const hidePrompt = () => {
    clearInterval(countT);
    const had = prompt.contains(document.activeElement);
    prompt.innerHTML = '';
    delete prompt.dataset.k;
    nextShown = false;
    if (had) bar.focus({ preventScroll: true });
  };
  const skip = (kind: string, to: number) => {
    skipped.add(kind);
    hidePrompt();
    seekTo(to);
  };
  const showSkip = (kind: string, to: number) => {
    if (prompt.dataset.k === kind) return;
    hidePrompt();
    prompt.dataset.k = kind;
    prompt.innerHTML = `<button class="f btn lt" type="button" data-a="skip">${ico('skip-forward', 's')}${t(SKIP_LABEL[kind] ?? 'Skip')}</button>`;
    $('[data-a="skip"]', prompt).onclick = () => skip(kind, to);
    A(prompt.firstElementChild, FADE, { duration: 200 });
    if (!shown()) go($('[data-a="skip"]', prompt));
  };
  const showNext = () => {
    if (nextShown || nextDismissed || !s.next) return;
    hidePrompt();
    nextShown = true;
    prompt.dataset.k = 'next';
    const n = s.next;
    countdown = prefs.autoNext ? NEXT_COUNTDOWN : 0;
    prompt.innerHTML = `<div class="pnext">${n.still ? `<img src="${esc(n.still)}" alt="">` : ''}<div class="pni"><span class="muted">${t('Next episode')}</span><b>${esc(epLabel(n))}</b><div class="btns"><button class="f btn lt" type="button" data-a="go">${ico('play', 's')}<span class="cd"></span></button><button class="f btn" type="button" data-a="stay">${t('Watch credits')}</button></div></div></div>`;
    const label = () => ($('.cd', prompt).textContent = countdown ? t('Next episode in {n}', { n: countdown }) : t('Next episode'));
    label();
    $('[data-a="go"]', prompt).onclick = () => void playEpisode(n);
    $('[data-a="stay"]', prompt).onclick = () => {
      nextDismissed = true;
      hidePrompt();
    };
    A(prompt.firstElementChild, FADE, { duration: 200 });
    go($('[data-a="go"]', prompt));
    if (countdown) countT = window.setInterval(() => {
      if (v.paused) return;
      countdown -= 1;
      label();
      if (countdown <= 0) void playEpisode(n);
    }, 1000);
  };
  const watchSegments = () => {
    if (busy || scrubAt !== null) return;
    const at = v.currentTime, segs = s.source.segments ?? [];
    const from = nextAt(segs, dur(), !!s.next);
    if (from !== null && at >= from) return showNext();
    if (from === null || at < from) {
      if (nextShown) hidePrompt();
      nextDismissed = false;
    }
    const seg = segmentAt(segs, at);
    if (seg && seg.kind !== 'credits') {
      if (prefs.autoSkip && !skipped.has(seg.kind)) {
        skip(seg.kind, seg.endSec);
        return toast(t(SKIPPED[seg.kind]!));
      }
      return showSkip(seg.kind, seg.endSec);
    }
    if (!nextShown && prompt.dataset.k) hidePrompt();
  };

  // ---- panels: audio and subtitles, speed, quality, episodes ----
  const opt = (label: string, on: boolean, data: string, extra = '') => `<button class="f po" type="button" role="menuitemradio" aria-checked="${on}" ${data}>${ico('check', 's ck')}<span>${esc(label)}</span>${extra}</button>`;
  const col = (heading: string, body: string) => `<div class="pcol"><h3>${esc(heading)}</h3>${body}</div>`;
  const openPanel = (from: HTMLElement, heading: string, cols: string, bind: (root: HTMLElement) => void) => {
    commit();
    panelFrom = from;
    panel.hidden = false;
    panel.innerHTML = `<h2>${esc(heading)}</h2><div class="pcols">${cols}</div>`;
    bind(panel);
    A(panel, [{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1, transform: 'none' }], { duration: 220 });
    go(($('[aria-checked="true"]', panel) as HTMLElement | null) ?? $('.po', panel));
  };
  const closePanel = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    panel.innerHTML = '';
    if (panelFrom?.isConnected) go(panelFrom);
    wake();
  };
  const panelTracks = (from: HTMLElement) => {
    const audio = s.source.audio ?? [], subs = s.source.subtitles ?? [];
    const timing = subOffset ? `${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)} s` : '0.0 s';
    openPanel(from, t('Audio and subtitles'),
      (audio.length > 1 ? col(t('Audio'), audio.map((a) => opt(a.label, a.id === audioId, `data-au="${a.id}"`)).join('')) : '') +
      col(t('Subtitles'), opt(t('Off'), subId < 0, 'data-su="-1"') + subs.map((x) => opt(x.label, x.id === subId, `data-su="${x.id}"`)).join('')) +
      col(t('Subtitle size'), (['s', 'm', 'l'] as const).map((z) => opt(t({ s: 'Small', m: 'Medium', l: 'Large' }[z]), prefs.subSize === z, `data-sz="${z}"`)).join('') +
        `<h3>${t('Subtitle timing')}: <span class="pof">${timing}</span></h3>` + [['-0.5', 'Earlier'], ['0.5', 'Later'], ['0', 'Reset']].map(([d, l]) => `<button class="f po" type="button" data-of="${d}"><span>${t(l!)}</span></button>`).join('')),
      (root) => {
        $$('[data-au]', root).forEach((b) => (b.onclick = () => {
          closePanel();
          void setAudio(Number(b.dataset.au));
        }));
        $$('[data-su]', root).forEach((b) => (b.onclick = () => {
          closePanel();
          void setSub(Number(b.dataset.su));
        }));
        $$('[data-sz]', root).forEach((b) => (b.onclick = () => {
          prefs.subSize = b.dataset.sz as PlayerPrefs['subSize'];
          void savePrefs(prefs);
          sub.className = `psub ${prefs.subSize}`;
          $$('[data-sz]', root).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        }));
        $$('[data-of]', root).forEach((b) => (b.onclick = () => {
          const d = Number(b.dataset.of);
          subOffset = d ? Math.round((subOffset + d) * 10) / 10 : 0;
          $('.pof', root).textContent = `${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)} s`;
          drawSubs();
        }));
      });
  };
  const panelSpeed = (from: HTMLElement) => openPanel(from, t('Speed'), col(t('Speed'), SPEEDS.map((r) => opt(r === 1 ? t('Normal') : `${r}x`, r === rate, `data-r="${r}"`)).join('')), (root) =>
    $$('[data-r]', root).forEach((b) => (b.onclick = () => {
      closePanel();
      setRate(Number(b.dataset.r));
    })));
  const panelQuality = (from: HTMLElement) => openPanel(from, t('Quality'), col(t('Quality'), QUALITIES.map(([l, bps]) => opt(t(l), bps === maxBitrate, `data-q="${bps ?? ''}"`)).join('')), (root) =>
    $$('[data-q]', root).forEach((b) => (b.onclick = () => {
      closePanel();
      const bps = b.dataset.q ? Number(b.dataset.q) : undefined;
      if (bps === maxBitrate) return;
      maxBitrate = prefs.maxBitrate = bps;
      void savePrefs(prefs);
      void reload({ audioId, subtitleId: subId });
    })));
  const panelEpisodes = async (from: HTMLElement) => {
    if (!episode || !p.seasons || !p.episodes) return;
    const seasons = await p.seasons(title, app.profile).catch(() => []);
    let season = seasons.find((x) => x.number === episode!.season) ?? seasons[0];
    if (!season) return;
    let shownEps: Episode[] = [];
    const list = async () => {
      shownEps = await p.episodes!(title, season!, app.profile).catch(() => [] as Episode[]);
      return shownEps.map((e) => `<button class="f po pepi" type="button" data-ep="${esc(e.id)}" ${e.id === episode?.id ? 'aria-current="true"' : ''}>${e.still ? `<img src="${esc(e.still)}" alt="">` : ''}<span class="pei"><b>${e.number}. ${esc(e.name)}</b>${e.id === episode?.id ? `<span class="muted">${t('Playing now')}</span>` : ''}${e.progress ? `<i class="pepb"><i style="transform:scaleX(${e.progress})"></i></i>` : ''}</span></button>`).join('');
    };
    const bindEps = (root: HTMLElement) => $$('[data-ep]', root).forEach((b) => (b.onclick = () => {
      const ep = shownEps.find((e) => e.id === b.dataset.ep);
      if (ep && ep.id !== episode?.id) void playEpisode(ep);
      else closePanel();
    }));
    const seasonCol = seasons.length > 1 ? col(t('Seasons'), seasons.map((x) => opt(x.name, x.id === season!.id, `data-se="${esc(x.id)}"`)).join('')) : '';
    openPanel(from, t('Episodes'), seasonCol + `<div class="pcol wide"><h3>${esc(season.name)}</h3><div class="peps">${await list()}</div></div>`, (root) => {
      bindEps(root);
      $$('[data-se]', root).forEach((b) => (b.onclick = async () => {
        season = seasons.find((x) => x.id === b.dataset.se) ?? season;
        $$('[data-se]', root).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        $('.pcol.wide h3', root).textContent = season!.name;
        $('.peps', root).innerHTML = await list();
        bindEps(root);
      }));
    });
    const cur = $('[aria-current="true"]', panel) as HTMLElement | null;
    if (cur) go(cur);
  };
  /** Up and Down within a column, Left and Right between columns. */
  const panelMove = (key: string) => {
    const el = document.activeElement as HTMLElement;
    const cols = $$('.pcol', panel).map((c) => $$('.po', c)).filter((c) => c.length);
    const ci = cols.findIndex((c) => c.includes(el));
    if (ci < 0) return go(cols[0]?.[0]);
    const i = cols[ci]!.indexOf(el);
    if (key === 'ArrowUp' || key === 'ArrowDown') return go(cols[ci]![i + (key === 'ArrowDown' ? 1 : -1)] ?? el);
    const nc = cols[ci + (key === 'ArrowRight' ? 1 : -1)];
    if (nc) go((nc.find((b) => b.getAttribute('aria-checked') === 'true') as HTMLElement | undefined) ?? nc[Math.min(i, nc.length - 1)]);
  };

  const actions: Record<string, (b: HTMLElement) => void> = {
    back: () => seekTo(v.currentTime - 10),
    fwd: () => seekTo(v.currentTime + 10),
    toggle: () => toggle(),
    tracks: (b) => panelTracks(b),
    speed: (b) => panelSpeed(b),
    quality: (b) => panelQuality(b),
    episodes: (b) => void panelEpisodes(b),
    next: () => s.next && void playEpisode(s.next),
  };
  $$('.prow [data-a]', L).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    actions[b.dataset.a!]!(b);
  }));
  const rowButtons = () => $$('.prow .pb', L).filter((b) => !b.hidden);

  const close = async () => {
    if (closing || !L.isConnected) return;
    closing = true; // From here, the video's own events must not report: resetting it would send position 0.
    nav.override = null;
    clearInterval(ticker);
    clearInterval(countT);
    clearTimeout(idle);
    clearTimeout(scrubT);
    await finish();
    v.pause();
    hls?.destroy();
    v.removeAttribute('src');
    v.load();
    L.remove();
    if (ret?.isConnected) go(ret);
  };

  nav.override = (e) => {
    const k = e.key, el = document.activeElement as HTMLElement | null;
    const wasShown = shown();
    wake();
    if (BACK_KEYS.has(k) || k === 'Backspace') {
      e.preventDefault();
      if (!panel.hidden) return closePanel();
      if (scrubAt !== null) return cancelScrub();
      return void close();
    }
    if (!panel.hidden) {
      if (k.startsWith('Arrow')) {
        e.preventDefault();
        panelMove(k);
      } else if (k === 'Enter') {
        e.preventDefault();
        el?.click();
      }
      return;
    }
    // Keys that do the same everywhere: remote media keys and the keyboard's shortcuts.
    const quick: Record<string, () => void> = {
      MediaPlayPause: toggle, ' ': toggle, k: toggle,
      MediaPlay: () => void v.play(), MediaPause: () => v.pause(), MediaStop: () => void close(),
      MediaFastForward: () => scrub(1, 30), MediaRewind: () => scrub(-1, 30), l: () => scrub(1), j: () => scrub(-1),
      MediaTrackNext: () => s.next && void playEpisode(s.next), n: () => s.next && void playEpisode(s.next),
      MediaTrackPrevious: () => seekTo(0),
      c: () => cycle('sub'), a: () => cycle('audio'),
      '>': () => setRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)]!), '<': () => setRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)]!),
    };
    if (quick[k]) {
      e.preventDefault();
      return quick[k]!();
    }
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      return seekTo((dur() * Number(k)) / 10);
    }
    const inPrompt = !!el && prompt.contains(el), inRow = !!el?.closest('.prow');
    if (k === 'Enter') {
      e.preventDefault();
      if (scrubAt !== null) return commit();
      if (inPrompt || inRow) return el!.click();
      return toggle();
    }
    if (!k.startsWith('Arrow')) return;
    e.preventDefault();
    if (inPrompt) {
      const bs = $$('.f', prompt);
      if (k === 'ArrowDown') return go(bar);
      if (k === 'ArrowLeft' || k === 'ArrowRight') return go(bs[bs.indexOf(el!) + (k === 'ArrowRight' ? 1 : -1)] ?? el);
      return;
    }
    if (inRow) {
      const bs = rowButtons(), i = bs.indexOf(el!);
      if (k === 'ArrowUp') return go(bar);
      if (k === 'ArrowLeft' || k === 'ArrowRight') return go(bs[i + (k === 'ArrowRight' ? 1 : -1)] ?? el);
      return;
    }
    // The bar, or nothing while the controls were hidden.
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (el !== bar) bar.focus({ preventScroll: true });
      return scrub(k === 'ArrowRight' ? 1 : -1);
    }
    if (k === 'ArrowDown') return go(wasShown ? $('[data-a="toggle"]', L) : bar);
    if (k === 'ArrowUp') {
      const pb = $('.pprompt .f', L) as HTMLElement | null;
      return go(pb ?? bar);
    }
  };

  L.addEventListener('mousemove', wake);
  v.addEventListener('click', toggle);
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * dur());
  });
  v.addEventListener('timeupdate', () => {
    paint();
    drawSubs();
    watchSegments();
  });
  v.addEventListener('progress', paint);
  v.addEventListener('loadedmetadata', () => {
    head();
    paint();
  });
  v.addEventListener('waiting', () => waiting(true));
  v.addEventListener('seeking', () => waiting(true));
  for (const ev of ['playing', 'seeked', 'canplay']) v.addEventListener(ev, () => waiting(false));
  v.addEventListener('pause', () => {
    toggleIcon();
    if (closing) return;
    wake();
    $('.pst', L).innerHTML = `${ico('pause', 's')} ${t('Paused')}`;
    void report('progress');
  });
  v.addEventListener('play', () => {
    toggleIcon();
    $('.pst', L).textContent = '';
    wake();
  });
  v.addEventListener('ended', () => {
    if (s.next && prefs.autoNext && !nextDismissed) void playEpisode(s.next);
    else void close();
  });
  v.addEventListener('error', () => !busy && fail('This video could not play.'));
  // Subtitles follow the picture closely, not just at each time update.
  const frame = () => {
    if (!L.isConnected) return;
    if (!v.paused && subId >= 0) drawSubs();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  attach(s.source.startSec ?? 0);
  bar.focus({ preventScroll: true });
  wake();
  ticker = window.setInterval(() => {
    if (!closing && !busy) void report('progress');
  }, 10000);
}
