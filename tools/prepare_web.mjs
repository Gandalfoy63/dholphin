// Docs: docs/02 - Tech/Stack.md
// Purpose: copies logos and icons into web/public before a build.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const pub = join(root, 'web/public');
mkdirSync(join(pub, 'providers'), { recursive: true });
const logo = (from, to) => copyFileSync(join(root, 'brand', from), join(pub, to));
logo('providers/netflix/symbol-dark.png', 'providers/netflix.png');
logo('providers/jellyfin/symbol-dark.svg', 'providers/jellyfin.svg');
logo('providers/seerr/logo-dark.svg', 'providers/seerr.svg');
logo('logo/web/favicon.svg', 'favicon.svg');
// Chinese on the keyboard: pinyin to characters, built from Unicode's Unihan by tools/build_pinyin.py.
copyFileSync(join(root, 'data/pinyin.json'), join(pub, 'pinyin.json'));
const icons = 'eye mic-vocal user-round search house tv clapperboard sparkles layout-grid bookmark history inbox settings play info plus check star thumbs-up thumbs-down heart pencil lock delete rotate-ccw loader-circle arrow-up pause captions log-out trash-2 download globe rotate-cw gauge monitor-play list-video skip-forward circle-dashed clock server'.split(' ');
const symbols = icons.map((name) => {
  const svg = readFileSync(join(root, 'node_modules/lucide-static/icons', `${name}.svg`), 'utf8');
  const inner = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1].replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  return `<symbol id="i-${name}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
});
// Lucide has no tomato. Drawn on Lucide's 24 grid and stroke, in colour, as the only icon outside it: Design System.
symbols.push('<symbol id="i-tomato" viewBox="0 0 24 24"><path d="M12 7.5c-4.7 0-8.5 2.8-8.5 6.5 0 4 3.8 7.5 8.5 7.5s8.5-3.5 8.5-7.5c0-3.7-3.8-6.5-8.5-6.5z" fill="#E8432E" stroke="none"/><path d="M12 8.5 9 6M12 8.5 15 6M12 8.5 7.5 9.5M12 8.5l4.5 1M12 8.5v-5" fill="none" stroke="#3FAE5A" stroke-width="2" stroke-linecap="round"/></symbol>');
writeFileSync(join(pub, 'icons.svg'), `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`);
