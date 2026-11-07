// Docs: docs/03 - Features/Playback.md
// Purpose: starts playback: the app's player (player.ts) for Jellyfin, the service's own player for Netflix.
import type { Episode, Provider, Title } from '@/sdk/types';
import { app } from './app';
import { toast } from './dom';
import { t } from './i18n';
import { loadPrefs, player } from './player';
import { saveReturn } from './returning';

export async function startPlay(p: Provider, title: Title, episode?: Episode, startSec?: number) {
  try {
    const prefs = await loadPrefs();
    // The languages and quality chosen last time start the stream, so it rarely needs to change.
    const session = await p.play!({ title, episode, startSec, choice: { audioLang: prefs.audioLang, subtitleLang: prefs.subtitleLang, maxBitrate: prefs.maxBitrate } }, app.profile);
    if (session.kind === 'external') {
      if (app.host.leavesPage) saveReturn({ titleKey: title.key, title });
      await app.host.openExternal(session.url, 'play', { title, provider: p.id }, session.app);
      // Where the page waits behind the service's app, nothing reports back: opening it counts as watching, in History
      // without a position, so it is not offered in Continue Watching.
      if (!app.host.leavesPage) {
        await app.library.watched(title, { progress: 0, provider: p.id });
        await app.library.signal(title, 'watched');
      }
      return;
    }
    await player(p, title, { ...session, episode: session.episode ?? episode }, prefs);
  } catch (e) {
    toast(t((e as Error).message));
  }
}
