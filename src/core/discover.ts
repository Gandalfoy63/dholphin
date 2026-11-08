// Docs: docs/04 - Architecture/Server.md
// Purpose: finds Dholphin servers on the home network: every address of the TV's own networks, on the server's ports.

/** The ports a Dholphin server is published on: the image's and Compose's default first, then plain http. */
export const DISCOVERY_PORTS = [8080, 80];

/** The addresses to try: each other host of the device's private IPv4 networks (taken as /24), port by port. */
export function candidates(own: string[], ports: number[] = DISCOVERY_PORTS): string[] {
  const nets = [...new Set(own.filter(isPrivateV4).map((a) => a.split('.').slice(0, 3).join('.')))];
  const out: string[] = [];
  for (const port of ports) for (const net of nets) for (let i = 1; i < 255; i++) {
    const host = `${net}.${i}`;
    if (!own.includes(host)) out.push(`http://${host}${port === 80 ? '' : `:${port}`}`);
  }
  return out;
}

export function isPrivateV4(a: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
}

export interface Found { origin: string; version: string }

/**
 * Asks each address for `/api/status`, a few dozen at a time, and reports each one that answers as a Dholphin server
 * (`app: "dholphin"`). Stops when `signal` aborts. Resolves once every address has answered or timed out.
 */
export async function findServers(origins: string[], onFound: (s: Found) => void, opts: { fetcher?: typeof fetch; signal?: AbortSignal; concurrency?: number; timeoutMs?: number } = {}): Promise<Found[]> {
  const { fetcher = fetch, signal, concurrency = 64, timeoutMs = 1500 } = opts;
  const found: Found[] = [];
  let next = 0;
  const worker = async () => {
    while (next < origins.length && !signal?.aborted) {
      const origin = origins[next++]!;
      const j = await fetcher(`${origin}/api/status`, { signal: AbortSignal.timeout(timeoutMs) })
        .then((r) => (r.ok ? (r.json() as Promise<{ app?: string; version?: string }>) : null))
        .catch(() => null);
      if (j?.app === 'dholphin' && !signal?.aborted) {
        const s = { origin, version: j.version ?? '' };
        found.push(s);
        onFound(s);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, origins.length) }, worker));
  return found;
}
