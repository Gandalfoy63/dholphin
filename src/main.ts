// Docs: docs/04 - Architecture/Overview.md
// Purpose: starts the app: core, start animation, then setup, profiles or a return from a service's own pages.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import { loadCore } from './core/wasm';
import type { Profile, Title } from './sdk/types';
import { app } from './ui/app';
import { A, $, fitTv, logoMark, logoStart, TV, toast, FADE_OUT } from './ui/dom';
import { installKeys, nav } from './ui/focus';
import { LANGUAGES, setLocale, t } from './ui/i18n';
import { openDetails } from './ui/details';
import { startOnboarding, type ObState } from './ui/onboarding';
import { profileLoader, showProfiles } from './ui/profiles';
import { takeReturn } from './ui/returning';
import { checkForUpdate } from './ui/update';
import { showShell } from './ui/shell';
import { setUpWhere, waitForServerSetup } from './ui/serverlink';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enter(p: Profile, route = 'home') {
  const loading = profileLoader(p);
  setLocale(p.language);
  await app.use(p);
  showShell(route, { profiles, onboarding: () => setup() });
  await loading.done();
}
function profiles() {
  showProfiles((p) => void enter(p), () => setup(true));
}
async function finishSetup(p: Profile, picks: Title[]) {
  app.profiles.push(p);
  await app.saveProfiles();
  await app.setSetupDone();
  await adoptSetupLinks(p);
  const loading = profileLoader(p);
  setLocale(p.language);
  await app.use(p);
  await Promise.all(picks.map((t) => app.library.signal(t, 'pick')));
  showShell('home', { profiles, onboarding: () => setup() });
  void loading.done();
  toast(t('Welcome, {name}', { name: p.name }));
}
/** Services connected during a setup begun before 0.33.4, under the old shared id `setup`, go to the new profile. */
async function adoptSetupLinks(p: Profile) {
  for (const k of await app.store.keys('prov:')) {
    if (k.endsWith(':link:setup')) {
      await app.store.set(k.replace(':link:setup', `:link:${p.id}`), await app.store.get(k));
      await app.store.del(k);
    }
  }
}
function setup(addOnly = false, resume?: { step: number; ob: ObState }) {
  nav.override = null;
  startOnboarding((p, picks) => void finishSetup(p, picks), { addOnly, resume });
}

async function showStart() {
  const tv = TV();
  tv.innerHTML = `<div class="boot"><span style="width:300px;display:block" id="sl">${logoMark()}</span></div>`;
  logoStart($('#sl', tv));
  await sleep(1150);
  A($('.boot', tv), FADE_OUT, { duration: 180, fill: 'forwards' });
  await sleep(180);
}

async function boot() {
  fitTv();
  installKeys();
  try {
    await loadCore();
    await app.init();
  } catch (e) {
    TV().innerHTML = `<div class="pg cfail"><h1>Dholphin could not start</h1><p class="muted">${(e as Error).message}</p></div>`;
    return;
  }
  // Before any profile: the language chosen earlier, otherwise the device's, otherwise English.
  const device = navigator.language.slice(0, 2).toLowerCase();
  setLocale((await app.store.get<string>('uiLang')) ?? LANGUAGES.find(([c]) => c.startsWith(device))?.[0] ?? 'en-US');
  const returning = location.hash === '#back';
  if (returning) history.replaceState(null, '', location.pathname);
  const state = returning ? takeReturn() : null;
  const report = returning ? await app.host.takeExternalReport() : null;

  if (state?.onboardingStep !== undefined) return setup(false, { step: state.onboardingStep, ob: state.ob as ObState });
  if (state?.profileId) {
    const p = app.profiles.find((x) => x.id === state.profileId);
    if (p) {
      await enter(p, state.route ?? 'home');
      const meta = report?.meta as { title?: Title; provider?: string } | undefined;
      if (meta?.title && report?.durationSec) {
        await app.library.watched(meta.title, { progress: (report.positionSec ?? 0) / report.durationSec, positionSec: report.positionSec, durationSec: report.durationSec, provider: meta.provider });
      } else if (meta?.title) await app.library.signal(meta.title, 'watched');
      if (state.title) await openDetails(state.title);
      return;
    }
  }
  // Android: a newer published version is offered once the page is up.
  setTimeout(() => void checkForUpdate(), 1500);
  // The logo plays on the first run only; after that, the profile is what loads, with its own picture.
  // Linked to a server that has no profile yet: its panel's code, to set it up from a phone or a computer.
  if (app.server?.linked && !app.profiles.length) return waitForServerSetup(() => undefined, () => setup());
  // The web app on a server with no profile yet: set it up here, or leave it to a TV.
  if (app.server && !app.profiles.length) return setUpWhere(() => setup());
  if (!(await app.setupDone()) || !app.profiles.length) {
    await showStart();
    return setup();
  }
  if (app.profiles.length === 1 && !app.profiles[0]!.pin) return enter(app.profiles[0]!);
  profiles();
}

void boot();
void sleep;
