// Docs: docs/04 - Architecture/Server.md
// Purpose: the server's saved state: its settings and keys, the household's data, the household password and the devices.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** A JSON file written whole, to a temporary file then renamed, so a crash never leaves half of it. Docs: Node.js/File system. */
function jsonFile(path, empty) {
  let data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : structuredClone(empty);
  let timer = null;
  const flush = () => {
    timer = null;
    writeFileSync(`${path}.tmp`, JSON.stringify(data));
    renameSync(`${path}.tmp`, path);
  };
  return {
    get data() { return data; },
    set data(v) { data = v; },
    /** Saves within half a second; many changes in a row make one write. */
    save() { if (!timer) timer = setTimeout(flush, 500); },
    flush() { if (timer) { clearTimeout(timer); flush(); } },
  };
}

/**
 * Everything the server keeps, under `dir` (the Docker volume):
 * - settings.json: keys, Jellyfin and Seerr addresses, relay mode, the web app switch, the password hash;
 * - store.json: the household's data as the app keeps it (profiles, accounts, history, list, ratings...);
 * - devices.json: each signed-in browser or linked TV, by the hash of its token.
 */
export function openState(dir) {
  mkdirSync(dir, { recursive: true });
  const settings = jsonFile(join(dir, 'settings.json'), { keys: {}, jellyfin: '', seerr: '', seerrKey: '', relay: 'auto', webApp: true, password: null });
  const store = jsonFile(join(dir, 'store.json'), {});
  const devices = jsonFile(join(dir, 'devices.json'), []);
  // Until a password is set, setting one needs this code, printed in the container's log: whoever reaches a fresh
  // server from the internet can't claim it first.
  const setupCode = settings.data.password ? null : randomBytes(4).toString('hex').toUpperCase();
  return {
    settings, store, devices, setupCode,
    flush() { settings.flush(); store.flush(); devices.flush(); },
  };
}

/** The household password, stored as a salted scrypt hash. Docs: Node.js/Crypto (scrypt, timingSafeEqual). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export async function checkPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [, saltHex, hashHex] = stored.split(':');
  const want = Buffer.from(hashHex, 'hex');
  const got = await scrypt(password, Buffer.from(saltHex, 'hex'), want.length);
  return timingSafeEqual(want, got);
}

/**
 * Devices: a signed-in browser (cookie) or a linked TV (bearer token). Only the token's hash is kept. Each also has
 * a relay secret, which goes in the relay's path so a player can load video and pictures without sending headers.
 */
export function newDevice(state, name, kind) {
  const token = randomBytes(32).toString('base64url');
  const d = { id: randomBytes(6).toString('hex'), name: String(name || 'Device').slice(0, 60), kind, tokenHash: sha(token), relay: randomBytes(18).toString('base64url'), createdAt: Date.now(), lastSeen: Date.now() };
  state.devices.data.push(d);
  state.devices.save();
  return { device: d, token };
}
export function deviceByToken(state, token) {
  if (!token) return null;
  const h = sha(token);
  const d = state.devices.data.find((x) => x.tokenHash === h) ?? null;
  if (d && Date.now() - d.lastSeen > 3_600_000) {
    d.lastSeen = Date.now();
    state.devices.save();
  }
  return d;
}
export const deviceByRelay = (state, secret) => state.devices.data.find((x) => x.relay === secret) ?? null;
export function removeDevice(state, id) {
  state.devices.data = state.devices.data.filter((d) => d.id !== id);
  state.devices.save();
}

/** Pairing codes for TVs: six digits, from the panel, good for ten minutes and once. */
export function pairing() {
  const codes = new Map();
  return {
    create() {
      const code = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
      codes.set(code, Date.now() + 600_000);
      return code;
    },
    use(code) {
      const until = codes.get(String(code));
      codes.delete(String(code));
      return !!until && until > Date.now();
    },
  };
}

/** At most `max` tries per address in `windowMs`: for the password and pairing codes. */
export function limiter(max = 10, windowMs = 900_000) {
  const tries = new Map();
  return (ip) => {
    const now = Date.now(), list = (tries.get(ip) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    tries.set(ip, list);
    return list.length <= max;
  };
}
