// Docs: docs/03 - Features/Updates.md
// Purpose: on Android, says when a newer Dholphin is published and installs it through Android's own installer.
import { app } from './app';
import { A, $, esc, ico, TV } from './dom';
import { go } from './focus';
import { t } from './i18n';

export interface Release { version: string; build: number; notes: string; apk: string }

/**
 * The latest published version, from GitHub's latest release (docs: GitHub/Releases API). Its tag is the version,
 * `v0.9.0+23`; the build number after `+` only grows, so it decides what is newer.
 */
export async function latestRelease(endpoint: string): Promise<Release | null> {
  const r = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return null;
  const j = (await r.json()) as { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
  const version = (j.tag_name ?? '').replace(/^v/, '');
  const build = Number(version.split('+')[1]);
  const apk = j.assets?.find((a) => a.name.endsWith('.apk'))?.browser_download_url;
  if (!Number.isInteger(build) || !apk || !/^https:\/\//.test(apk) && !apk.startsWith('/')) return null;
  return { version, build, notes: (j.body ?? '').trim(), apk };
}

/** Checks once, quietly: no network or no newer version shows nothing. */
export async function checkForUpdate() {
  const u = app.host.updater;
  if (!u) return;
  const r = await latestRelease(app.endpoints.releases).catch(() => null);
  if (!r || r.build <= u.build) return;
  offer(r);
}

function offer(r: Release) {
  const ret = document.activeElement as HTMLElement | null;
  const notes = r.notes.length > 360 ? `${r.notes.slice(0, 357)}...` : r.notes;
  TV().insertAdjacentHTML('beforeend', `<div class="modal upd"><div class="panel" style="justify-items:start;gap:16px;max-width:880px"><h2 style="font-size:36px">${esc(t('Update available: Dholphin {version}', { version: r.version.split('+')[0]! }))}</h2><p class="muted" style="font-size:22px">${esc(t('You have {version}.', { version: app.host.updater!.version.split('+')[0]! }))}</p>${notes ? `<p class="unotes">${esc(notes)}</p>` : ''}<div class="err" role="status"></div><div class="btns"><button class="f btn pri" id="un" type="button">${ico('download', 's')}${t('Update now')}</button><button class="f btn" id="ul" type="button">${t('Later')}</button></div></div></div>`);
  const m = $('.modal.upd', TV());
  A($('.panel', m), [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  const shut = () => {
    m.remove();
    if (ret?.isConnected) go(ret);
  };
  (window as unknown as { _mret: () => void })._mret = shut;
  $('#ul', m).onclick = shut;
  const b = $<HTMLButtonElement>('#un', m), msg = $('.err', m);
  b.onclick = async () => {
    b.disabled = true;
    msg.textContent = '';
    b.innerHTML = `${ico('loader-circle', 's spin')}${t('Downloading')}`;
    const result = await app.host.updater!.install(r.apk, (pct) => (b.innerHTML = `${ico('loader-circle', 's spin')}${t('Downloading {n}%', { n: pct })}`));
    b.disabled = false;
    b.innerHTML = `${ico('download', 's')}${t('Update now')}`;
    msg.textContent = t(result === 'started' ? 'Android asks you to confirm: choose Install.' : result === 'needs_permission' ? 'Allow Dholphin to install apps on the screen that opened, then choose Update now again.' : 'The update could not be downloaded. Try again later.');
  };
  go(b);
}
