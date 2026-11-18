// Docs: docs/04 - Architecture/Server.md
// Purpose: a server address as typed, turned into the addresses to try: a domain over https first, the home network over http first.

/** The address as typed: a scheme added when missing, a path kept (a server under a proxy's path), no trailing slash. */
export function normalizeOrigin(raw: string): string | null {
  return candidateOrigins(raw)[0] ?? null;
}

/**
 * Where a typed address may answer, in the order to try. With a scheme, only that. Without, a domain (a server
 * behind a reverse proxy, as tv.example.com) is tried over https first, and an address on the home network
 * (192.168.1.20:8080, localhost, nas.local, a bare name) over http first: each then the other way.
 */
export function candidateOrigins(raw: string): string[] {
  const typed = raw.trim();
  const clean = (u: URL) => (u.origin + u.pathname).replace(/\/+$/, '');
  try {
    // The scheme is checked before trailing slashes go: "http://" alone is no address, not a host named http.
    if (/^https?:\/\//i.test(typed)) return [clean(new URL(typed))];
    const s = typed.replace(/\/+$/, '');
    if (!s) return [];
    const u = new URL(`http://${s}`), h = u.hostname;
    const local = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || !h.includes('.');
    const http = clean(u), https = clean(new URL(`https://${s}`));
    return local ? [http, https] : [https, http];
  } catch {
    return [];
  }
}
