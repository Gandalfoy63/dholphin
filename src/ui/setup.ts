// Docs: docs/03 - Features/Phone Entry.md
// Purpose: setting everything up from a phone: keys, the household's servers, and each profile's name and accounts.
import type { PhoneField, Profile, Provider } from '@/sdk/types';
import { newId } from '@/core/id';
import { app, COLORS, KEY_FIELDS, type Keys } from './app';
import { $, esc, ico } from './dom';
import { t } from './i18n';

/** Fields with their own sign-in per profile, and fields every profile shares, for each provider that has fields. */
const withFields = () => app.providers.filter((p): p is Provider & { fields: NonNullable<Provider['fields']> } => !!p.fields?.length);
const own = (p: Provider) => (p.fields ?? []).filter((f) => !f.shared);
const shared = (p: Provider) => (p.fields ?? []).filter((f) => f.shared);

/**
 * The phone page's fields, in sections: the film data keys, what the household shares (the Jellyfin and Seerr
 * addresses, Seerr's key), then each profile (its name, its own accounts), and a new profile. Hints show what is
 * already set without showing any key: an empty field leaves things as they are.
 */
export async function setupFields(): Promise<PhoneField[]> {
  const keys = app.keyValues(), out: PhoneField[] = [];
  const kept = t('Saved. Leave empty to keep it');
  for (const f of KEY_FIELDS) out.push({ key: `key.${f.key}`, label: t(f.label), secret: true, section: t('Film data keys'), placeholder: keys[f.key] ? kept : f.where });
  for (const p of withFields()) {
    const known = (await p.values?.()) ?? {};
    for (const f of shared(p)) out.push({ key: `${p.id}.${f.key}`, label: t(f.label), secret: f.secret, section: t('For every profile'), placeholder: !f.secret && known[f.key] ? known[f.key] : f.secret && known[f.key] ? kept : f.placeholder });
  }
  const profileFields = (id: string, section: string, name?: string) => {
    out.push({ key: `p.${id}.name`, label: t('Name'), section, placeholder: name });
    for (const p of withFields()) for (const f of own(p)) out.push({ key: `p.${id}.${p.id}.${f.key}`, label: `${p.name}: ${t(f.label)}`, secret: f.secret, section });
  };
  for (const pr of app.profiles) profileFields(pr.id, t('Profile {name}', { name: pr.name }), pr.name);
  if (app.profiles.length < 8) profileFields('new', t('A new profile'));
  return out;
}

/** Applies what the phone sent. Returns one line per change, said plainly, including what didn't work. */
export async function applySetup(values: Record<string, string>): Promise<string[]> {
  const lines: string[] = [];
  const v = (k: string) => values[k]?.trim() ?? '';
  // Keys: a new TMDB key is checked before it replaces the old one.
  const keys: Keys = { ...app.keyValues() };
  let keysChanged = false;
  for (const f of KEY_FIELDS) {
    const val = v(`key.${f.key}`);
    if (!val) continue;
    if (f.key === 'tmdb' && !(await app.catalog.checkTmdb(val).catch(() => false))) {
      lines.push(t('TMDB refused this key. Check it and try again.'));
      continue;
    }
    keys[f.key] = val;
    keysChanged = true;
  }
  if (keysChanged) {
    await app.saveKeys(keys);
    lines.push(t('Film data keys saved'));
  }
  // What the household shares.
  for (const p of withFields()) {
    const s = Object.fromEntries(shared(p).map((f) => [f.key, v(`${p.id}.${f.key}`)]).filter(([, x]) => x));
    if (!Object.keys(s).length || !p.saveShared) continue;
    await p.saveShared(s).then(() => lines.push(t('{name}: saved for every profile', { name: p.name })), (e: Error) => lines.push(`${p.name}: ${t(e.message)}`));
  }
  // Each profile, and maybe a new one.
  const ids = [...app.profiles.map((x) => x.id), 'new'];
  for (const id of ids) {
    let profile: Profile | undefined = app.profiles.find((x) => x.id === id);
    const name = v(`p.${id}.name`);
    if (id === 'new') {
      if (!name) continue;
      const base = app.profiles[0];
      profile = { id: newId(4), name: name[0]!.toUpperCase() + name.slice(1), color: COLORS[app.profiles.length % COLORS.length]!, language: base?.language ?? 'en-US', region: base?.region ?? 'US', maturity: base?.maturity ?? '18+' };
      app.profiles.push(profile);
      lines.push(t('Added the profile {name}', { name: profile.name }));
    } else if (profile && name && name !== profile.name) {
      lines.push(t('{old} is now {name}', { old: profile.name, name }));
      profile.name = name;
    }
    if (!profile) continue;
    for (const p of withFields()) {
      const mine = Object.fromEntries(own(p).map((f) => [f.key, v(`p.${id}.${p.id}.${f.key}`)]).filter(([, x]) => x));
      if (!Object.keys(mine).length || !p.connect) continue;
      await p.connect(profile, mine).then(() => lines.push(t('{who}: connected to {name}', { who: profile!.name, name: p.name })), (e: Error) => lines.push(`${profile!.name}, ${p.name}: ${t(e.message)}`));
    }
  }
  await app.saveProfiles();
  if (!lines.length) lines.push(t('Nothing changed'));
  return lines;
}

/** The setup QR panel, where the TV can serve the phone page: at the bottom of Who's watching and in Settings. */
export const setupHtml = () =>
  app.host.phoneForm
    ? `<div class="phone setupqr"><div class="qrbox">${ico('loader-circle', 's spin')}</div><div class="pi"><b>${t('Set up from your phone')}</b><span class="muted">${t('Keys, Jellyfin, Seerr and every profile, without starting setup again. Same Wi-Fi as this TV.')}</span><span class="purl"></span></div></div>`
    : '';

/**
 * Serves the setup page for the QR panel in `root`. What the phone sends is applied, `done` gets the lines to show,
 * and the page is served again, with a new code, for the next change. Returns a stop function.
 */
export async function bindSetup(root: HTMLElement, done: (lines: string[]) => void): Promise<() => void> {
  const pf = app.host.phoneForm, box = root.querySelector<HTMLElement>('.setupqr');
  if (!pf || !box) return () => undefined;
  let stopped = false;
  const serve = async () => {
    try {
      const { url, qr } = await pf.start(t('Set up Dholphin'), await setupFields(), (values) => void (async () => {
        const lines = await applySetup(values);
        done(lines);
        if (!stopped && box.isConnected) await serve();
      })());
      if (!box.isConnected || stopped) return pf.stop();
      $('.qrbox', box).innerHTML = `<img src="${esc(qr)}" alt="${esc(t('QR code that opens the setup page on your phone'))}">`;
      $('.purl', box).textContent = url;
    } catch (e) {
      $('.qrbox', box)?.remove();
      $('.pi .muted', box).textContent = t((e as Error).message);
    }
  };
  await serve();
  return () => {
    stopped = true;
    pf.stop();
  };
}
