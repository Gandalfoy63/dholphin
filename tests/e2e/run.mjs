// Docs: docs/02 - Tech/Testing.md
// Purpose: drives the real app with the keyboard against the stand-in services, in the browser and as the extension.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createDoubles } from '../doubles/server.mjs';

const ROOT = join(import.meta.dirname, '../..');
const OUT = process.env.OUT ?? '/tmp/dholphin-e2e';
mkdirSync(OUT, { recursive: true });
const server = createDoubles();
await new Promise((r) => server.listen(8799, '127.0.0.1', r));
// Not localhost and not HTTPS, like a LAN address: browsers hide some APIs there.
const URL_ = 'http://dholphin.test:8799/';
const LOCAL = 'http://127.0.0.1:8799/';
let passed = 0;
const check = (name, ok, more = '') => {
  assert.ok(ok, `${name} ${more}`);
  passed++;
  console.log(`  ok  ${name}`);
};
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP dholphin.test 127.0.0.1'] });
const errors = [];
function watch(p) {
  p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
}
const focused = (p) => p.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 50));
const key = async (p, k, n = 1) => {
  for (let i = 0; i < n; i++) {
    await p.keyboard.press(k);
    await p.waitForTimeout(70);
  }
};
const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 15000 });
const shot = (p, n) => p.screenshot({ path: join(OUT, `${n}.png`) });
/** Opens a title through Search: a title now appears in only one row, so its row depends on the rows above it. */
async function openBySearch(p, name) {
  await p.evaluate(() => document.querySelector('[data-go="search"]').click());
  await until(p, () => document.querySelector('.kb'));
  await p.waitForTimeout(250);
  for (const c of name.toLowerCase()) await p.locator(`.kb [data-k="${c === ' ' ? ' ' : c}"]`).click();
  await p.waitForFunction((n) => [...document.querySelectorAll('#res .card')].some((c) => c.getAttribute('aria-label') === n), name, { timeout: 15000 });
  await p.waitForTimeout(150);
  await p.locator(`#res .card[aria-label="${name}"]`).focus();
  await p.keyboard.press('Enter');
}

/** Moves focus to the element with this text, by real key presses. */
async function press(p, text) {
  await p.getByRole('button', { name: text, exact: true }).first().focus();
  await p.keyboard.press('Enter');
}

console.log('Browser build');
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await ctx.newPage();
watch(p);
await p.goto(URL_);
await until(p, () => document.querySelector('.boot'));
check('The test runs on an insecure address, as on a LAN', !(await p.evaluate(() => isSecureContext)));
await p.waitForTimeout(600);
await shot(p, '01-start');
await until(p, () => document.querySelector('.onb'));
check('A first run opens onboarding', true);
check('The first screen offers the languages', (await p.locator('[data-lang]').count()) === 5);
await until(p, () => document.activeElement?.id === 'nx');
await shot(p, '02-welcome');
await key(p, 'Enter');
await until(p, () => document.querySelector('#malone'));
check('First, it asks how this device runs: a server by its address, or on its own (no network search in a browser)', !!(await p.locator('#maddr').count()) && !(await p.locator('#scan').count()));
await p.locator('#malone').click();

await until(p, () => document.querySelector('#fld-tmdb'));
check('Without keys it asks for them', await p.locator('#nx').isDisabled());
await p.fill('#fld-tmdb', 'bad');
await p.fill('#fld-omdb', 'x');
await press(p, 'Continue');
await until(p, () => document.querySelector('.err')?.textContent);
check('A refused key says so', (await p.locator('.err').textContent()).includes('refused'));
await p.fill('#fld-tmdb', 'good-key');
await press(p, 'Continue');

await until(p, () => document.querySelector('.nm'));
check('A profile needs a name', await p.locator('#nx').isDisabled());
await key(p, 'Enter'); // "a" from the on-screen keyboard
await key(p, 'ArrowRight');
await key(p, 'Enter'); // "b"
check('The on-screen keyboard types', (await p.locator('.nm').textContent()) === 'Ab');
await shot(p, '03-profile');
await press(p, 'Continue');

await until(p, () => document.querySelector('.prov'));
await shot(p, '04-services');
check('Providers appear from the registry', (await p.locator('.prov').count()) === 2);
await p.locator('[data-c="netflix"]').click();
await until(p, () => location.pathname.includes('/netflix/login'));
check('Netflix sign-in happens on its own page', true);
await p.getByRole('button', { name: 'Sign in' }).click();
await until(p, () => document.querySelector('.prov .st')?.textContent.includes('Connected'));
check('After sign-in it returns to setup, on the same step', (await p.locator('h1').textContent()).includes('services'));
await until(p, () => document.querySelector('[data-c="jellyfin"]'));
await p.locator('[data-c="jellyfin"]').click();
await until(p, () => document.querySelector('#fld-server'));
await p.fill('#fld-server', `${URL_}api/jf`);
await p.fill('#fld-user', 'tester');
await p.fill('#fld-seerrUrl', `${URL_}api/seerr`);
await p.fill('#fld-seerrKey', 'demo-key');
await shot(p, '05-jellyfin-form');
await p.locator('#cg').focus();
await key(p, 'Enter');
await until(p, () => !document.querySelector('.modal') && document.querySelector('.prov[data-p="jellyfin"] .st')?.textContent.includes('Connected'));
check('Jellyfin connects', true);
check('Setup signs in to Jellyfin with a DeviceId of the profile being made, not one shared by every setup', Object.keys(await p.evaluate(() => fetch('/api/jf/_devices').then((r) => r.json()))).every((d) => !d.endsWith('-setup')));
await press(p, 'Continue');

await until(p, () => document.querySelectorAll('.taste .tc[data-t]').length === 18);
await shot(p, '06-taste');
check('Continue waits for three picks', await p.locator('#nx').isDisabled());
await p.locator('.tc[data-t]').first().focus();
for (let i = 0; i < 3; i++) {
  await key(p, 'Enter');
  await key(p, 'ArrowRight');
}
check('Three picks unlock Continue', !(await p.locator('#nx').isDisabled()));
await press(p, 'Continue');
await until(p, () => document.querySelector('[data-g="language"]'));
await shot(p, '07-prefs');
await press(p, 'Finish');

await until(p, () => document.querySelector('.hero .hp'));
check('Setup ends on Home, with a hero', true);
{
  await p.waitForTimeout(1500);
  const im = await p.evaluate(() => {
    const vis = [...document.querySelectorAll('#tv img.art')].filter((i) => { const b = i.getBoundingClientRect(); return b.width && b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight; });
    const cards = [...document.querySelectorAll('.row .card img.art')].map((i) => i.getAttribute('src'));
    return { vis: vis.length, ok: vis.filter((i) => i.complete && i.naturalWidth).length, small: cards.length && cards.every((s) => /\/w(300|342|780)\/|fillWidth=(400|360|800)&/.test(s)), bad: cards.filter((s) => !/\/w(300|342|780)\/|fillWidth=(400|360|800)&/.test(s)).slice(0, 4), sprite: !!document.querySelector('#icons symbol'), outside: document.querySelectorAll('use[href*="icons.svg"]').length };
  });
  check('Every picture on screen at Home has loaded', im.vis > 3 && im.ok === im.vis, JSON.stringify(im));
  check('Row cards load small pictures (w300 backdrops, w342 posters, Jellyfin at the card\'s width)', !!im.small, JSON.stringify(im));
  check('The icons come from one sprite in the page, not an outside file each time', im.sprite && im.outside === 0, JSON.stringify(im));
}
{
  const devices = Object.keys(await p.evaluate(() => fetch('/api/jf/_devices').then((r) => r.json())));
  const id = await p.evaluate(() => new Promise((ok) => { const r = indexedDB.open('dholphin-v2'); r.onsuccess = () => { const g = r.result.transaction(r.result.objectStoreNames[0]).objectStore(r.result.objectStoreNames[0]).get('profiles'); g.onsuccess = () => ok(g.result?.[0]?.id); }; }));
  check('The new profile keeps the Jellyfin sign-in made during setup, under its own DeviceId', !!id && devices.some((d) => d.endsWith(`-${id}`)), `${id} ${devices}`);
}
await until(p, () => document.querySelectorAll('.row:not([hidden]) .card').length > 20);
await p.waitForTimeout(600);
await shot(p, '08-home');
const headings = await p.locator('.row:not([hidden])').evaluateAll((l) => l.filter((r) => r.querySelector('.card')).map((r) => r.querySelector('h2').textContent));
console.log('      rows:', headings.join(' | '));
for (const h of ['Top Picks for you', 'New Arrivals', 'Trending Now', 'Upcoming', 'Netflix', 'Jellyfin']) check(`Home has ${h}`, headings.includes(h));
{
  // Down two rows, then back up to the showcase: the page returns to its top and the showcase is in view.
  await p.locator('.hero .hp').focus();
  await key(p, 'ArrowDown');
  await key(p, 'ArrowDown');
  await p.waitForTimeout(500);
  const down = await p.evaluate(() => document.querySelector('.scroller').style.transform);
  await key(p, 'ArrowUp');
  await key(p, 'ArrowUp');
  await p.waitForTimeout(700);
  const up = await p.evaluate(() => { const h = document.querySelector('.hero').getBoundingClientRect(), tv = document.querySelector('#tv').getBoundingClientRect(); return { inHero: !!document.activeElement.closest('.hero'), top: Math.round(h.top - tv.top), t: document.querySelector('.scroller').style.transform }; });
  check('Going back up to the showcase brings it into view, without going to Home again', /translateY/.test(down) && up.inHero && up.top >= -2 && up.t === 'none', JSON.stringify({ down, ...up }));
}
{
  // Rows far from the focused one aren't drawn; the focused row lets the ones below step down.
  const back = await p.evaluate(() => document.activeElement?.className ?? '');
  await p.locator('.row:not([hidden]) .card').first().focus();
  const far = await p.evaluate(() => { const rows = [...document.querySelectorAll('.row:not([hidden])')]; return { n: rows.length, far: rows.filter((r) => r.classList.contains('far')).length, hidden: rows.filter((r) => getComputedStyle(r).contentVisibility === 'auto').length, fr: rows.findIndex((r) => r.classList.contains('fr')) }; });
  check('Rows more than three away from focus are skipped while off screen, and the focused row is marked', far.n > 5 && far.far === far.n - 4 && far.hidden === far.far && far.fr === 0, JSON.stringify(far));
  if (back.includes('hp')) await p.locator('.hero .hp').focus();
}
const bigCard = await p.locator('.row[data-row="new"] .card').first().boundingBox(), smallPoster = await p.locator('.row[data-row="top"] .card').first().boundingBox();
check('New Arrivals are big posters', bigCard.height > bigCard.width * 1.4 && bigCard.width > smallPoster.width * 1.3, JSON.stringify([bigCard, smallPoster]));
check('Empty rows hide themselves', await p.locator('.row[data-row="continue"]').evaluate((r) => r.hidden));
check('A profile that picked no anime gets no anime on Home', await p.evaluate(() => ![...document.querySelectorAll('.row:not([hidden]) .card')].some((c) => /^(Anime \d|Wild Geometry)/.test(c.getAttribute('aria-label') ?? '')) && !document.querySelector('.row[data-row="anilist-trending"]:not([hidden]) .card')));

// The Anime page, from the menu: only anime, its own rows. Jikan never answers: its row gives up and hides, the rest show.
await p.evaluate(() => document.querySelector('[data-go="anime"]').click());
const animeStart = Date.now();
await p.waitForFunction(() => document.querySelector('.row[data-row="anime-films"] .card') && document.querySelector('.row[data-row="mal-airing"]')?.hidden, null, { timeout: 20000 });
await p.waitForTimeout(400);
await shot(p, '08c-anime');
const animePage = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.row:not([hidden]) .card')].map((c) => c.getAttribute('aria-label')), rows: [...document.querySelectorAll('.row:not([hidden])')].filter((r) => r.querySelector('.card')).map((r) => r.dataset.row) }));
check('The menu has Anime, like Series and Movies', await p.evaluate(() => !!document.querySelector('[data-go="anime"]')));
check('The Anime page shows only anime', animePage.cards.length > 0 && animePage.cards.every((n) => /^(Anime \d|Animation \d|Wild Geometry)/.test(n)), JSON.stringify(animePage));
await until(p, () => document.querySelector('.hero .hp'));
check('The Anime page opens on a featured anime, like the other pages', /^(Anime \d|Animation \d|Wild Geometry)/.test(await p.locator('.hero h1').textContent()), await p.locator('.hero h1').textContent());
check('TV programmes stay out of the Anime page', !animePage.cards.some((n) => /Sketch Hour|Late Night Talk|Island Survivors/.test(n)));
check('A source that never answers hides its row within seconds, and the rows below still load', Date.now() - animeStart < 15000 && animePage.rows.includes('anime-films'), `${Date.now() - animeStart} ms ${animePage.rows}`);

// TV programmes: their own page; never in Series. The sketch show TMDB calls a comedy is known by its channel.
check('The menu has TV Shows', await p.evaluate(() => !!document.querySelector('[data-go="tvshows"]')));
await p.evaluate(() => document.querySelector('[data-go="tvshows"]').click());
await p.waitForFunction(() => [...document.querySelectorAll('.row:not([hidden]) .card')].length > 1, null, { timeout: 20000 });
await p.waitForTimeout(600);
await shot(p, '08d-tvshows');
const shows = await p.evaluate(() => [...new Set([...document.querySelectorAll('.row:not([hidden]) .card, .hero h1')].map((c) => c.getAttribute('aria-label') ?? c.textContent))]);
check('TV Shows lists talk shows, reality and the entertainment channels\' sketch shows', ['Sketch Hour', 'Late Night Talk', 'Island Survivors'].every((n) => shows.includes(n)), shows.join());
await p.evaluate(() => document.querySelector('[data-go="series"]').click());
await p.waitForFunction(() => document.querySelectorAll('.row:not([hidden]) .card').length > 10, null, { timeout: 20000 });
await p.waitForTimeout(1500);
const seriesNames = await p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.getAttribute('aria-label')));
check('Series leaves TV programmes out', !seriesNames.some((n) => /Sketch Hour|Late Night Talk|Island Survivors/.test(n)), seriesNames.filter((n) => /Sketch|Talk|Island/.test(n)).join());
await p.evaluate(() => document.querySelector('[data-go="home"]').click());
await until(p, () => document.querySelectorAll('.row:not([hidden]) .card').length > 20);

check('The closed menu covers only its own strip', await p.evaluate(() => { const s = document.querySelector('#tv').getBoundingClientRect().width / 1920; return !document.elementFromPoint(150 * s, 400 * s).closest('.rail') && !!document.elementFromPoint(50 * s, 400 * s).closest('.rail'); }));
const tens = await p.locator('.row[data-row="top10"] .card').first().boundingBox();
check('Top 10 cards are tall, with their rank', tens.height > tens.width && (await p.locator('.row[data-row="top10"] .num').first().textContent()) === '1');
await shot(p, '08a-top10');
const upc = await p.locator('.row[data-row="upcoming"] .card').first().boundingBox();
check('Upcoming cards are tall', upc.height > upc.width);
check('A poster shows no text of its own, its art has the name', await p.evaluate(() => { const c = [...document.querySelectorAll('.row[data-row="top"] .card')].find((x) => x !== document.activeElement && x.querySelector('img.art')); return !!c && !c.querySelector('.ct'); }));
check('A wide card shows its name without focus', await p.evaluate(() => { const c = [...document.querySelectorAll('.row[data-row="trending"] .card')].find((x) => x !== document.activeElement), n = c?.querySelector('.ct .cn'); return !!n?.textContent && Number(getComputedStyle(c.querySelector('.ct')).opacity) === 1 && n.getBoundingClientRect().height > 0; }));
const shape = await p.locator('.row[data-row="top"] .card').first().boundingBox();
check('Top Picks are tall posters', shape.height > shape.width * 1.3, JSON.stringify(shape));
const wide = await p.locator('.row[data-row="trending"] .card').first().boundingBox();
check('Other rows stay wide', wide.width > wide.height);
await p.mouse.move(40, 400, { steps: 3 });
await until(p, () => document.querySelector('.rail.open'));
await p.waitForTimeout(800);
await shot(p, '08b-menu-hover');
const labels = await p.evaluate(() => [...document.querySelectorAll('.rail .rname,.rail .ni>span:not(.av)')].map((s) => { const r = s.getBoundingClientRect(), b = document.elementFromPoint(r.left + 4, r.top + r.height / 2); return Number(getComputedStyle(s).opacity) === 1 && r.width > 0 && !!b?.closest('.rail'); }));
check('Opening the menu shows its name and every label', labels.length >= 9 && labels.every(Boolean), labels.join());
await p.mouse.move(1000, 700, { steps: 3 });
await until(p, () => !document.querySelector('.rail.open'));
check('Leaving the menu closes it', true);
await p.locator('.hero .hp').focus();
await key(p, 'ArrowDown');
await until(p, () => document.activeElement?.classList.contains('card'));
await p.waitForTimeout(800);
await shot(p, '09-card-focus');
const push = await p.evaluate(() => { const c = document.activeElement, row = c.closest('.row'), next = row.nextElementSibling; return { card: c.getBoundingClientRect().bottom, head: next.querySelector('h2').getBoundingClientRect().top }; });
check('A focused card grows, and the row under it steps down so its heading stays clear', push.head > push.card, JSON.stringify(push));
const ov = await p.locator('.card:focus .ov').innerText();
check('A focused poster shows its stars at the top right', /\d\.\d/.test(ov) && await p.evaluate(() => { const c = document.querySelector('.card:focus').getBoundingClientRect(), o = document.querySelector('.card:focus .ov').getBoundingClientRect(); return c.right - o.right < 30 && o.top - c.top < 30; }), ov);
const grade = await p.evaluate(() => ({ n: document.querySelectorAll('.card:focus .ov .score').length, tip: document.querySelector('.card:focus .ov .score')?.getAttribute('title') ?? '' }));
check('A focused card shows the overall grade, the average of every source, and the Tomato score beside it', grade.n === 2 && /IMDb/.test(grade.tip) && /Rotten Tomatoes/.test(grade.tip) && (await p.locator('.card:focus .ov .tom use[href$="#i-tomato"]').count()) === 1 && /\d+%/.test(ov), JSON.stringify(grade));
const modes = () => p.evaluate(() => [...document.activeElement.closest('.row').querySelectorAll('.card img.art')].map((i) => i.loading));
const firstModes = await modes();
check('A row loads its first eight pictures at once, not leaving them to the browser', firstModes.length > 10 && firstModes.slice(0, 8).every((m) => m === 'eager') && firstModes[9] === 'lazy', firstModes.join());
await key(p, 'ArrowRight', 3);
const nextModes = await modes();
check('Moving along a row loads the pictures about to come into view', nextModes.slice(0, 12).every((m) => m === 'eager'), nextModes.join());
await key(p, 'ArrowLeft', 3);
await p.waitForTimeout(400);
const ahead = await p.evaluate(() => { const c = document.querySelector('.card:focus'), cs = [...c.parentElement.querySelectorAll('.card')], next = cs[cs.indexOf(c) + 1]; return next?.querySelector('.ov .score')?.getAttribute('title') ?? ''; });
check('The next card has its full grade before focus reaches it', /IMDb/.test(ahead), ahead);
const posterOv = await p.evaluate(() => { const c = document.querySelector('.card:focus'), b = c.getBoundingClientRect(), a = c.querySelector('.oa'); return { name: !!c.querySelector('.ct'), ov: c.querySelector('.ov').innerText, bottom: a?.innerText ?? '', low: a ? b.bottom - a.getBoundingClientRect().bottom < 30 : false }; });
check('The poster chip fits inside the card', await p.evaluate(() => { const c = document.querySelector('.card:focus').getBoundingClientRect(), o = document.querySelector('.card:focus .ov').getBoundingClientRect(); return o.left >= c.left && o.right <= c.right; }));
check('A focused poster has no name; the grade and Tomato score at the top right, the year and age at the bottom', !posterOv.name && /\d\.\d/.test(posterOv.ov) && /%/.test(posterOv.ov) && !/PG|TV-|\bR\b/.test(posterOv.ov) && /(19|20)\d\d/.test(posterOv.bottom) && /PG|R|TV/.test(posterOv.bottom) && posterOv.low, JSON.stringify(posterOv));
const cardText = await p.locator('.card:focus').innerText();
check('A focused card never says where it comes from', !/Netflix|Jellyfin|server/i.test(cardText), cardText);
check('Nothing appears below a card', (await p.locator('.det').count()) === 0);
// Wide cards: the image carries the name; focus shows a chip at the top right with stars, Tomato, year and age.
await p.locator('.row[data-row="trending"] .card').first().focus();
// Playwright's focus scrolls the clipped page natively, which the remote never does: undo it.
await p.evaluate(() => { for (let e = document.activeElement; e; e = e.parentElement) e.scrollTop = 0; });
await key(p, 'ArrowRight');
await key(p, 'ArrowLeft');
await until(p, () => document.querySelector('.card:focus .ct .tag'));
await p.waitForTimeout(300);
await shot(p, '09d-wide-card');
const wideCard = await p.evaluate(() => { const c = document.querySelector('.card:focus'), n = c.querySelector('.ct .cn'), a = c.querySelector('.ct .tag'); return { name: n?.textContent ?? '', ageBeside: !!a && Math.abs(n.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom) < 10 && n.getBoundingClientRect().right <= a.getBoundingClientRect().left, ov: c.querySelector('.ov').innerText }; });
check('A wide card shows its name with the age next to it, and only stars and Tomato in its chip', !!wideCard.name && wideCard.ageBeside && /\d\.\d/.test(wideCard.ov) && !/(19|20)\d\d/.test(wideCard.ov), JSON.stringify(wideCard));
// Staying on a card plays its trailer; the row makes room instead of being covered.
let pv = false;
// With the remote, as on a TV: the focused row sits near the top.
await key(p, 'ArrowRight');
for (let i = 0; i < 4 && !pv; i++) {
  pv = await p.waitForFunction(() => document.querySelector('.pv iframe'), null, { timeout: 3600 }).then(() => true, () => false);
  if (!pv) await key(p, 'ArrowRight');
}
await p.waitForTimeout(500);
await shot(p, '09c-trailer');
const room = await p.evaluate(() => {
  const f = document.querySelector('.pv iframe'), c = document.querySelector('.card:focus'), row = c.closest('.row');
  const after = [...row.querySelectorAll('.card')].slice([...row.querySelectorAll('.card')].indexOf(c) + 1)[0];
  const below = row.nextElementSibling;
  const pr = document.querySelector('.pv').getBoundingClientRect(), fr = f.getBoundingClientRect(), s = document.querySelector('#tv').getBoundingClientRect().width / 1920;
  return { src: f.src, hidden: c.classList.contains('pvon'), slid: !!after && after.getBoundingClientRect().left >= pr.right - 2, down: !below || below.getBoundingClientRect().top >= pr.bottom - 2, big: fr.width / s >= 480 && fr.height / s >= 270 };
});
check('Staying on a card plays its trailer in YouTube\'s player', pv && /\/api\/yt\/yt\d+\?autoplay=1/.test(room.src) && room.big, JSON.stringify(room));
check('The row slides to make room for it', room.hidden && room.slid && room.down, JSON.stringify(room));
await key(p, 'ArrowLeft');
await p.waitForTimeout(400);
check('Moving on closes the trailer and puts the row back', (await p.locator('.pv').count()) === 0 && (await p.evaluate(() => [...document.querySelectorAll('.card,.row')].every((e) => !e.style.translate))));

await key(p, 'ArrowRight', 2);
const before = await focused(p);
await key(p, 'ArrowDown');
await key(p, 'ArrowUp');
check('A row remembers its card', (await focused(p)) === before);

// Scrolling loads further rows: categories repeat, films don't, and decades separate them.
await p.locator('.row[data-row="top"] .card').first().focus();
await key(p, 'ArrowDown', 22);
await p.waitForTimeout(1500);
await key(p, 'ArrowDown', 22);
await p.waitForTimeout(1500);
await shot(p, '09b-deep');
const report = await p.evaluate(() => {
  const all = [...document.querySelectorAll('.row:not([hidden])')].filter((r) => r.querySelector('.card'));
  const free = all.filter((r) => !['continue', 'top10', 'rows-jellyfin', 'requested', 'list'].includes(r.dataset.row));
  const names = free.flatMap((r) => [...r.querySelectorAll('.card')].map((c) => c.getAttribute('aria-label')));
  const dec = all.filter((r) => /^best-\d{4}-/.test(r.dataset.row));
  const bands = all.filter((r) => r.classList.contains('sep')).map((r) => r.dataset.row.split('-')[0]);
  return { bands: [...new Set(bands)], made: document.querySelectorAll('.row').length, rows: all.length, cards: names.length, unique: new Set(names).size, repeats: names.filter((n, i) => names.indexOf(n) !== i).slice(0, 5), decades: dec.map((r) => Number(r.dataset.row.slice(5, 9))), years: dec.map((r) => [...r.querySelectorAll('.card')].map((c) => Number(c.dataset.y))), pattern: all.map((r) => r.dataset.row).slice(-14).join(' ') };
});
check('The because row names the title', /^Because you liked ./.test(await p.locator('.row[data-row="because"] h2').textContent()));
console.log('      deep rows', report.rows, 'cards', report.cards, 'decades', report.decades.join(), '|', report.pattern);
check('More rows load while scrolling', report.rows > 15, String(report.rows));
check('Bands between rows are of many kinds, not only decades', ['best', 'award', 'theme'].every((b) => report.bands.includes(b)), report.bands.join());
check('Scrolling adds rows past the first batch', report.made > 26, String(report.made));
check('No film appears twice on the page', report.cards === report.unique && report.cards > 100, `${report.cards} ${report.unique} ${report.repeats}`);
check('Categories come back, with their best rated', (await p.locator('.row[data-row^="best-of-"]:not([hidden])').count()) >= 1 && (await p.locator('.row[data-row^="genre-"]:not([hidden])').count()) >= 3);
check('Decades run from newest to oldest', report.decades.length >= 1 && report.decades.every((d, i) => i === 0 || d < report.decades[i - 1]), report.decades.join());
check('Each decade row keeps to its decade, ordered for the profile', report.years.every((y, i) => y.length > 3 && y.every((v) => v >= report.decades[i] && v <= report.decades[i] + 9)), JSON.stringify(report.years[0]));
await p.locator('.row[data-row="top"] .card').first().focus();
await key(p, 'ArrowLeft');
await until(p, () => document.querySelector('.rail.open'));
await p.waitForTimeout(350);
await shot(p, '10-menu');
check('Left from the first card opens the menu, on the current page', (await focused(p)).includes('Home'));
await key(p, 'ArrowRight');
check('Right returns to the card', await p.evaluate(() => document.activeElement.classList.contains('card') && !document.querySelector('.rail.open')));

// Categories
await p.evaluate(() => document.querySelector('[data-go="categories"]').click());
await until(p, () => document.querySelector('.cat'));
await until(p, () => document.querySelectorAll('.cat .cimg').length > 6);
await p.waitForTimeout(800);
await shot(p, '11-categories');
const names = await p.locator('.cfeat .ctxt b').allTextContents();
check('New Arrivals, Upcoming and You Requested are featured', ['New Arrivals', 'Upcoming', 'You Requested'].every((n) => names.includes(n)), names.join());
const grad = await p.locator('.cat .cgrad').first().evaluate((e) => getComputedStyle(e).backgroundImage);
check('Tiles have a gradient over a real image', grad.includes('gradient') && (await p.locator('.cat .cimg.on').count()) > 3);
await p.locator('.cat[data-cat="new"]').focus();
const first = await p.locator('.cat[data-cat="new"] .cimg.on').getAttribute('src');
await p.waitForTimeout(3900);
check('A focused tile changes its image', (await p.locator('.cat[data-cat="new"] .cimg.on').getAttribute('src')) !== first);
await key(p, 'ArrowDown', 3);
await p.waitForTimeout(400);
await shot(p, '12-categories-scrolled');
const inView = await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
check('Focus scrolls the page', inView);
await p.locator('.cat[data-cat="new"]').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.chero h1') && document.querySelector('.row .card'));
await p.waitForTimeout(500);
await shot(p, '13-new-arrivals');
const today = new Date().toISOString().slice(0, 10);
check('New Arrivals opens with its own rows', (await p.locator('.row:not([hidden]) h2').allTextContents()).some((h) => h.includes('New')));
await key(p, 'Escape');
await until(p, () => document.querySelector('.cat'));
await p.locator('.cat[data-cat="upcoming"]').click();
await until(p, () => document.querySelector('.chero h1')?.textContent === 'Upcoming' && document.querySelector('.row .card'));
const upcoming = await p.locator('.row .card').evaluateAll((cs) => cs.map((c) => c.getAttribute('aria-label')));
check('Upcoming shows unreleased titles', upcoming.includes('Winter Ledger') && !upcoming.includes('Low Tide'), upcoming.join());
// A category's page goes on as it scrolls, like Home: Upcoming adds a row per coming month.
const catRows = await p.locator('.row').count();
for (let i = 0; i < 6; i++) await key(p, 'ArrowDown');
await p.waitForFunction((n) => document.querySelectorAll('.row').length > n, catRows, { timeout: 15000 });
const deep = await p.evaluate(() => [...document.querySelectorAll('.row h2')].map((h) => h.textContent));
check('A category page scrolls deeper, Upcoming month by month', deep.some((h) => /^[A-Z][a-z]+ \d{4}: (movies|series)$/.test(h)), deep.join(' | '));
await shot(p, '13b-upcoming-deep');
// At the bottom, every title of the page in one grid, sorted for you, or by grade.
for (let i = 0; i < 40 && !(await p.locator('.every .card').count()); i++) {
  await key(p, 'ArrowDown');
  await p.waitForTimeout(150);
}
await until(p, () => document.querySelectorAll('.every .card').length > 0);
const everyFor = await p.locator('.every .card').evaluateAll((cs) => cs.map((c) => c.getAttribute('aria-label')));
check('The bottom of a page lists all its titles, each once, sorted for you', everyFor.length > 0 && new Set(everyFor).size === everyFor.length && (await p.locator('.every [data-sort="you"]').getAttribute('aria-pressed')) === 'true', everyFor.join());
await p.locator('.every [data-sort="grade"]').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.every [data-sort="grade"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.every .card'));
const everyGrade = await p.locator('.every .card').evaluateAll((cs) => cs.map((c) => c.getAttribute('aria-label')));
check('Best rated sorts the same titles by their grade', everyGrade.length === everyFor.length && [...everyGrade].sort().join() === [...everyFor].sort().join(), everyGrade.join());
await p.locator('.every .card').first().focus();
await p.waitForTimeout(500);
check('A card in the grid is brought into view', await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
await shot(p, '13c-all-titles');
void today;

// Details and request
await openBySearch(p, 'Kestrel');
await until(p, () => document.querySelector('.dlayer #dq'));
await p.waitForTimeout(500);
await shot(p, '14-details-request');
check('The details show the source as logo and name', (await p.locator('.dlayer .pvd').innerText()).includes('Seerr') && (await p.locator('.dlayer .pvd img').count()) > 0);
check('Nothing says "your server"', !/your server/i.test(await p.locator('.dlayer').innerText()));
await p.locator('#dq').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('#dq').textContent.includes('Requested'));
check('Request goes to Seerr', true);
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));
check('Back returns focus to the card', (await focused(p)).includes('Kestrel'));

await p.evaluate(() => document.querySelector('[data-go="categories"]').click());
await until(p, () => document.querySelector('.cat[data-cat="requested"]'));
await p.locator('.cat[data-cat="requested"]').click();
await until(p, () => document.querySelector('.grid .card') );
await shot(p, '15-you-requested');
check('You Requested lists it, with the state from Seerr', (await p.locator('.grid .card').evaluateAll((l) => l.map((c) => c.getAttribute('aria-label')))).includes('Kestrel') && (await p.locator('.grid .state').innerText()) === 'Downloading');

// The Requests page: every request from Seerr, grouped by where it stands, a download with its progress and time left.
await p.evaluate(() => document.querySelector('[data-go="requests"]').click());
await until(p, () => document.querySelector('.rqpg [data-rq]'));
await p.waitForTimeout(600);
await shot(p, '15b-requests');
const rq = await p.evaluate(() => ({
  groups: [...document.querySelectorAll('.rqpg .hgrp')].map((h) => h.firstChild.textContent.trim()),
  dl: document.querySelector('.rqpg [data-rq="901"]')?.innerText.replace(/\s+/g, ' ') ?? '',
  tags: Object.fromEntries([...document.querySelectorAll('.rqpg [data-rq]')].map((b) => [b.dataset.rq, b.querySelector('.tag')?.textContent ?? 'bar'])),
  series: document.querySelector('.rqpg [data-rq="903"]')?.innerText ?? '',
  seriesLabel: document.querySelector('.rqpg [data-rq="903"]')?.getAttribute('aria-label') ?? '',
  box: [...document.querySelectorAll('.rqpg [data-rq]')].every((b) => { const r = b.getBoundingClientRect(); return b.classList.contains('poster') && r.height > r.width * 1.3; }),
  bar: (() => { const b = document.querySelector('.rqpg [data-rq="901"]'), bar = b?.querySelector('.rqbar'); if (!bar) return {}; const br = b.getBoundingClientRect(), r = bar.getBoundingClientRect(); return { atBottom: Math.abs(br.bottom - r.bottom) < 3, scale: new DOMMatrix(getComputedStyle(bar.querySelector('i')).transform).a }; })(),
  status: document.querySelector('#rqs').textContent,
}));
check('Requests are grouped by where they stand: downloading first, then waiting, available, and what won\'t come', rq.groups.join() === 'Downloading,Waiting,Available,Not coming', JSON.stringify(rq.groups));
check('A download shows how far it is, the time left and when it will be ready, with its bar along the bottom of its box', /40%/.test(rq.dl) && /1 h 3\d min left/.test(rq.dl) && /ready at \d\d:\d\d/.test(rq.dl) && /tester/.test(rq.dl) && rq.bar.atBottom && Math.abs(rq.bar.scale - 0.4) < 0.01, rq.dl + JSON.stringify(rq.bar));
check('Each other request says its state plainly', rq.tags['902'] === 'Waiting for approval' && rq.tags['903'] === 'Looking for a download' && rq.tags['904'] === 'Available' && rq.tags['905'] === 'Declined', JSON.stringify(rq.tags));
check('Requests are poster boxes; a series names its seasons and who asked, and the page says when it was updated', rq.box && /Seasons 1 to 2/.test(rq.series) && /Jules/.test(rq.series) && /asked by Jules/.test(rq.seriesLabel) && /requests · updated at/.test(rq.status), rq.series + ' | ' + rq.status);
check('Kestrel, just requested, is there, being looked for', (await p.locator('.rqpg [data-rq="110"] .tag').textContent()) === 'Looking for a download');
await p.locator('[data-rw="mine"]').click();
const mineIds = await p.locator('.rqpg [data-rq]').evaluateAll((l) => l.map((b) => b.dataset.rq));
check('Mine shows only this profile\'s requests (its Seerr user)', mineIds.length > 0 && mineIds.every((id) => ['901', '904', '110'].includes(id)) && !mineIds.includes('902'), mineIds.join());
await p.locator('[data-rw="all"]').click();

// Choosing seasons
await openBySearch(p, 'Iron Meridian');
await until(p, () => document.querySelector('.dlayer #dq'));
await p.locator('#dq').focus();
await key(p, 'Enter');
await until(p, () => document.querySelectorAll('.sopt').length);
await p.waitForTimeout(300);
await shot(p, '15b-seasons');
check('A series lists its seasons, without specials', (await p.locator('.sopt').count()) === 3 && !(await p.locator('.panel.seasons').innerText()).includes('Specials'));
check('Nothing is requested until a season is chosen', await p.locator('#sgo').isDisabled());
await key(p, 'Enter');
await key(p, 'ArrowRight', 2);
await key(p, 'Enter');
check('The button counts the choice', (await p.locator('#sgo').textContent()) === 'Request 2 seasons');
await key(p, 'ArrowLeft');
await key(p, 'Enter');
check('All seasons follows the choices', (await p.locator('#sall').getAttribute('aria-pressed')) === 'true');
await key(p, 'Enter');
check('A season can be unchosen', (await p.locator('#sgo').textContent()) === 'Request 2 seasons');
await p.locator('#sgo').focus();
await key(p, 'Enter');
await until(p, () => !document.querySelector('.modal'));
const sent = await p.evaluate(async () => (await (await fetch('/api/seerr/api/v1/_test/requests', { headers: { 'X-Api-Key': 'demo-key' } })).json()).find((r) => r.seasons.length));
check('Seerr receives exactly those seasons', JSON.stringify(sent.seasons) === '[1,3]', JSON.stringify(sent));
check('More seasons can still be requested', (await p.locator('#dq').textContent()) === 'Request more seasons');
await key(p, 'Enter');
await until(p, () => document.querySelectorAll('.sopt').length);
await p.waitForTimeout(250);
await shot(p, '15c-seasons-again');
check('Requested seasons show as such, and only the rest can be chosen', (await p.locator('.sopt:disabled').count()) === 2 && (await p.locator('.sopt:not(:disabled)').count()) === 1 && (await p.locator('.sopt:disabled').first().innerText()).includes('Downloading'));
await key(p, 'Escape');
await until(p, () => !document.querySelector('.modal'));
check('Back closes the picker, keeping the title open', (await p.locator('.dlayer').count()) === 1 && (await focused(p)).includes('Request more'));
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));

// Jellyfin playback
await openBySearch(p, 'Black Orchard');
await until(p, () => document.querySelector('.dlayer [data-play="jellyfin"]'));
await p.waitForTimeout(400);
await shot(p, '16-details-jellyfin');
check('Jellyfin titles show its logo and name', (await p.locator('.dlayer .pvd').innerText()).includes('Jellyfin'));
await p.locator('[data-play="jellyfin"]').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.player video')?.currentTime > 0.5);
check('The video plays', true);
const vt = () => p.evaluate(() => document.querySelector('.player video').currentTime);
const jfLog = () => p.evaluate(() => fetch('/api/jf/_log').then((r) => r.json()));
// Skipping: the server marks 2 s to 12 s as the intro.
await until(p, () => document.querySelector('.pprompt [data-a="skip"]'));
check('The intro offers to skip it', (await p.locator('.pprompt').innerText()).includes('Skip intro'));
await key(p, 'ArrowUp');
check('Up reaches the skip button', (await focused(p)).includes('Skip intro'));
await key(p, 'Enter');
await p.waitForTimeout(300);
const afterSkip = await vt();
check('OK skips the intro', afterSkip >= 11.5 && afterSkip < 14, String(afterSkip));
// Seeking: presses add up with a preview picture, then one jump.
await key(p, 'ArrowRight');
const thumb = await p.evaluate(() => ({ shown: !document.querySelector('.pthumb').hidden, bg: document.querySelector('.pimg').style.backgroundImage, ch: document.querySelector('.pch').textContent, flash: document.querySelector('.pflash').textContent }));
check('Seeking shows the preview picture, the chapter and how far', thumb.shown && thumb.bg.includes('Trickplay/320/0.jpg') && thumb.ch === 'The middle' && thumb.flash.includes('+0:10'), JSON.stringify(thumb));
await shot(p, '17-player-seek');
await p.waitForTimeout(900);
const pos = await vt();
check('Right seeks forward 10 s once the presses stop', pos > afterSkip + 9 && pos < afterSkip + 13, String(pos));
check('The preview goes away after the jump', await p.evaluate(() => document.querySelector('.pthumb').hidden));
await key(p, 'Enter');
await p.waitForTimeout(200);
check('OK pauses', await p.evaluate(() => document.querySelector('.player video').paused));
await shot(p, '17-player');
// Audio and subtitles, by the remote: Down to the buttons, Right to the menu.
await key(p, 'ArrowDown');
check('Down reaches the buttons', (await focused(p)).includes('Play'));
await key(p, 'ArrowRight', 2);
check('The buttons say what they do', (await focused(p)).includes('Audio and subtitles'));
await key(p, 'Enter');
await until(p, () => !document.querySelector('.ppanel').hidden);
check('The menu lists both audio tracks and every subtitle', (await p.locator('.ppanel [data-au]').count()) === 2 && (await p.locator('.ppanel [data-su]').count()) === 4);
check('The menu starts on the track playing', (await focused(p)).includes('English - Stereo'));
await key(p, 'ArrowRight');
check('Right moves to the subtitles, on the one chosen', (await focused(p)).includes('Off'));
await key(p, 'ArrowDown');
await shot(p, '17-player-tracks');
await key(p, 'Enter');
await until(p, () => document.querySelector('.psub').textContent.includes('Hello from the test server'));
check('Text subtitles show at once, drawn by the page', true);
check('Back in the buttons after choosing', (await focused(p)).includes('Audio and subtitles'));
const atAudio = await vt();
await key(p, 'Enter');
await until(p, () => !document.querySelector('.ppanel').hidden);
await key(p, 'ArrowDown');
await key(p, 'Enter');
await p.waitForFunction(() => fetch('/api/jf/_log').then((r) => r.json()).then((l) => l.some((x) => x.path === 'PlaybackInfo' && x.AudioStreamIndex === 2)), null, { timeout: 15000 });
await p.waitForTimeout(800);
const afterAudio = await vt();
const stillPaused = await p.evaluate(() => document.querySelector('.player video').paused);
check('Another audio track asks the server for it, and keeps the place and the pause', Math.abs(afterAudio - atAudio) < 1.5 && stillPaused, `${atAudio} ${afterAudio} ${stillPaused}`);
check('Subtitles stay on after the audio changes', (await p.locator('.psub').innerText()).includes('Hello'));
await key(p, 'Enter');
await until(p, () => !document.querySelector('.ppanel').hidden);
await key(p, 'ArrowRight');
await key(p, 'ArrowDown', 2);
check('Picture subtitles are listed too', (await focused(p)).includes('PGS'));
await key(p, 'Enter');
await p.waitForFunction(() => fetch('/api/jf/_log').then((r) => r.json()).then((l) => l.some((x) => x.path === 'PlaybackInfo' && x.SubtitleStreamIndex === 5 && x.AudioStreamIndex === 2)), null, { timeout: 15000 });
await p.waitForTimeout(500);
check('Picture subtitles are drawn in by the server, with the audio kept', (await p.locator('.psub').innerText()).trim() === '');
// Speed
await key(p, 'ArrowRight');
check('Speed is next', (await focused(p)).includes('Speed'));
await key(p, 'Enter');
await until(p, () => !document.querySelector('.ppanel').hidden);
check('Speed starts on Normal', (await focused(p)).includes('Normal'));
await key(p, 'ArrowDown');
await key(p, 'Enter');
await p.waitForTimeout(200);
check('A speed applies to the video', (await p.evaluate(() => document.querySelector('.player video').playbackRate)) === 1.25);
check('Quality is offered for a server stream', await p.locator('.prow [data-a="quality"]').isVisible());
check('A film has no episode buttons', !(await p.locator('.prow [data-a="episodes"]').isVisible()) && !(await p.locator('.prow [data-a="next"]').isVisible()));
await key(p, 'Escape');
await until(p, () => !document.querySelector('.player'));
check('Back leaves the player, onto the details', !!(await p.locator('.dlayer').count()));
const stopped = (await jfLog()).filter((x) => x.path === '/Sessions/Playing/Stopped').pop();
check('The server hears where it stopped, with the tracks', stopped && stopped.AudioStreamIndex === 2 && stopped.SubtitleStreamIndex === 5 && stopped.PositionTicks > 200_000_000, JSON.stringify(stopped));
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));
await p.evaluate(() => document.querySelector('[data-go="history"]').click());
await until(p, () => document.querySelector('.lst .li'));
await shot(p, '18-history');
check('Watching lands in History', (await p.locator('.lst').innerText()).includes('Black Orchard'));
check('History groups by day and says how far each got', (await p.locator('.hgrp').first().textContent()) === 'Today' && (await p.locator('.hrow').count()) >= 1);
// A plain page slides to keep focus in view: it used to stop at the bottom of the screen.
await p.evaluate(() => { const pg = document.querySelector('.pg'); pg.insertAdjacentHTML('beforeend', '<div style="height:1600px"></div><button class="f btn" id="lowest" type="button">Low</button>'); });
await p.locator('#lowest').focus();
await p.waitForTimeout(600);
check('A long page scrolls down to what has focus', await p.evaluate(() => { const r = document.querySelector('#lowest').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }));

// Cast: below the buttons, before More like this, moved to with the remote.
await openBySearch(p, 'Wild Geometry');
await until(p, () => document.querySelectorAll('.dlayer .dcast .pc').length >= 4 && document.querySelector('.dlayer .more .card'));
check('The one-line cast list is gone from the top', !(await p.locator('.dlayer .dtext').innerText()).includes('Lea Durand'));
const order = await p.evaluate(() => [...document.querySelectorAll('.dlayer .dsecs > section')].filter((x) => x.children.length).map((x) => x.className));
check('Cast and the voices come before More like this, then the ratings', /^dcast,dcast,more(,grades)?$/.test(order.join()), order.join());
const people = await p.evaluate(() => [...document.querySelectorAll('[data-sec="cast"] .pc')].map((c) => ({ name: c.querySelector('b').textContent, role: c.querySelector('.muted')?.textContent ?? '', pics: c.querySelectorAll('.pci').length, big: !!c.querySelector('.pci.one'), ini: !!c.querySelector('.ini') })));
check('The producer comes first, named as such', people[0].name.startsWith('Producer') && people[0].role === 'Producer', JSON.stringify(people[0]));
check('A drawn character shows its picture beside the actor, the same size', people[1].name === 'Lea Durand' && people[1].role === 'Mara' && people[1].pics === 2, JSON.stringify(people[1]));
check('An actor without a character picture shows a big face and the role', people[2].name === 'Tom Vega' && people[2].role === 'The Keeper' && people[2].big, JSON.stringify(people[2]));
check('Without a photo, the initials stand in', people[3].ini && people[3].role.startsWith('Guard'), JSON.stringify(people[3]));
const voices = await p.evaluate(() => ({ h: document.querySelector('[data-sec="voices"] h2')?.textContent, names: [...document.querySelectorAll('[data-sec="voices"] .pc b')].map((b) => b.textContent), pics: document.querySelectorAll('[data-sec="voices"] .pc .pci').length, cred: [...document.querySelectorAll('.ccred')].map((x) => x.textContent).join(' ') }));
check('A film first made in another language lists the voices in yours, from its Wikipedia article, in billing order', voices.h === 'English voices' && voices.names.join() === 'Sam Rowe,Ana Pike' && voices.pics === 3, JSON.stringify(voices));
check('The voices name their source and its licence', voices.cred.includes('Voices from Wikipedia (en), under CC BY-SA'), voices.cred);
// Ratings: one row per source that knows the title; a source that fails is left out.
await until(p, () => document.querySelector('[data-sec="grades"] tbody tr'));
const grades = await p.evaluate(() => [...document.querySelectorAll('[data-sec="grades"] tbody tr')].map((r) => [r.querySelector('th').textContent, r.querySelector('td').textContent]));
check('The ratings table lists every source that has a score', grades.some(([s]) => s === 'TMDB') && grades.some(([s, v]) => s === 'AniList' && v === '81 / 100'), JSON.stringify(grades));
check('A source that fails is left out of the ratings', !grades.some(([s]) => s === 'MyAnimeList'));
check('The ratings come last, after More like this', await p.evaluate(() => { const s = [...document.querySelectorAll('.dlayer .dsecs > section')].filter((x) => x.children.length).map((x) => x.dataset.sec); return s[s.length - 1] === 'grades'; }));
// The registry: every title once, with who gave it first. Saved within 10 s of a change.
await p.waitForTimeout(10_500);
const reg = await p.evaluate(() => new Promise((ok) => { const r = indexedDB.open('dholphin-v2', 1); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('registry.json'); q.onsuccess = () => ok(q.result); }; }));
const wild = Object.values(reg?.titles ?? {}).filter((e) => e.name === 'Wild Geometry');
check('Each title is in the registry once, with its first source and the others', wild.length === 1 && wild[0].first === 'TMDB' && wild[0].secondary.includes('AniList'), JSON.stringify(wild.map(({ title, ...e }) => e)));
check('A show TVmaze lists is matched to TMDB by its IMDb ID', Object.values(reg.titles).some((e) => e.kind === 'series' && (e.first === 'TVmaze' || e.secondary.includes('TVmaze'))));
check('A title TMDB lacks is left out', !Object.values(reg.titles).some((e) => e.name === 'Comet Garden'));

check('Commons pictures are credited', voices.cred.includes('Test Artist, CC BY-SA 4.0') && voices.cred.includes('Mara'), voices.cred);
await key(p, 'ArrowDown');
await p.waitForTimeout(650);
const castFocus = await p.evaluate(() => ({ at: document.activeElement.closest('[data-sec]')?.dataset.sec ?? document.activeElement.className, inCast: !!document.activeElement.closest('[data-sec="cast"]'), y: new DOMMatrix(getComputedStyle(document.querySelector('.dscroll')).transform).m42, top: document.activeElement.getBoundingClientRect().top / (document.querySelector('#tv').getBoundingClientRect().height / 1080) }));
check('The picture behind dims under the cast, and nothing behind the page shows', await p.evaluate(() => Number(getComputedStyle(document.querySelector('.dback'), '::after').opacity) > 0.8 && Number(getComputedStyle(document.querySelector('.dback')).opacity) === 1));
check('Down from the buttons reaches the cast, and the page moves up to show it', castFocus.inCast && castFocus.y < -300 && castFocus.top > 0 && castFocus.top < 1000, JSON.stringify(castFocus));
await shot(p, '19a-cast');
await key(p, 'ArrowDown', 2);
await p.waitForTimeout(650);
check('Further down: More like this', !!(await p.evaluate(() => document.activeElement.closest('.more'))));
await shot(p, '19b-cast-more');
await key(p, 'ArrowUp', 3);
await p.waitForTimeout(650);
check('Back up to the buttons, the page returns to the top', await p.evaluate(() => !!document.activeElement.closest('.dtext') && new DOMMatrix(getComputedStyle(document.querySelector('.dscroll')).transform).m42 === 0));
// A person's page, from the cast: photo, biography, Like, Love and Not for me, known for, photos.
await p.locator('[data-sec="cast"] .pc[aria-label^="Tom Vega"]').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.ppl .ppl-text h1')?.textContent === 'Tom Vega' && document.querySelector('.ppl-known .card'));
await p.waitForTimeout(400);
await shot(p, '19d-person');
const person = await p.evaluate(() => ({ meta: document.querySelector('.ppl .meta').textContent, clip: document.querySelector('.ppl-bio').classList.contains('clip'), known: [...document.querySelectorAll('.ppl-known .card')].map((c) => c.getAttribute('aria-label')), photos: document.querySelectorAll('.ppl-pic').length, focus: document.activeElement.id }));
check('OK on an actor opens their page: photo, job, birth date, age and place', person.meta.includes('Actor') && person.meta.includes('March 14, 1980') && person.meta.includes('Lyon, France') && !!(await p.locator('.ppl-ph img').count()), person.meta);
check('A long biography is cut, with a button for all of it', person.clip && !!(await p.locator('#pbio').count()));
check('Known for: their titles, without talk shows or appearances as themselves', person.known.length === 8 && !person.known.includes('Late Talk') && !person.known.includes('Making Of'), person.known.join());
check('Their photos are listed, and focus starts on Like', person.photos === 3 && person.focus === 'pdy', JSON.stringify(person));
await key(p, 'Enter');
await until(p, () => document.querySelector('#pdy')?.getAttribute('aria-pressed') === 'true');
await p.locator('#pdv').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('#pdv')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#pdy')?.getAttribute('aria-pressed') === 'false');
const fan = await p.evaluate(() => new Promise((ok) => { const r = indexedDB.open('dholphin-v2', 1); r.onsuccess = () => { const st = r.result.transaction('kv').objectStore('kv'); const all = st.getAllKeys(); all.onsuccess = () => { const k = all.result.find((x) => String(x).endsWith(':people')); const g = st.get(k); g.onsuccess = () => ok(g.result); }; }; }));
check('Love on an actor replaces Like, and is kept with their titles', fan?.[9002]?.rating === 'love' && fan[9002].keys.length === 8, JSON.stringify(fan?.[9002] && { ...fan[9002], keys: fan[9002].keys.length }));
await p.locator('.ppl-known .card').first().focus();
const pickName = await p.locator('.ppl-known .card').first().getAttribute('aria-label');
await key(p, 'Enter');
await until(p, () => !document.querySelector('.ppl') && document.querySelector('.dlayer .dtext h1'));
await until(p, (n) => document.querySelector('.dlayer .dtext h1')?.textContent === n, pickName);
check('A title on their page opens its details', true);
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));

// A series: TVmaze's score, and the photo TMDB lacks for an actor, from TVmaze's cast.
await openBySearch(p, 'Vesper Line');
await until(p, () => document.querySelector('[data-sec="grades"] tbody tr') && document.querySelectorAll('[data-sec="cast"] .pc').length >= 2);
const vg = await p.evaluate(() => ({ grades: [...document.querySelectorAll('[data-sec="grades"] tbody tr th')].map((x) => x.textContent), guard: !![...document.querySelectorAll('[data-sec="cast"] .pc')].find((c) => c.querySelector('b').textContent.startsWith('Actor'))?.querySelector('img'), note: [...document.querySelectorAll('.ccred')].map((x) => x.textContent).join(' ') }));
check('A series gets its TVmaze score', vg.grades.includes('TVmaze'), JSON.stringify(vg));
check('An actor TMDB has no photo of gets one from TVmaze, and the source is named', vg.guard && vg.note.includes('More photos from TVmaze'), JSON.stringify(vg));
await p.locator('[data-sec="grades"] tbody tr').last().focus();
await p.waitForTimeout(650);
await shot(p, '19c-ratings');
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));

// A film the server has without a TMDB ID is still found there, by IMDb ID or name and year, and plays from it.
await openBySearch(p, 'Fox Run');
await until(p, () => document.querySelector('.dlayer .btns .f:not([aria-busy])'));
await p.waitForTimeout(300);
check('A Jellyfin film without a TMDB ID still plays from Jellyfin', !!(await p.locator('.dlayer [data-play="jellyfin"]').count()), await p.locator('.dlayer .dtext').innerText());
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));

// Series from Jellyfin: episodes
await openBySearch(p, 'The Long Quiet');
await until(p, () => document.querySelector('.dlayer #de'));
check('A series has an Episodes button, and no episode row at the bottom', !(await p.locator('.dlayer [data-sec="eps"], .dlayer .ep').count()));
const marks = await p.evaluate(() => [...document.querySelectorAll('.dlayer .marks .btn')].map((b) => [b.getAttribute('aria-label'), b.querySelector('.tip')?.textContent, Math.round(b.getBoundingClientRect().width)]));
await until(p, () => document.querySelector('[data-sec="cast"] .pc[aria-label^="Tom Vega"]'));
check('An actor with several roles in a series shows once, the role in the most episodes first', (await p.locator('[data-sec="cast"] .pc[aria-label^="Tom Vega"] .muted').textContent()) === 'The Keeper / Young Keeper' && (await p.locator('[data-sec="cast"] .pc[aria-label^="Tom Vega"]').count()) === 1, await p.locator('[data-sec="cast"] .pc[aria-label^="Tom Vega"] .muted').textContent());
await until(p, () => document.querySelector('.dlayer .match'));
check('The title says how likely you are to like it', /^\d{1,3}% for you$/.test(await p.locator('.dlayer .match').textContent()), await p.locator('.dlayer .match').textContent());
check('My List, the ratings and Already seen are round icons, each named in a tip', marks.length === 5 && marks.every(([l, t, w]) => l && l === t && w === 64), JSON.stringify(marks));
check('The buttons fit on one line', await p.evaluate(() => new Set([...document.querySelectorAll('.dlayer .btns > .btn, .dlayer .marks .btn')].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1));
await p.locator('.dlayer #dy').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.dlayer #dy')?.getAttribute('aria-pressed') === 'true');
check('Like fills its icon', await p.evaluate(() => getComputedStyle(document.querySelector('.dlayer #dy .ic')).fill !== 'none'));
await key(p, 'Enter');
await until(p, () => document.querySelector('.dlayer #dy')?.getAttribute('aria-pressed') === 'false');
// Already seen: into History, pressed; pressed again, taken back.
await p.locator('.dlayer #ds').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.dlayer #ds')?.getAttribute('aria-pressed') === 'true');
const seenEntry = await p.evaluate(() => new Promise((ok) => { const r = indexedDB.open('dholphin-v2', 1); r.onsuccess = () => { const st = r.result.transaction('kv').objectStore('kv'); const all = st.getAllKeys(); all.onsuccess = () => { const k = all.result.find((x) => String(x).endsWith(':history')); const g = st.get(k); g.onsuccess = () => ok((g.result ?? []).find((e) => e.title.name === 'The Long Quiet')); }; }; }));
check('Already seen puts the title in History as seen', seenEntry?.seen === true && seenEntry.progress === 1, JSON.stringify(seenEntry && { seen: seenEntry.seen, progress: seenEntry.progress }));
await key(p, 'Enter');
await until(p, () => document.querySelector('.dlayer #ds')?.getAttribute('aria-pressed') === 'false');
await p.locator('.dlayer #dn').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.dlayer #dn')?.getAttribute('aria-pressed') === 'true');
check('Not for me stays on the page and shows as on', !!(await p.locator('.dlayer').count()));
await key(p, 'Enter');
await until(p, () => document.querySelector('.dlayer #dn')?.getAttribute('aria-pressed') === 'false');
check('Not for me pressed again is taken off', true);
await p.locator('.dlayer #de').focus();
await key(p, 'Enter');
await until(p, () => document.querySelectorAll('.epm .er').length >= 6);
await p.waitForTimeout(300);
await shot(p, '19-episodes');
const em = await p.evaluate(() => ({ seasons: [...document.querySelectorAll('.epm .es b')].map((b) => b.textContent), eps: [...document.querySelectorAll('.epm .er')].map((e) => [e.querySelector('b').textContent, !e.classList.contains('off')]), focus: document.activeElement.className }));
check('The menu lists each season once', em.seasons.join() === 'Season 1,Season 2,Season 3', JSON.stringify(em.seasons));
check('Each episode once: the six Jellyfin plays, and TMDB\'s seventh, not playable', em.eps.length === 7 && em.eps.slice(0, 6).every(([, on]) => on) && !em.eps[6][1], JSON.stringify(em.eps));
check('The menu opens on the first season', em.focus.includes('es'), em.focus);
check('Nothing in the menu runs out of its box', await p.evaluate(() => [...document.querySelectorAll('.epm .es, .epm .eall, .epm .er, .epm-head .btn')].every((e) => e.scrollWidth <= e.clientWidth + 1)));
await key(p, 'ArrowRight');
check('Right goes into the episodes', (await focused(p)).includes('1. Episode 1'));
const ss = await p.evaluate(() => [...document.querySelectorAll('.epm .es .est')].map((x) => x.textContent));
check('Each season says where it stands: how many episodes the server has of how many', ss.length === 3 && ss[0] === '6 of 7 on Jellyfin' && ss.slice(1).every((x) => x && !x.includes('on Jellyfin')), JSON.stringify(ss));
check('A season the server only partly has can be requested', !!(await p.locator('.epm #eask').count()));
// OK on an episode the server lacks asks Seerr for its season: Seerr takes whole seasons.
const lq = await p.evaluate(async () => (await (await fetch('/api/tmdb/3/search/multi?query=The%20Long%20Quiet&api_key=x')).json()).results[0].id);
await p.locator('.epm .er').nth(6).focus();
await key(p, 'Enter');
await p.waitForFunction(async (id) => ((await (await fetch('/api/seerr/api/v1/_test/requests', { headers: { 'X-Api-Key': 'demo-key' } })).json()).find((r) => r.id === id)?.seasons ?? []).includes(1), lq, { timeout: 15000 });
check('OK on a missing episode requests its season from Seerr', true);
check('The request is filed as the profile\'s own Seerr user, found by its Jellyfin account', await p.evaluate(async (id) => ((await (await fetch('/api/seerr/api/v1/_test/requests', { headers: { 'X-Api-Key': 'demo-key' } })).json()).find((r) => r.id === id)?.userId) === 7, lq));
await until(p, () => document.querySelector('.epm .es .est')?.textContent.includes('Requested'));
check('A season asked for says so and is not offered again', !(await p.locator('.epm #eask').count()) && (await p.locator('.epm .es .est').first().textContent()) === '6 of 7 on Jellyfin · Requested');
await shot(p, '19-episodes-requested');
await key(p, 'Escape');
await until(p, () => !document.querySelector('.epm'));
check('Back closes the menu onto the Episodes button', await p.evaluate(() => document.activeElement.id === 'de'));
await key(p, 'Enter');
await until(p, () => document.querySelectorAll('.epm .er').length >= 6);
await key(p, 'ArrowRight');
await key(p, 'Enter');
await until(p, () => document.querySelector('.player video')?.currentTime > 0.3);
check('An episode says which it is', (await p.locator('.player .pe').innerText()).includes('S1:E1'));
await key(p, '7');
await until(p, () => document.querySelector('.pnext'));
await p.waitForTimeout(300);
await shot(p, '19-next-episode');
check('The credits offer the next episode, counting down', (await p.locator('.pnext').innerText()).includes('S1:E2') && /Next episode in \d+/.test(await p.locator('.pnext').innerText()));
check('The next episode is focused, OK plays it', (await focused(p)).includes('Next episode'));
await key(p, 'Enter');
await until(p, () => document.querySelector('.player .pe')?.textContent.includes('S1:E2'));
check('OK plays the next episode in the same player', !(await p.locator('.pnext').count()));
await p.locator('.prow [data-a="episodes"]').click();
await until(p, () => document.querySelectorAll('.ppanel .pepi').length === 6);
check('Episodes lists the season, on the one playing', (await p.locator('.ppanel .pepi[aria-current="true"]').innerText()).includes('2. Episode 2') && (await focused(p)).includes('Episode 2'));
await shot(p, '19-player-episodes');
await key(p, 'ArrowDown');
await key(p, 'Enter');
await until(p, () => document.querySelector('.player .pe')?.textContent.includes('S1:E3'));
check('Choosing an episode plays it', true);
await key(p, 'Escape');
await until(p, () => !document.querySelector('.player'));
check('Back leaves the series player', true);
await key(p, 'Escape');

// Netflix handoff
await until(p, () => !document.querySelector('.dlayer'));
await openBySearch(p, 'Pale Signal');
await until(p, () => document.querySelector('.dlayer [data-play="netflix"]'));
await p.waitForTimeout(300);
await shot(p, '20-details-netflix');
check('Netflix titles show its logo and name', (await p.locator('.dlayer .pvd').innerText()).includes('Netflix'));
await p.locator('[data-play="netflix"]').focus();
await key(p, 'Enter');
await until(p, () => location.pathname.includes('/api/netflix/'));
const nf = new URL(p.url()).pathname;
console.log('      Netflix opened at', nf);
check('Play opens Netflix itself, with an ID found on Wikidata and not by asking Netflix', /\/watch\/8\d+/.test(nf), nf);
await p.waitForFunction(() => document.querySelector('video')?.currentTime > 0.5, null, { timeout: 15000 });
await shot(p, '21-netflix-player');
await key(p, 'Escape');
await until(p, () => document.querySelector('.dlayer'));
check('Back returns from Netflix to the title in Dholphin', (await p.locator('.dlayer h1').textContent()) === 'Pale Signal');
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));
await p.evaluate(() => document.querySelector('[data-go="history"]').click());
await until(p, () => document.querySelector('.lst .li'));
check('Time watched on Netflix lands in History', (await p.locator('.lst').innerText()).includes('Pale Signal'));
await p.locator('.lst .li', { hasText: 'Pale Signal' }).first();

// Search, list, settings
await p.evaluate(() => document.querySelector('[data-go="search"]').click());
await until(p, () => document.querySelector('.kb'));
await p.locator('.kb [data-k="t"]').focus();
for (const c of 'tide') {
  await p.locator(`.kb [data-k="${c}"]`).click();
}
await until(p, () => document.querySelector('#res .card'));
await shot(p, '22-search');
check('Search finds as you type', (await p.locator('#res .card').evaluateAll((l) => l.map((c) => c.getAttribute('aria-label')))).includes('Low Tide'));
// Other scripts: a tab per script. Korean joins jamo into syllables, Japanese marks change the last kana, Chinese picks from pinyin.
const typed = () => p.locator('.srch .nm').textContent();
const tap = async (k) => { await p.locator(`.kb [data-k="${k}"]`).focus(); await key(p, 'Enter'); };
for (let i = 0; i < 4; i++) await tap('del');
check('The search keyboard has a tab per script', (await p.locator('.kbl .kt').count()) === 7);
await p.locator('.kbl [data-l="hangul"]').click();
for (const j of 'ㅎㅏㄴㄱㅜㄱ') await tap(j);
check('Korean letters join into syllables', (await typed()) === '한국', await typed());
for (let i = 0; i < 2; i++) await tap('del');
await p.locator('.kbl [data-l="hiragana"]').click();
for (const j of ['か', '゛', 'つ', '小']) await tap(j);
check('゛ and 小 change the last kana', (await typed()) === 'がっ', await typed());
for (let i = 0; i < 2; i++) await tap('del');
await p.locator('.kbl [data-l="pinyin"]').click();
for (const j of 'zhong') await tap(j);
await until(p, () => document.querySelector('.kbc .kch'));
await shot(p, '22b-search-pinyin');
check('Chinese: the pinyin offers its characters, most used first', (await p.locator('.kbc .kch').first().textContent()) === '中' && (await p.locator('.kbc .kpy').textContent()) === 'zhong');
await p.locator('.kbc .kch').first().focus();
await key(p, 'Enter');
check('Picking a character types it and clears the pinyin', (await typed()) === '中' && await p.locator('.kbc').isHidden(), await typed());
await tap('del');
await p.locator('.kbl [data-l="abc"]').click();
await p.evaluate(() => document.querySelector('[data-go="settings"]').click());
await until(p, () => document.querySelector('#ks'));
await p.waitForTimeout(300);
await shot(p, '23-settings');
check('Settings shows both providers connected', (await p.locator('.prov .muted').allTextContents()).filter((t) => t === 'Connected').length === 2);

// Languages
await p.locator('[data-l="fr-FR"]').click();
await until(p, () => document.querySelector('[data-go="home"] span')?.textContent === 'Accueil');
check('Choosing French translates the menu', (await p.locator('.rail [data-go="categories"] span').textContent()) === 'Catégories');
await p.waitForTimeout(400);
await shot(p, '23b-settings-fr');
check('It translates the page too', (await p.locator('.pg h1').textContent()) === 'Réglages');
// The episodes menu in French: longer words, still in their boxes, plain season and episode names said in French.
await openBySearch(p, 'The Long Quiet');
await until(p, () => document.querySelector('.dlayer #de'));
await p.locator('.dlayer #de').focus();
await key(p, 'Enter');
await until(p, () => document.querySelectorAll('.epm .er').length >= 6 && document.querySelector('.epm #eall'));
await p.waitForTimeout(300);
await shot(p, '23c-episodes-fr');
const fr = await p.evaluate(() => ({ s: document.querySelector('.epm .es b').textContent, e: document.querySelector('.epm .er b').textContent, fit: [...document.querySelectorAll('.epm .es, .epm .eall, .epm .er, .epm-head .btn')].every((e) => e.scrollWidth <= e.clientWidth + 1) }));
check('In French, seasons and episodes are named in French and every label fits', fr.s === 'Saison 1' && fr.e === '1. Épisode 1' && fr.fit, JSON.stringify(fr));
await key(p, 'Escape');
await until(p, () => !document.querySelector('.epm'));
await key(p, 'Escape');
await until(p, () => !document.querySelector('.dlayer'));
await p.evaluate(() => document.querySelector('[data-go="categories"]').click());
await until(p, () => document.querySelector('.cat'));
check('It translates category names', (await p.locator('.cfeat .ctxt b').allTextContents()).includes('Nouveautés'));
check('Categories offer your language first, under For you', (await p.locator('.cgh').first().textContent()) === 'Pour vous' && (await p.locator('.cgrid').first().locator('.cat[data-cat="french"]').count()) === 1);
check('Language categories exist for English, French and others', ['english', 'french', 'german', 'italian', 'spanish'].every((id) => true) && (await p.locator('.cat[data-cat="english"]').count()) === 1);
await p.evaluate(() => document.querySelector('[data-go="home"]').click());
await until(p, () => document.querySelector('.row[data-row="top"] .card'));
check('It translates decade separators', (await p.locator('.row[data-row^="best-2020-"] h2').textContent()).includes('années 2020'));
check('It translates row headings', (await p.locator('.row[data-row="top"] h2').textContent()) === 'Sélection pour vous');
check('Home has a band in your language', (await p.locator('.row[data-row^="lang-french-"] h2').textContent()) === 'Populaires : Français');
await p.reload();
await until(p, () => document.querySelector('[data-go="home"] span'));
check('The choice survives a restart', (await p.locator('[data-go="home"] span').textContent()) === 'Accueil');
await p.evaluate(() => document.querySelector('[data-go="settings"]').click());
await until(p, () => document.querySelector('[data-l="en-US"]'));
await p.locator('[data-l="en-US"]').click();
await until(p, () => document.querySelector('[data-go="home"] span')?.textContent === 'Home');
check('Switching back works', true);

// Back on a fresh start: goes to Home directly, with the taste kept
await p.reload();
await until(p, () => document.querySelector('.hero .hp'));
check('A restart skips setup', true);
await p.evaluate(() => document.querySelector('[data-go="who"]').click());
await until(p, () => document.querySelector('.who'));
await p.waitForTimeout(500);
await shot(p, '24-profiles');
// A famous actor as the profile's picture: the most popular actors, or a search by name.
await p.locator('#mng').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.pf .ed'));
await p.locator('.pf').first().focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('#act'));
await p.locator('#act').focus();
await key(p, 'Enter');
await until(p, () => document.querySelectorAll('.acm .ac:not(.none)').length >= 10);
await p.waitForTimeout(400);
await shot(p, '24b-actors');
const offered = await p.locator('.acm .ac:not(.none) b').allTextContents();
check('The picker offers the most popular actors, with photos only, and no directors', offered.includes('Ava Stone') && !offered.includes('Dana Director') && !offered.includes('Faceless Actor'), offered.slice(0, 8).join());
check('It opens on the first actor, and offers no photo too', (await focused(p)) === 'Ava Stone' && (await p.locator('.acm .ac.none').count()) === 1, await focused(p));
for (const c of 'zoe') { await p.locator(`.acm .kb [data-k="${c}"]`).focus(); await key(p, 'Enter'); }
await until(p, () => [...document.querySelectorAll('.acm .ac b')].every((b) => b.textContent.startsWith('Zoe')) && document.querySelector('.acm .ac'));
check('Typing a name searches TMDB for actors', (await p.locator('.acm .ac b').first().textContent()) === 'Zoe Hart');
await p.locator('.acm .ac').first().focus();
await key(p, 'Enter');
await until(p, () => !document.querySelector('.acm') && document.querySelector('#pa img'));
check('The chosen actor becomes the picture, and the button names them', (await p.locator('#act').textContent()) === 'Photo: Zoe Hart' && (await focused(p)) === 'Photo: Zoe Hart', await p.locator('#act').textContent());
await p.waitForTimeout(300);
await shot(p, '24b-editor-actor');
await p.locator('#sv').focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.pf .av img'));
await p.waitForTimeout(700);
await shot(p, '24c-profile-actor');
check('The profile shows the actor\'s photo', true);
await p.locator('#mng').focus();
await key(p, 'Enter');
await until(p, () => !document.querySelector('.pf .ed'));
await p.locator('.pf').first().focus();
await key(p, 'Enter');
await until(p, () => document.querySelector('.pload .pl-band'));
// Read at once: the loader rightly leaves as soon as Home is ready, which on a busy machine can come quickly.
const loader = await p.evaluate(() => ({ photo: !!document.querySelector('.pload .pl-av img'), name: document.querySelector('.pload .pl-name')?.textContent, turning: ['.pl-band', '.pl-glow', '.pl-wf', '.pl-dol'].every((s) => document.querySelector('.pload ' + s)?.getAnimations().length > 0) }));
check('Loading a profile shows its picture in a turning red ring, with waves and the dolphin leaping, and its name', loader.photo && loader.name === 'Ab' && loader.turning, JSON.stringify(loader));
await shot(p, '24d-profile-loading');
await until(p, () => document.querySelector('.hero .hp') && !document.querySelector('.pload'));
check('Choosing a profile returns to Home', true);
check('The menu shows the profile\'s actor photo', !!(await p.locator('.rail [data-go="who"] .av img').count()));
check('No page errors', errors.length === 0, errors.join('\n'));
await ctx.close();

console.log('Android TV, with a stand-in for the app');
{
  const actx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const calls = [];
  await actx.exposeFunction('__androidCall', (c) => calls.push(c));
  // What the Android app's WebView exposes (android/.../Bridge.kt), answering as a TV with Netflix installed would.
  await actx.addInitScript(() => {
    const call = (m, ...a) => window.__androidCall({ m, a });
    const emit = (detail) => dispatchEvent(new CustomEvent('dholphin', { detail }));
    window.DholphinAndroid = {
      version: () => '0.8.1+22', build: () => '22', installed: () => 'yes',
      openApp: (url, pk, ex) => (call('openApp', url, pk, ex), 'ok'),
      phoneStart: (title, f) => (call('phoneStart', title, f), JSON.stringify({ url: 'http://192.168.1.50:41234/p/abc', qr: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 2%22%3E%3Crect width=%221%22 height=%221%22/%3E%3C/svg%3E' })),
      phoneStop: () => call('phoneStop'),
      localAddresses: () => '["192.168.77.2"]',
      installUpdate: (url) => { call('installUpdate', url); setTimeout(() => { emit({ t: 'update', pct: 50 }); emit({ t: 'update', result: 'started' }); }, 100); },
      exit: () => call('exit'),
    };
  });
  // The home network as the TV sees it: one Dholphin server at 192.168.77.10:8080, nothing else answers.
  await actx.route(/^http:\/\/192\.168\.77\.\d+(:\d+)?\/api\/status$/, (r) => (r.request().url() === 'http://192.168.77.10:8080/api/status' ? r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ app: 'dholphin', version: '9.9.9' }) }) : r.abort()));
  const a = await actx.newPage();
  watch(a);
  await a.goto(URL_);
  await until(a, () => document.querySelector('.modal.upd'));
  await a.waitForTimeout(300);
  await shot(a, '30-android-update');
  check('A newer published version is offered', (await a.locator('.modal.upd h2').textContent()).includes('0.9.0') && (await a.locator('.unotes').textContent()).includes('Trailers'));
  await key(a, 'Enter');
  await until(a, () => /confirm/.test(document.querySelector('.modal.upd .err')?.textContent ?? ''));
  check('Update now downloads it and hands it to Android', calls.some((c) => c.m === 'installUpdate' && c.a[0] === '/api/dholphin.apk'));
  await key(a, 'Escape');
  await until(a, () => !document.querySelector('.modal.upd'));
  await until(a, () => document.activeElement?.id === 'nx');
  await key(a, 'Enter');
  await until(a, () => document.querySelector('[data-srv]') && document.querySelector('#scan b')?.textContent === 'Search done', null);
  await shot(a, '30b-android-find-server');
  check('On first run the TV looks for Dholphin servers on its network and lists what it finds', (await a.locator('[data-srv]').count()) === 1 && (await a.locator('[data-srv]').getAttribute('data-srv')) === 'http://192.168.77.10:8080' && (await a.locator('#found').innerText()).includes('192.168.77.10:8080 · 9.9.9'));
  check('A server found is focused first', await a.evaluate(() => document.activeElement?.dataset.srv === 'http://192.168.77.10:8080'));
  await a.locator('[data-srv]').click();
  await until(a, () => document.querySelector('#fld-origin'));
  check('Choosing it fills its address and asks only for the code', (await a.locator('#fld-origin').inputValue()) === 'http://192.168.77.10:8080' && (await a.evaluate(() => document.activeElement?.id)) === 'fld-code');
  await a.locator('#lcn').click();
  await a.locator('#malone').click();
  await until(a, () => document.querySelector('.phone .qrbox img'));
  await a.waitForTimeout(300);
  await shot(a, '31-android-keys-qr');
  const ps = calls.findLast((c) => c.m === 'phoneStart');
  check('The key step shows a QR code for typing on a phone', !!ps && JSON.parse(ps.a[1]).map((f) => f.key).join() === 'tmdb,omdb,trakt,google' && (await a.locator('.purl').textContent()).startsWith('http://192.168'));
  await a.evaluate(() => dispatchEvent(new CustomEvent('dholphin', { detail: { t: 'phone', values: { tmdb: 'good-key', omdb: 'x' } } })));
  await until(a, () => document.querySelector('.nm'));
  check('Keys typed on the phone are checked and saved, and setup goes on', calls.some((c) => c.m === 'phoneStop'));
  await key(a, 'Enter');
  await press(a, 'Continue');
  await until(a, () => document.querySelector('[data-c="netflix"]'));
  await a.waitForTimeout(400);
  check('Netflix is turned on, not signed in to', (await a.locator('[data-c="netflix"]').textContent()) === 'Turn on' && (await a.locator('.prov[data-p="netflix"] .muted').textContent()).includes('Netflix app'));
  await a.locator('[data-c="netflix"]').click();
  await until(a, () => document.querySelector('[data-c="netflix"]')?.textContent === 'Turn off');
  await shot(a, '32-android-services');
  check('Turning it on needs nothing else', (await a.locator('.prov[data-p="netflix"] .st').textContent()).includes('On'));
  await press(a, 'Continue');
  await until(a, () => document.querySelectorAll('.taste .tc[data-t]').length === 18);
  await a.locator('.tc[data-t]').first().focus();
  for (let i = 0; i < 3; i++) {
    await key(a, 'Enter');
    await key(a, 'ArrowRight');
  }
  await press(a, 'Continue');
  await until(a, () => document.querySelector('[data-g="language"]'));
  await press(a, 'Finish');
  await until(a, () => document.querySelector('.hero .hp'));
  await openBySearch(a, 'Pale Signal');
  await until(a, () => document.querySelector('.dlayer [data-play="netflix"]'));
  await a.locator('[data-play="netflix"]').focus();
  await key(a, 'Enter');
  for (let i = 0; i < 50 && !calls.some((c) => c.m === 'openApp'); i++) await a.waitForTimeout(100);
  const open = calls.find((c) => c.m === 'openApp');
  console.log('      Netflix app asked to open', open.a[0], open.a[1], open.a[2]);
  check('Play hands the title to the Netflix app, with source=30', /\/watch\/8\d+\?source=30$/.test(open.a[0]) && JSON.parse(open.a[1])[0] === 'com.netflix.ninja' && JSON.parse(open.a[2]).source === '30', open.a.join(' '));
  check('The page stays where it was, behind the Netflix app', (await a.locator('.dlayer h1').textContent()) === 'Pale Signal');
  await key(a, 'Escape');
  await until(a, () => !document.querySelector('.dlayer'));
  await a.evaluate(() => document.querySelector('[data-go="history"]').click());
  await until(a, () => document.querySelector('.lst .li'));
  check('Opening it in Netflix counts as watched', (await a.locator('.lst').innerText()).includes('Pale Signal'));
  // Setting up from the phone, from the bottom of Who's watching: keys, shared servers, each profile, a new one.
  await a.evaluate(() => document.querySelector('[data-go="who"]').click());
  await until(a, () => document.querySelector('.who .setupqr .qrbox img'));
  await a.waitForTimeout(400);
  await shot(a, '33-android-setup-qr');
  const sp = [...calls].reverse().find((c) => c.m === 'phoneStart');
  const sf = JSON.parse(sp.a[1]);
  check('Who\'s watching offers setting up from the phone: keys, shared servers, each profile and a new one', ['key.tmdb', 'jellyfin.server', 'jellyfin.seerrUrl', 'p.new.name', 'p.new.jellyfin.user'].every((k) => sf.some((f) => f.key === k)) && sf.some((f) => /^p\.\w+\.name$/.test(f.key)) && sf.some((f) => f.section) && !sf.some((f) => f.key === 'key.tmdb' && f.placeholder && f.placeholder.includes('good-key')), JSON.stringify(sf.map((f) => f.key)));
  const own = sf.find((f) => /^p\.\w+\.name$/.test(f.key) && !f.key.startsWith('p.new')).key;
  await a.evaluate(([own]) => dispatchEvent(new CustomEvent('dholphin', { detail: { t: 'phone', values: { [own]: 'Abby', 'jellyfin.server': location.origin + '/api/jf', 'p.new.name': 'kim', 'p.new.jellyfin.user': 'kim', 'p.new.jellyfin.password': 'pw' } } })), [own]);
  await until(a, () => document.querySelector('.modal .lines li'));
  const lines = await a.locator('.modal .lines li').allTextContents();
  await shot(a, '34-android-setup-done');
  check('What the phone sent is applied and reported: a renamed profile, a new one signed in to Jellyfin', lines.some((l) => l.includes('Abby')) && lines.some((l) => l === 'Kim: connected to Jellyfin') && lines.some((l) => l === 'Jellyfin: saved for every profile'), lines.join(' | '));
  await key(a, 'Enter');
  await until(a, () => !document.querySelector('.modal'));
  const names = await a.locator('.pf .n').allTextContents();
  check('Who\'s watching shows the changes, and the code stays for the next change', names.some((n) => n.startsWith('Abby')) && names.some((n) => n.startsWith('Kim')) && !!(await a.locator('.who .setupqr').count()), names.join());
  const before = calls.length;
  await a.locator('.pf').first().focus();
  await key(a, 'Enter');
  await until(a, () => document.querySelector('.hero .hp') && !document.querySelector('.pload'));
  check('Choosing a profile stops serving the setup page', calls.slice(before).some((c) => c.m === 'phoneStop'));
  await a.locator('.hero .hp').focus();
  // Back opens the menu, then asks once more before leaving, as on CoolDash OS.
  for (let i = 0; i < 6 && !calls.some((c) => c.m === 'exit'); i++) {
    await key(a, 'Escape');
    await a.waitForTimeout(250);
  }
  check('Back from Home, confirmed, closes the app', calls.some((c) => c.m === 'exit'));
  check('No page errors on Android', errors.length === 0, errors.join('\n'));
  await actx.close();
}

console.log('Dholphin server');
{
  // The real server, its film data services pointed at the stand-ins, in a fresh data folder.
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const D = 'http://127.0.0.1:8799', S = 'http://127.0.0.1:8800';
  const endpoints = { wikidata: `${D}/api/wikidata`, commons: `${D}/api/commons`, wikipedia: `${D}/api/wikipedia/{lang}`, doblaje: `${D}/api/doblaje`, anilist: `${D}/api/anilist`, jikan: `${D}/api/jikan`, tvmaze: `${D}/api/tvmaze`, netflix: `${D}/api/netflix`, youtube: `${D}/api/yt`, releases: `${D}/api/releases` };
  const srv = spawn(process.execPath, [join(ROOT, 'server/main.mjs')], { env: { ...process.env, NODE_ENV: 'production', PORT: '8800', DATA: mkdtempSync('/tmp/dh-srv-'), DIST: join(ROOT, 'web/dist'), UPSTREAM_TMDB: `${D}/api/tmdb/3`, UPSTREAM_OMDB: `${D}/api/omdb`, UPSTREAM_IMAGES: `${D}/api/img`, APP_ENDPOINTS: JSON.stringify(endpoints) } });
  let log = '';
  srv.stdout.on('data', (c) => (log += c));
  srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/on port 8800/.test(log); i++) await new Promise((ok) => setTimeout(ok, 100));
  const setupCode = /setup code: (\w+)/.exec(log)?.[1];
  check('A fresh server prints a one-time setup code in its log', !!setupCode, log);

  // The panel: the password, with the code from the log, then the TMDB key.
  const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pp = await pctx.newPage();
  await pp.goto(`${S}/panel`);
  await until(pp, () => document.querySelectorAll('input').length === 2);
  await pp.locator('input').nth(0).fill(setupCode);
  await pp.locator('input').nth(1).fill('household-pass');
  await pp.getByRole('button', { name: 'Set the password' }).click();
  await until(pp, () => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Film data keys'));
  await pp.getByLabel('TMDB key (needed)').fill('good-key');
  await pp.getByRole('button', { name: 'Save keys' }).click();
  await until(pp, () => document.querySelector('input[placeholder^="Set."]'));
  await pp.screenshot({ path: join(OUT, '40-server-panel.png'), fullPage: true });
  check('The panel sets the household password with the setup code, then keeps the key without showing it', (await pp.getByLabel('TMDB key (needed)').inputValue()) === '' && (await pp.getByLabel('TMDB key (needed)').getAttribute('placeholder')).startsWith('Set.'));

  // A TV links with a code before any profile exists: it shows the panel's address to set the server up.
  await pp.getByRole('button', { name: 'Link a TV' }).click();
  await until(pp, () => document.querySelector('.code'));
  const pairCode = await pp.locator('.code').textContent();
  const tctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tctx.newPage();
  watch(tv);
  await tv.goto(URL_);
  await until(tv, () => document.activeElement?.id === 'nx');
  await key(tv, 'Enter');
  await until(tv, () => document.querySelector('#maddr'));
  check('A TV on its own asks, at the start, whether it runs with a Dholphin server', (await tv.locator('#maddr').textContent()).includes('Enter the address'));
  await tv.locator('#maddr').click();
  await until(tv, () => document.querySelector('#fld-origin'));
  await tv.fill('#fld-origin', '127.0.0.1:8800');
  await tv.fill('#fld-code', pairCode);
  await tv.locator('#lgo').click();
  await tv.waitForURL(() => true);
  await until(tv, () => document.querySelector('h1')?.textContent === 'Set up this server');
  await tv.waitForTimeout(300);
  await shot(tv, '41-server-setup-wait');
  check('Linked to a server without a profile, the TV shows its panel\'s address', (await tv.locator('.purl').textContent()) === `${S}/panel`, await tv.locator('.purl').textContent());

  // The web app on a server without profiles: set up here, or leave it to a TV with a code.
  {
    const c = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const w = await c.newPage();
    watch(w);
    await w.goto(`${S}/`);
    await until(w, () => document.querySelector('#pw'));
    await w.fill('#pw', 'household-pass');
    await w.locator('#go').click();
    await until(w, () => document.querySelector('#ontv'));
    await w.locator('#ontv').click();
    await until(w, () => /^\d{6}$/.test(document.querySelector('.tvc')?.textContent ?? ''));
    await w.screenshot({ path: join(OUT, '41b-server-web-set-up-on-tv.png') });
    check('The web app can leave the setup to a TV: it shows the address and a code to link it', (await w.locator('.purl').textContent()) === S);
    await c.close();
  }

  // The panel adds a profile: the TV moves on by itself, and loads Home through the server.
  await pp.getByLabel('New profile name').fill('Sam');
  await pp.getByRole('button', { name: 'Add a profile' }).click();
  await until(pp, () => [...document.querySelectorAll('b')].some((b) => b.textContent === 'Sam'));
  await tv.waitForFunction(() => document.querySelector('.hero .hp') && !document.querySelector('.pload'), null, { timeout: 30000 });
  await shot(tv, '42-server-tv-home');
  check('Once the panel adds a profile, the TV goes on to Home, with titles through the server', (await tv.locator('.row:not([hidden]) .card').count()) > 5);

  // The web app on the server: the household password, then the same profile; a change goes to the server.
  const wctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const web = await wctx.newPage();
  watch(web);
  await web.goto(`${S}/`);
  await until(web, () => document.querySelector('#pw'));
  await web.fill('#pw', 'household-pass');
  await web.locator('#go').click();
  await web.waitForFunction(() => document.querySelector('.hero .hp') && !document.querySelector('.pload'), null, { timeout: 30000 });
  check('The web app signs in with the household password and opens on the server\'s profile', true);
  await web.locator('.hero .hl').click();
  await web.waitForTimeout(1500);
  const lists = await pp.evaluate(async () => Object.entries(await (await fetch('/api/store?prefix=p:')).json()).filter(([k, v]) => k.endsWith(':list') && v.length).length);
  check('My List changed in the web app is kept on the server', lists === 1, String(lists));
  await web.evaluate(() => document.querySelector('[data-go="settings"]').click());
  await until(web, () => document.querySelector('#srvp'));
  check('With the web app, the server panel is in Settings', (await web.locator('#srvp').textContent()) === 'Server panel');
  await web.screenshot({ path: join(OUT, '43-server-web-settings.png') });

  // Jellyfin at a local address, relayed by the server: Sam signs in from the panel, and the linked TV is connected as Sam.
  const sam = await pp.evaluate(async (jf) => {
    const st = await (await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jellyfin: jf, relay: 'auto' }) })).json();
    const id = st.profiles.find((x) => x.name === 'Sam').id;
    const r = await fetch('/api/admin/jellyfin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: id, user: 'sam', password: 'pw' }) });
    return r.status;
  }, `${D}/api/jf`);
  check('The panel signs Sam in to Jellyfin', sam === 200, String(sam));
  await tv.reload();
  await tv.waitForFunction(() => document.querySelector('.hero .hp') && !document.querySelector('.pload'), null, { timeout: 30000 });
  await tv.evaluate(() => document.querySelector('[data-go="settings"]').click());
  await until(tv, () => document.querySelector('.prov [data-p="jellyfin"]'));
  const jfRow = await tv.locator('.prov', { has: tv.locator('[data-p="jellyfin"]') }).innerText();
  check('On a linked TV, Jellyfin through the relay keeps its own sign-in: Sam is connected', jfRow.includes('Connected') && !jfRow.includes('Not connected'), jfRow);
  srv.kill();
  await Promise.all([pctx.close(), tctx.close(), wctx.close()]);
}

console.log('Screen position');
for (const [width, height] of [[1280, 900], [2560, 1080], [800, 1200]]) {
  const c = await browser.newContext({ viewport: { width, height } });
  const q = await c.newPage();
  await q.goto(URL_);
  await until(q, () => document.querySelector('#tv').children.length);
  const r = await q.evaluate(() => { const b = document.querySelector('#tv').getBoundingClientRect(); return { l: b.left, t: b.top, r: innerWidth - b.right, b: innerHeight - b.bottom }; });
  check(`Centred and inside a ${width}x${height} window`, Math.abs(r.l - r.r) < 2 && Math.abs(r.t - r.b) < 2 && r.l >= -1 && r.t >= -1, JSON.stringify(r));
  await c.close();
}

{
  // A 4K Android TV's WebView: a dense screen, so a narrow window in CSS pixels. The screen fits it, no zoom.
  const c = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 4, isMobile: true });
  const q = await c.newPage();
  await q.goto(URL_);
  await until(q, () => document.querySelector('.onb .lead'));
  await q.waitForTimeout(800);
  const r = await q.evaluate(() => { const b = document.querySelector('#tv').getBoundingClientRect(); return { w: innerWidth, l: b.left, t: b.top, r: innerWidth - b.right, b: innerHeight - b.bottom }; });
  check('On a dense 4K screen the app fits the screen instead of zooming past its edges', r.w === 960 && Math.abs(r.l) < 2 && Math.abs(r.r) < 2 && Math.abs(r.t) < 2 && Math.abs(r.b) < 2, JSON.stringify(r));
  await c.close();
}

console.log('Reduced motion');
const rc = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
const rp = await rc.newPage();
await rp.goto(URL_);
await until(rp, () => document.querySelector('.onb'));
check('Reduced motion runs', true);
await rc.close();
await browser.close();

console.log('Extension, as on CoolDash OS');
const extDir = join(OUT, 'ext');
cpSync(join(ROOT, 'dist/ext'), extDir, { recursive: true });
writeFileSync(join(extDir, 'config.json'), JSON.stringify({ endpoints: { tmdb: `${LOCAL}api/tmdb/3`, images: `${LOCAL}api/img`, omdb: `${LOCAL}api/omdb`, wikidata: `${LOCAL}api/wikidata` }, keys: { tmdb: 'k', omdb: 'k' } }));
const ectx = await chromium.launchPersistentContext(join(OUT, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1280, height: 720 }, args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`] });
await ectx.route('https://www.netflix.com/**', (route) => {
  const u = new URL(route.request().url());
  route.fulfill({ contentType: 'text/html', headers: u.pathname.endsWith('/login') ? { 'Set-Cookie': 'NetflixId=abc; Domain=.netflix.com; Path=/; Secure' } : {}, body: `<!doctype html><title>Netflix stand-in</title><h1 id="page">${u.pathname}</h1><video src="${LOCAL}api/media/test.webm" autoplay muted></video>` });
});
let sw = ectx.serviceWorkers()[0] ?? (await ectx.waitForEvent('serviceworker', { timeout: 15000 }));
const id = new URL(sw.url()).host;
const fixed = (await import('node:fs')).readFileSync(join(ROOT, 'hosts/cooldash/ext/ID'), 'utf8').trim();
check('The extension loads, with its fixed ID', id === fixed, `${id} vs ${fixed}`);
const ep = await ectx.newPage();
const extErrors = [];
ep.on('pageerror', (e) => extErrors.push(e.message));
await ep.goto(`chrome-extension://${id}/index.html`);
await until(ep, () => document.querySelector('.onb'));
check('The interface runs as an extension page, with the Rust core', await ep.evaluate(async () => (await WebAssembly.instantiateStreaming(fetch('./dholphin_core.wasm'), {})).instance.exports.dh_call !== undefined));
await ep.evaluate(async () => {
  await chrome.storage.local.set({ external: { intent: 'play', meta: {} } });
  location.href = 'https://www.netflix.com/watch/123';
});
await ep.waitForSelector('#page', { timeout: 15000 });
check('It can go to Netflix', (await ep.locator('#page').textContent()) === '/watch/123');
await ep.waitForTimeout(500);
await ep.keyboard.press('Escape');
await ep.waitForURL(/index\.html#?/, { timeout: 15000 });
check('Back on Netflix returns to the extension', ep.url().includes(id));
await until(ep, () => document.querySelector('#tv').children.length > 0);
await ep.evaluate(async () => {
  await chrome.storage.local.set({ external: { intent: 'login' } });
  location.href = 'https://www.netflix.com/fr-en/login';
});
await ep.waitForSelector('#page', { timeout: 15000 });
const cookie = await ep.context().cookies('https://www.netflix.com');
check('Netflix keeps its own cookie', cookie.some((c) => c.name === 'NetflixId'));
await ep.goto('https://www.netflix.com/browse');
await ep.waitForURL(/index\.html/, { timeout: 15000 });
check('Signing in returns by itself', ep.url().includes(id));
await until(ep, () => document.querySelector('#tv').children.length > 0);
const seen = await ep.evaluate(async () => (await chrome.cookies.get({ url: 'https://www.netflix.com', name: 'NetflixId' }))?.value ?? null);
check('The app can tell it is signed in', seen === 'abc', String(seen));
const blocked = await ep.evaluate(async () => {
  const t = (await chrome.tabs.getCurrent()).id;
  return t;
});
void blocked;
const other = await ectx.newPage();
const res = await other.goto('https://example.com/', { timeout: 15000 }).then(() => 'loaded', (e) => e.message);
check('Other websites are blocked at the top level', /ERR_BLOCKED/.test(res), res);
check('No extension page errors', extErrors.length === 0, extErrors.join('\n'));
await ectx.close();
server.close();
console.log(`\n${passed} checks passed. Screenshots in ${OUT}`);
