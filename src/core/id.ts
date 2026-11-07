// Docs: docs/04 - Architecture/Data Model.md
// Purpose: random IDs. crypto.randomUUID exists only on HTTPS and localhost, and this also runs on plain LAN addresses.
export function newId(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
