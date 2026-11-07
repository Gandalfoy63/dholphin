// Docs: docs/04 - Architecture/Platform Hosts.md
// Purpose: the CoolDash launcher runs the extension from a writable copy, because the package is read-only on the TV.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CoolDash launcher', () => {
  it('copies a read-only extension to HOME, and replaces an old copy', () => {
    const d = mkdtempSync(join(tmpdir(), 'launch-'));
    const pkg = join(d, 'pkg');
    mkdirSync(join(pkg, 'ext/assets'), { recursive: true });
    writeFileSync(join(pkg, 'ext/assets/a.js'), 'new');
    cpSync('packaging/cooldash/launch', join(pkg, 'launch'));
    chmodSync(join(pkg, 'ext/assets/a.js'), 0o444);
    chmodSync(join(pkg, 'ext/assets'), 0o555);
    chmodSync(join(pkg, 'ext'), 0o555);
    const home = join(d, 'home');
    mkdirSync(join(home, 'ext'), { recursive: true });
    writeFileSync(join(home, 'ext/old.js'), 'old');
    const fake = join(d, 'chromium');
    writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n');
    chmodSync(fake, 0o755);
    const run = () => execFileSync('sh', [join(pkg, 'launch')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, XDG_RUNTIME_DIR: join(home, '.run'), DHOLPHIN_CHROMIUM: fake } });
    const args = run().trim().split('\n');
    expect(args).toContain(`--load-extension=${join(home, 'ext')}`);
    const start = args.at(-1)!;
    expect(start).toMatch(/^data:text\/html,<!--dholphin-->/); // never the extension's address: it isn't ready yet
    expect(start).not.toContain('#'); // a # would end the address there and cut the page
    expect(readFileSync(join(home, 'ext/assets/a.js'), 'utf8')).toBe('new');
    expect(existsSync(join(home, 'ext/old.js'))).toBe(false);
    writeFileSync(join(home, 'ext/assets/a.js'), 'written by Chromium');
    run(); // the second start must be able to remove the first copy
    expect(readFileSync(join(home, 'ext/assets/a.js'), 'utf8')).toBe('new');
    // the cached worker goes only when the package changed
    chmodSync(join(pkg, 'ext'), 0o755);
    chmodSync(join(pkg, 'ext/assets'), 0o755);
    writeFileSync(join(pkg, 'ext/manifest.json'), '{"version":"2"}');
    const worker = join(home, 'browser/Default/Service Worker');
    mkdirSync(worker, { recursive: true });
    run();
    expect(existsSync(worker)).toBe(false);
    mkdirSync(worker, { recursive: true });
    run();
    expect(existsSync(worker)).toBe(true);
  });
});
