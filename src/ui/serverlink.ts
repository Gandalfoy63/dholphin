// Docs: docs/04 - Architecture/Server.md
// Purpose: a device and a Dholphin server: linking with a code or the household password, the panel's address as a QR code, and waiting for the first profile.
import type { ServerLink } from './app';
import { app } from './app';
import { A, $, $$, esc, formOf, ico, touch, TV, toast } from './dom';
import { go } from './focus';
import { t } from './i18n';
import { candidateOrigins } from '@/core/origin';
import { bindPhone, phoneHtml } from './phone';
import { bindFields, fieldsHtml, keyboardHtml } from './textentry';

/** Kept on this device only (not the household's): its link to a server. */
const LINK_KEY = 'serverLink';

export { candidateOrigins, normalizeOrigin } from '@/core/origin';

/** The first of these that is a Dholphin server, by its status: a few seconds each. */
async function reachServer(origins: string[]): Promise<string | null> {
  for (const o of origins) {
    const ok = await fetch(`${o}/api/status`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).then((j: { app?: string }) => j.app === 'dholphin', () => false);
    if (ok) return o;
  }
  return null;
}

/** How this device calls itself in the server's list of devices. */
const deviceName = () => {
  const kind = formOf() === 'tablet' ? 'tablet' : formOf() === 'phone' ? 'phone' : 'TV';
  return app.host.id === 'android' ? `Android ${kind}` : app.host.id === 'cooldash' ? 'CoolDash TV' : kind === 'TV' ? 'TV' : kind === 'phone' ? 'Phone' : 'Tablet';
};

/**
 * Links this device to a server: its address (on the home network, or a domain behind a reverse proxy), then a code
 * from the panel or the household password. The app starts again, on the server.
 */
export function linkServer(after?: () => void, origin = '') {
  const ret = document.activeElement as HTMLElement | null;
  let mode: 'code' | 'password' = 'code';
  TV().insertAdjacentHTML('beforeend', `<div class="modal lsrv"><div class="panel" style="justify-items:start;gap:16px"><h2 style="font-size:36px">${t('Link to a Dholphin server')}</h2><p class="muted" style="max-width:900px">${t('The server keeps the keys, the profiles and their history for every device. Its address can be on your home network, or a domain behind a reverse proxy.')}</p><div class="btns" role="radiogroup" aria-label="${t('Link with')}"><button class="f chip" type="button" role="radio" data-mode="code" aria-checked="true" aria-pressed="true">${t('Link code')}</button><button class="f chip" type="button" role="radio" data-mode="password" aria-checked="false" aria-pressed="false">${t('Household password')}</button></div><div class="${app.host.phoneForm ? 'withphone' : ''}"><div class="stack">${fieldsHtml([{ key: 'origin', label: 'Server address', placeholder: 'tv.example.com, 192.168.1.20:8080', value: origin }, { key: 'code', label: 'Code' }, { key: 'password', label: 'Password', secret: true }])}<p class="muted lhint"></p>${keyboardHtml()}</div>${phoneHtml()}</div><div class="err" role="alert"></div><div class="btns"><button class="f btn pri" id="lgo" type="button">${t('Link')}</button><button class="f btn" id="lcn" type="button">${t('Cancel')}</button></div></div></div>`);
  const m = $('.modal:last-child', TV());
  A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  const read = bindFields(m);
  const field = (k: string) => $(`#fld-${k}`, m).closest<HTMLElement>('.field')!;
  /** A code from the panel, or the household password: only that field shows. */
  const setMode = (to: typeof mode) => {
    mode = to;
    $$('[data-mode]', m).forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.mode === to));
      b.setAttribute('aria-pressed', String(b.dataset.mode === to));
    });
    field('code').hidden = to !== 'code';
    field('password').hidden = to !== 'password';
    $('.lhint', m).textContent = t(to === 'code' ? 'In the server panel, choose Link a TV: it shows a six-digit code, good for ten minutes.' : 'The password you sign in to the server panel with.');
    $('.err', m).textContent = '';
  };
  setMode('code');
  $$('[data-mode]', m).forEach((b) => (b.onclick = () => setMode(b.dataset.mode as typeof mode)));
  // From a phone (Android TV's QR code): the address, and a code or the password, whichever was filled.
  const stopPhone = bindPhone(m, t('Link to a Dholphin server'), [{ key: 'origin', label: t('Server address') }, { key: 'code', label: t('Code') }, { key: 'password', label: t('Household password'), secret: true }], () => {
    if (($<HTMLInputElement>('#fld-password', m).value ?? '') && !$<HTMLInputElement>('#fld-code', m).value) setMode('password');
    $('#lgo', m).click();
  });
  const shut = () => {
    void stopPhone.then((s) => s());
    m.remove();
    (window as unknown as { _mret?: () => void })._mret = undefined;
    if (ret?.isConnected) go(ret);
    after?.();
  };
  (window as unknown as { _mret?: () => void })._mret = shut;
  $('#lcn', m).onclick = shut;
  $('#lgo', m).onclick = async () => {
    const v = read(), tries = candidateOrigins(v.origin ?? ''), b = $<HTMLButtonElement>('#lgo', m), err = $('.err', m);
    if (!tries.length) return void (err.textContent = t('Check the server address'));
    const secret = mode === 'code' ? (v.code ?? '').replace(/\s/g, '') : v.password ?? '';
    if (!secret) return void (err.textContent = t(mode === 'code' ? 'Enter the code from the server panel' : 'Enter the household password'));
    b.disabled = true;
    b.innerHTML = `${ico('loader-circle', 's spin')}${t('Linking')}`;
    try {
      const at = await reachServer(tries);
      if (!at) throw new Error(t('The server could not be reached at this address'));
      const r = await fetch(`${at}/api/${mode === 'code' ? 'pair' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'code' ? { code: secret, name: deviceName() } : { password: secret, device: true, name: deviceName() }) });
      const j = (await r.json().catch(() => ({}))) as { token?: string; message?: string };
      if (!r.ok) throw new Error(t(j.message ?? (mode === 'code' ? 'The server refused the code' : 'Wrong password')));
      // A server from before 0.42.0 signs a browser in with the password, but gives no token for a device.
      if (!j.token) throw new Error(t('This server is too old to link with the password: use a code, or update it.'));
      await app.store.set(LINK_KEY, { origin: at, token: j.token } satisfies ServerLink);
      toast(t('Linked. Starting on the server…'));
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      err.textContent = (e as Error).message;
      b.disabled = false;
      b.textContent = t('Link');
    }
  };
  go($(origin ? '#fld-code' : '.field input', m) ?? $('.field input', m));
}

/** Unlinks this TV: it goes back to keeping its own data, from before it was linked. */
export async function unlinkServer() {
  await app.store.del(LINK_KEY);
  location.reload();
}

/** The panel's address, with a QR code where the device draws one. */
export async function panelHtml(): Promise<string> {
  const url = app.server?.panel ?? '';
  const qr = url ? await app.host.qr?.(url).catch(() => null) : null;
  return `<div class="phone"><div class="qrbox">${qr ? `<img src="${esc(qr)}" alt="${esc(t('QR code that opens the server panel'))}">` : ico('settings')}</div><div class="pi"><b>${t('Server panel')}</b><span class="muted">${t('Open it on a phone or a computer: keys, Jellyfin, Seerr, profiles and devices.')}</span><span class="purl">${esc(url)}</span></div></div>`;
}

/**
 * A server without any profile yet, on a TV: the panel's code, to set it up from a phone or a computer. The screen
 * moves on by itself once a profile exists there; or the setup can be done here instead.
 */
export async function waitForServerSetup(onReady: () => void, setUpHere: () => void) {
  TV().innerHTML = `<div class="onb"><div class="obody" style="justify-content:center;gap:28px"><h1>${t('Set up this server')}</h1><p class="lead">${t(touch() ? 'This device is linked to a Dholphin server that has no profile yet. Set it up in its panel, from a phone or a computer: this screen moves on by itself.' : 'This TV is linked to a Dholphin server that has no profile yet. Set it up in its panel, from a phone or a computer: this screen moves on by itself.')}</p>${await panelHtml()}<div class="btns"><button class="f btn" id="here" type="button">${t('Set up here instead')}</button></div></div></div>`;
  const timer = setInterval(async () => {
    const r = await fetch(`${app.config.store}?prefix=profiles`).then((x) => (x.ok ? x.json() : {})).catch(() => ({})) as { profiles?: unknown[] };
    if (r.profiles?.length) {
      clearInterval(timer);
      location.reload();
    }
  }, 5000);
  $('#here').onclick = () => {
    clearInterval(timer);
    setUpHere();
  };
  go($('#here'));
  void onReady;
}

/**
 * The web app on a server with no profile yet: set it up here, or on a TV. For a TV, a code to link it, renewed before
 * it runs out; the page moves on by itself once the TV (or anyone) has made a profile.
 */
export function setUpWhere(setUpHere: () => void) {
  TV().innerHTML = `<div class="onb"><div class="obody" style="justify-content:center;gap:28px"><h1>${t('Set up Dholphin')}</h1><p class="lead">${t('This server has no profile yet. Make the first one here, or on a TV: the profiles are kept here for every device.')}</p><div class="stack"><div class="prov"><span class="plogos">${ico('monitor-play')}</span><div class="i"><b>${t('Set up here')}</b><span class="muted">${t('Profile, services and taste, in this browser')}</span></div><button class="f btn pri" id="here" type="button">${t('Set up here')}</button></div><div class="prov"><span class="plogos">${ico('tv')}</span><div class="i"><b>${t('Set up on a TV')}</b><span class="muted">${t('The TV links to this server with a code, then makes the profiles')}</span></div><button class="f btn" id="ontv" type="button">${t('Show a code')}</button></div></div><div id="tvcode"></div></div></div>`;
  let renew: ReturnType<typeof setInterval> | undefined;
  const poll = setInterval(async () => {
    const r = (await fetch(`${app.config.store}?prefix=profiles`).then((x) => (x.ok ? x.json() : {})).catch(() => ({}))) as { profiles?: unknown[] };
    if (r.profiles?.length) {
      clearInterval(poll);
      clearInterval(renew);
      location.reload();
    }
  }, 5000);
  const showCode = async () => {
    const box = $('#tvcode');
    if (!box) return;
    const r = (await fetch(`${app.server?.origin || '.'}/api/admin/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { code?: string; origin?: string } | null;
    if (!r?.code) return void (box.innerHTML = `<p class="err" role="alert">${t('The server could not make a code. Try again.')}</p>`);
    box.innerHTML = `<div class="phone"><div class="pi"><b>${t('On the TV')}</b><span class="muted">${t('Open Dholphin, choose this server in the list or enter its address, then this code. It works once, for ten minutes; a new one comes before then.')}</span><span class="purl">${esc(app.server?.origin || r.origin || location.origin)}</span><span class="tvc" style="font-size:56px;font-weight:700;letter-spacing:.12em;font-variant-numeric:tabular-nums">${esc(r.code)}</span></div></div>`;
    A(box, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 280 });
  };
  $('#here').onclick = () => {
    clearInterval(poll);
    clearInterval(renew);
    setUpHere();
  };
  $('#ontv').onclick = async () => {
    await showCode();
    clearInterval(renew);
    renew = setInterval(() => void showCode(), 9 * 60_000);
  };
  go($('#here'));
}

