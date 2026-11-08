// Docs: docs/04 - Architecture/Server.md
// Purpose: tests finding Dholphin servers on the home network.
import { describe, expect, it } from 'vitest';
import { candidates, findServers, isPrivateV4 } from './discover';

describe('discover', () => {
  it('tries every other host of the private networks, the default port first', () => {
    const c = candidates(['192.168.1.42', '8.8.8.8', 'fe80::1']);
    expect(c).toHaveLength(2 * 253);
    expect(c[0]).toBe('http://192.168.1.1:8080');
    expect(c).not.toContain('http://192.168.1.42:8080');
    expect(c[253]).toBe('http://192.168.1.1');
    expect(c.some((x) => x.includes('8.8.8'))).toBe(false);
  });
  it('knows private IPv4 addresses', () => {
    expect(['10.0.0.2', '172.16.5.1', '192.168.0.9'].every(isPrivateV4)).toBe(true);
    expect(['172.32.0.1', '8.8.8.8', 'localhost'].some(isPrivateV4)).toBe(false);
  });
  it('reports only what answers as Dholphin, as it comes', async () => {
    const fetcher = (async (u: string) => {
      if (u === 'http://192.168.1.7:8080/api/status') return new Response(JSON.stringify({ app: 'dholphin', version: '0.34.0' }));
      if (u === 'http://192.168.1.8:8080/api/status') return new Response(JSON.stringify({ version: 'other' }));
      throw new Error('unreachable');
    }) as typeof fetch;
    const seen: string[] = [];
    const all = await findServers(candidates(['192.168.1.42']), (s) => seen.push(s.origin), { fetcher });
    expect(seen).toEqual(['http://192.168.1.7:8080']);
    expect(all[0]!.version).toBe('0.34.0');
  });
  it('stops when asked', async () => {
    const ac = new AbortController();
    let calls = 0;
    const fetcher = (async () => {
      if (++calls === 3) ac.abort();
      throw new Error('no');
    }) as typeof fetch;
    await findServers(candidates(['10.0.0.2']), () => undefined, { fetcher, signal: ac.signal, concurrency: 1 });
    expect(calls).toBe(3);
  });
});
