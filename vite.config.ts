// Docs: docs/02 - Tech/Stack.md
// Purpose: builds the page in web/ into web/dist, with relative paths so it works inside the extension.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const here = import.meta.dirname;
export default defineConfig({
  root: resolve(here, 'web'),
  base: './',
  define: { __VERSION__: JSON.stringify(readFileSync(resolve(here, 'VERSION'), 'utf8').trim()) },
  resolve: { alias: { '@': resolve(here, 'src'), '@providers': resolve(here, 'providers'), '@hosts': resolve(here, 'hosts') } },
  build: { outDir: resolve(here, 'web/dist'), emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, modulePreload: false },
  test: { root: here, include: ['src/**/*.test.ts', 'providers/**/*.test.ts', 'tests/*.test.ts', 'tests/*.test.mjs'], environment: 'node' },
});
