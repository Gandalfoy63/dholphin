// Docs: docs/04 - Architecture/Rust Core.md
// Purpose: loads the Rust core and calls it with JSON.
interface Exports { memory: WebAssembly.Memory; dh_alloc(n: number): number; dh_free(p: number, n: number): void; dh_call(p: number, n: number): bigint }
let core: Exports | null = null;
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function loadCore(url = './dholphin_core.wasm'): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The core could not load (${res.status})`);
  useCore((await WebAssembly.instantiate(await res.arrayBuffer(), {})).instance);
}

export function useCore(instance: WebAssembly.Instance): void {
  core = instance.exports as unknown as Exports;
}

export function call<T>(op: string, args: Record<string, unknown> = {}): T {
  if (!core) throw new Error('The core is not loaded');
  const bytes = enc.encode(JSON.stringify({ op, args }));
  const p = core.dh_alloc(bytes.length);
  new Uint8Array(core.memory.buffer, p, bytes.length).set(bytes);
  const packed = core.dh_call(p, bytes.length);
  const out = Number(packed >> 32n), len = Number(packed & 0xffffffffn);
  // Read only after the call: memory may have grown.
  const text = dec.decode(new Uint8Array(core.memory.buffer, out, len));
  core.dh_free(out, len);
  const r = JSON.parse(text) as { ok?: T; error?: string };
  if (r.error !== undefined) throw new Error(r.error);
  return r.ok as T;
}
