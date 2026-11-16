// Docs: docs/04 - Architecture/Server.md
// Purpose: tests the app's correction of the server's addresses, behind a proxy that doesn't say the public one.
import { describe, expect, it } from 'vitest';
import { rebaseServer, serverStore, type Store } from './store';

const memory = (): Store => {
  const m = new Map<string, unknown>();
  return { get: async <T>(k: string) => m.get(k) as T, set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k), keys: async (p) => [...m.keys()].filter((k) => k.startsWith(p)) };
};

describe('rebaseServer', () => {
  const said = 'http://dholphin:8080', reached = 'https://tv.example.com/dholphin';
  it('moves the server\'s addresses under the one the app reached, and nothing else', () => {
    const config = { mode: 'server', server: { origin: said, panel: `${said}/panel` }, store: `${said}/api/store`, endpoints: { tmdb: `${said}/api/tmdb/3`, other: 'https://api.example.org' } };
    expect(rebaseServer(config, said, reached)).toEqual({ mode: 'server', server: { origin: reached, panel: `${reached}/panel` }, store: `${reached}/api/store`, endpoints: { tmdb: `${reached}/api/tmdb/3`, other: 'https://api.example.org' } });
    expect(rebaseServer(`${said}0/x`, said, reached)).toBe(`${said}0/x`);
    expect(rebaseServer(config, reached, reached)).toBe(config);
  });
  it('corrects the relay addresses the server store gives', async () => {
    const answer = { 'prov:jellyfin:server': `${said}/api/r/s3cret/jellyfin`, profiles: [{ id: 'a' }] };
    const store = await serverStore(`${reached}/api/store`, memory(), async () => new Response(JSON.stringify(answer)), (v) => rebaseServer(v, said, reached));
    expect(await store.get('prov:jellyfin:server')).toBe(`${reached}/api/r/s3cret/jellyfin`);
    expect(await store.get('profiles')).toEqual([{ id: 'a' }]);
  });
});
