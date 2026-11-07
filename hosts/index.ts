// Docs: docs/04 - Architecture/Platform Hosts.md
// Purpose: picks the host adapter for this device.
import type { ExternalReport, Host, PhoneField } from '@/sdk/types';

type Chrome = {
  runtime?: { id?: string; sendMessage(m: unknown): Promise<unknown> };
  cookies?: { get(d: { url: string; name: string }): Promise<{ value: string } | null>; getAll(d: { url: string }): Promise<{ name: string; domain: string; path: string; secure: boolean }[]>; remove(d: { url: string; name: string }): Promise<unknown> };
  storage?: { local: { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> } };
};
const chrome = (globalThis as unknown as { chrome?: Chrome }).chrome;

/** CoolDash OS: the page is an extension page in the app's own Chromium. */
function cooldash(c: Chrome): Host {
  return {
    id: 'cooldash',
    leavesPage: true,
    async openExternal(url, intent, meta) {
      await c.storage!.local.set({ external: { intent, meta, at: Date.now() } });
      await c.storage!.local.remove('report');
      location.href = url;
    },
    async cookie(url, name) {
      return (await c.cookies!.get({ url, name }))?.value ?? null;
    },
    async removeCookies(url) {
      for (const k of await c.cookies!.getAll({ url })) await c.cookies!.remove({ url, name: k.name });
    },
    async takeExternalReport() {
      const { report, external } = (await c.storage!.local.get('report').then(async (a) => ({ ...a, ...(await c.storage!.local.get('external')) }))) as { report?: ExternalReport; external?: { meta?: unknown } };
      await c.storage!.local.remove('external');
      await c.storage!.local.remove('report');
      return external ? { ...report, meta: external.meta } : null;
    },
    close: () => window.close(),
  };
}

/** Development and the demo: a service's own site is a page on the same origin. */
function browser(): Host {
  return {
    id: 'browser',
    leavesPage: true,
    async openExternal(url, intent, meta) {
      sessionStorage.setItem('external', JSON.stringify({ intent, meta }));
      localStorage.removeItem('report');
      location.href = url;
    },
    async cookie(_url, name) {
      const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return m ? m[1]! : null;
    },
    async removeCookies() {
      document.cookie.split('; ').forEach((c) => (document.cookie = `${c.split('=')[0]}=; path=/; max-age=0`));
    },
    async takeExternalReport() {
      const e = sessionStorage.getItem('external');
      if (!e) return null;
      sessionStorage.removeItem('external');
      const report = JSON.parse(localStorage.getItem('report') ?? '{}') as ExternalReport;
      localStorage.removeItem('report');
      return { ...report, meta: (JSON.parse(e) as { meta?: unknown }).meta };
    },
    close: () => window.close(),
  };
}

/** What the Android app's WebView exposes, as `DholphinAndroid`: strings in, strings out. */
interface AndroidBridge {
  version(): string;
  build(): string;
  installed(packagesJson: string): string;
  openApp(url: string, packagesJson: string, extrasJson: string): string;
  phoneStart(title: string, fieldsJson: string): string;
  phoneStop(): void;
  qr?(text: string): string;
  installUpdate(url: string): void;
  exit(): void;
}
type AndroidEvent = { t: 'phone'; values: Record<string, string> } | { t: 'update'; pct?: number; result?: 'started' | 'needs_permission' | 'failed' };

/** Android TV: the page is bundled in the app's WebView. Services open in their own apps, and the page waits behind them. */
function android(b: AndroidBridge): Host {
  const listeners = new Set<(e: AndroidEvent) => void>();
  // The app sends its events as `dholphin` window events.
  window.addEventListener('dholphin', (e) => listeners.forEach((l) => l((e as CustomEvent<AndroidEvent>).detail)));
  const on = (l: (e: AndroidEvent) => void) => (listeners.add(l), () => listeners.delete(l));
  let phoneOff: (() => void) | null = null;
  return {
    id: 'android',
    leavesPage: false,
    async openExternal(url, _intent, _meta, app) {
      if (!app) throw new Error('This opens only in a browser');
      const r = b.openApp(url, JSON.stringify(app.packages), JSON.stringify(app.extras ?? {}));
      if (r !== 'ok') throw new Error('That app is not installed on this TV');
    },
    async hasApp(packages) {
      return b.installed(JSON.stringify(packages)) === 'yes';
    },
    // Nothing signs in through this page on Android: cookies belong to the services' own apps.
    cookie: async () => null,
    removeCookies: async () => undefined,
    takeExternalReport: async () => null,
    close: () => b.exit(),
    qr: b.qr ? async (text: string) => b.qr!(text) || null : undefined,
    phoneForm: {
      async start(title: string, fields: PhoneField[], onValues: (v: Record<string, string>) => void) {
        phoneOff?.();
        phoneOff = on((e) => e.t === 'phone' && onValues(e.values));
        const r = JSON.parse(b.phoneStart(title, JSON.stringify(fields))) as { url?: string; qr?: string; error?: string };
        if (!r.url || !r.qr) throw new Error(r.error ?? 'The phone form could not start');
        return { url: r.url, qr: r.qr };
      },
      stop() {
        phoneOff?.();
        phoneOff = null;
        b.phoneStop();
      },
    },
    updater: {
      version: b.version(),
      build: Number(b.build()) || 0,
      install(url, onProgress) {
        return new Promise((resolve) => {
          const off = on((e) => {
            if (e.t !== 'update') return;
            if (e.pct != null) onProgress(e.pct);
            if (e.result) {
              off();
              resolve(e.result);
            }
          });
          b.installUpdate(url);
        });
      },
    },
  };
}

const bridge = (globalThis as unknown as { DholphinAndroid?: AndroidBridge }).DholphinAndroid;
export const createHost = (): Host => (bridge ? android(bridge) : chrome?.runtime?.id && chrome.cookies ? cooldash(chrome) : browser());
