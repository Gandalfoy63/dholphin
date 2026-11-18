// Docs: docs/02 - Tech/Testing.md
// Purpose: drives the app by touch on a phone and a tablet, upright and sideways: layout, menu, scrolling, every page.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createDoubles } from '../doubles/server.mjs';

const OUT = process.env.OUT ?? '/tmp/dholphin-e2e';
mkdirSync(OUT, { recursive: true });
const server = createDoubles();
await new Promise((r) => server.listen(8798, '127.0.0.1', r));
const URL_ = 'http://dholphin.test:8798/';
let passed = 0;
const check = (name, ok, more = '') => {
  assert.ok(ok, `${name} ${more}`);
  passed++;
  console.log(`  ok  ${name}`);
};
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP dholphin.test 127.0.0.1'] });
const errors = [];
const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 15000 });
const shot = (p, n) => p.screenshot({ path: join(OUT, `touch-${n}.png`) });
const tap = (p, sel) => p.locator(sel).first().tap();

/** What a finger needs: the page fits the screen, nothing pokes out sideways, controls are big enough to tap. */
const fit = (p) => p.evaluate(() => {
  const tv = document.querySelector('#tv').getBoundingClientRect(), ct = document.querySelector('#ct');
  // Inside something that scrolls sideways or clips (a card's shine, a row), it can't stick out of the screen.
  const scrollsX = (el) => { for (let n = el.parentElement; n && n.id !== 'ct'; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.overflowX !== 'visible' || /paint|strict|content/.test(cs.contain)) return true; } return false; };
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'); };
  // Controls a finger presses: 44 CSS px is the usual least (the Library's letters are a strip slid along, not tapped one by one).
  const small = [...document.querySelectorAll('#tv :is(.btn,.chip,.ni,.lopt,.xbtn,.lsel)')].filter(shown).map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.height < 43.5 || r.width < 43.5).map(([el, r]) => `${el.className.split(' ').slice(0, 3).join('.')}:${el.textContent.trim().slice(0, 16)}:${Math.round(r.width)}x${Math.round(r.height)}`);
  // Anything sticking out of the screen.
  const out = [...(ct ?? document).querySelectorAll('*')].filter((el) => shown(el) && !scrollsX(el)).filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map((el) => `${el.tagName}.${String(el.className).split(' ')[0]}`).slice(0, 6);
  return { full: Math.abs(tv.width - innerWidth) < 1 && Math.abs(tv.height - innerHeight) < 1, pageX: document.scrollingElement.scrollWidth <= innerWidth, ctX: !ct || ct.scrollWidth <= ct.clientWidth + 1, out, small };
});
const fits = async (p, where) => {
  const f = await fit(p);
  check(`${where}: fills the screen, nothing sticks out sideways`, f.full && f.pageX && f.ctX && !f.out.length, JSON.stringify(f));
  check(`${where}: every button is at least 44 px to tap`, !f.small.length, JSON.stringify(f.small));
};
const page = async (p, id) => {
  await p.evaluate((x) => document.querySelector(`.ni[data-go="${x}"]`).click(), id);
  await p.waitForTimeout(700);
};

/** Setup by taps. `look`: also check each step's layout and keep a picture of it (`name`). */
async function setUp(p, look = false) {
  const step = async (name) => {
    if (!look) return;
    await p.waitForTimeout(450);
    await shot(p, `00-setup-${name}`);
    await fits(p, `Setup, ${name}`);
  };
  await p.goto(URL_);
  await until(p, () => document.querySelector('.onb #nx'));
  await step('welcome');
  await tap(p, '#nx');
  await until(p, () => document.querySelector('#malone'));
  await step('where');
  await tap(p, '#malone');
  await until(p, () => document.querySelector('#fld-tmdb'));
  await step('keys');
  await p.fill('#fld-tmdb', 'good-key');
  await tap(p, '#nx');
  await until(p, () => document.querySelector('input.line'));
  await step('profile');
  await p.fill('input.line', 'Touch');
  await tap(p, '#nx');
  await until(p, () => document.querySelector('[data-c="jellyfin"]'));
  await step('services');
  // Jellyfin, so the Library has a catalogue to scroll. Its form is a sheet on a touch screen.
  await tap(p, '[data-c="jellyfin"]');
  await until(p, () => document.querySelector('#fld-server'));
  await p.fill('#fld-server', `${URL_}api/jf`);
  await p.fill('#fld-user', 'tester');
  // Seerr too, so Requests is there.
  await p.fill('#fld-seerrUrl', `${URL_}api/seerr`);
  await p.fill('#fld-seerrKey', 'demo-key');
  await step('jellyfin-form');
  await tap(p, '#cg');
  await until(p, () => !document.querySelector('.modal') && document.querySelector('.prov[data-p="jellyfin"] .st')?.textContent.includes('Connected'));
  await tap(p, '#nx');
  await until(p, () => document.querySelectorAll('.taste .tc[data-t]').length === 18);
  await step('taste');
  for (let i = 0; i < 3; i++) await p.locator('.tc[data-t]').nth(i).tap();
  await tap(p, '#nx');
  await until(p, () => document.querySelector('[data-g="language"]'));
  await step('preferences');
  await tap(p, '#nx');
  await until(p, () => document.querySelector('.hero .hp'));
  await until(p, () => document.querySelectorAll('.row:not([hidden]) .card').length > 10);
  await p.waitForTimeout(600);
}

console.log('Phone, upright');
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await phone.newPage();
p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
await setUp(p, true);
await shot(p, '01-phone-home');
const form = await p.evaluate(() => ({ form: document.querySelector('#tv').dataset.form, nav: document.querySelector('#tv').dataset.nav }));
check('A phone gets the touch layout, its menu as a bar at the bottom', form.form === 'phone' && form.nav === 'bar', JSON.stringify(form));
{
  const bar = await p.evaluate(() => [...document.querySelectorAll('.rail .ni')].filter((b) => b.offsetHeight).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), bottom: Math.round(innerHeight - r.bottom), h: Math.round(r.height) }; }));
  check('The bar shows Home, Search, Library, My List and More, in that order, each with its name', bar.map((b) => b.t).join() === 'Home,Search,Library,My List,More', JSON.stringify(bar));
  check('The bar sits at the bottom of the screen', bar.every((b) => b.bottom >= 0 && b.bottom < 4), JSON.stringify(bar));
  check('Home is marked in the bar', await p.evaluate(() => document.querySelector('.ni.cur')?.dataset.go === 'home'));
}
{
  const r = await p.evaluate(() => {
    const h2 = document.querySelector('.row:not([hidden]) h2'), body = document.querySelector('.htext p');
    const px = (el) => parseFloat(getComputedStyle(el).fontSize) * (document.querySelector('#tv').getBoundingClientRect().width / document.querySelector('#tv').offsetWidth);
    return { h2: px(h2), body: px(body) };
  });
  check('Text reads at a phone\'s size: row titles 16 px and up, body text 13 px and up', r.h2 >= 16 && r.body >= 13, JSON.stringify(r));
}
{
  const s = await p.evaluate(async () => {
    const ct = document.querySelector('#ct'), track = [...document.querySelectorAll('.row:not([hidden]):not(.sects) .track')].find((t) => t.scrollWidth > t.clientWidth);
    ct.scrollTop = 600;
    track.scrollLeft = 300;
    await new Promise((r) => setTimeout(r, 100));
    return { page: ct.scrollTop, row: track.scrollLeft, snap: getComputedStyle(track).scrollSnapType, moved: document.querySelector('.scroller').style.transform };
  });
  check('Home scrolls natively, its rows sideways, snapping to cards', s.page > 500 && s.row > 200 && s.snap.startsWith('x') && !s.moved, JSON.stringify(s));
  await p.evaluate(() => (document.querySelector('#ct').scrollTop = 0));
  // Cards far along a row load their pictures as they are swiped into view (on a TV, focus wakes them).
  const far = await p.evaluate(async () => {
    const track = [...document.querySelectorAll('.row:not([hidden]):not(.sects) .track')].find((t) => t.querySelectorAll('img.art').length > 8);
    track.scrollLeft = track.scrollWidth;
    await new Promise((r) => setTimeout(r, 1500));
    const last = [...track.querySelectorAll('img.art')].at(-1);
    return { loaded: last.complete && last.naturalWidth > 0, loading: last.loading };
  });
  check('Pictures far along a row load when it is swiped there', far.loaded, JSON.stringify(far));
}
await fits(p, 'Home');
check('No trailer plays from a tap', !(await p.locator('.pv').count()));

// A title: tapped, it opens; it scrolls; Close closes it.
await p.locator('.row:not([hidden]):not(.sects) .card').first().tap();
await until(p, () => document.querySelector('.dlayer [data-play], .dlayer #dq, .dlayer .dnone'));
await p.waitForTimeout(500);
await shot(p, '02-phone-details');
{
  const d = await p.evaluate(() => {
    const L = document.querySelector('.dlayer'), x = document.querySelector('.dlayer .xbtn').getBoundingClientRect(), tips = [...document.querySelectorAll('.dlayer .marks .tip')];
    return { scrolls: getComputedStyle(L).overflowY, close: x.width >= 44 && x.height >= 44 && x.top >= 0 && x.right <= innerWidth, names: tips.length > 0 && tips.every((t) => getComputedStyle(t).opacity === '1' && t.getBoundingClientRect().height > 0) };
  });
  check('Title Details scrolls natively, with a Close button at the top right', d.scrolls === 'auto' && d.close, JSON.stringify(d));
  check('My List, Like, Love, Not for me and Seen show their names under their icons', d.names, JSON.stringify(d));
}
await fits(p, 'Title Details');
await tap(p, '.dlayer .xbtn');
await p.waitForTimeout(500);
check('Close closes Title Details', !(await p.locator('.dlayer').count()));

// More: a sheet with the rest of the menu.
await tap(p, '.ni[data-go="more"]');
await until(p, () => document.querySelector('.modal.sheet .lopt'));
await p.waitForTimeout(300);
await shot(p, '03-phone-more');
{
  const items = await p.locator('.sheet .lopt').allTextContents();
  check('More holds Categories, History, Requests (Seerr is connected), Settings and the profile', ['Categories', 'History', 'Requests', 'Settings', 'Touch'].every((x) => items.some((i) => i.includes(x))), JSON.stringify(items));
  const sheet = await p.evaluate(() => Math.round(innerHeight - document.querySelector('.sheet .panel').getBoundingClientRect().bottom));
  check('The sheet rises from the bottom of the screen', sheet === 0, String(sheet));
}
await fits(p, 'More');
await p.locator('.sheet .lopt', { hasText: 'Categories' }).tap();
await until(p, () => document.querySelector('.cat'));
await p.waitForTimeout(500);
check('More opens Categories, and marks More as where you are', await p.evaluate(() => !document.querySelector('.modal') && document.querySelector('.ni.cur:not(.nx)')?.dataset.go === 'more'));
await shot(p, '04-phone-categories');
await fits(p, 'Categories');

for (const [id, name, ready] of [['requests', 'Requests', '.rqgroups, .pg .empty'], ['search', 'Search', '.srch input.line'], ['library', 'Library', '.lvirt .card, .lstate .empty'], ['list', 'My List', '.pg h1'], ['history', 'History', '.pg h1'], ['settings', 'Settings', '.prov']]) {
  await page(p, id);
  await until(p, (s) => document.querySelector(s), ready);
  await p.waitForTimeout(400);
  await shot(p, `05-phone-${id}`);
  await fits(p, name);
}
// The Library's letters stay at the edge while the list scrolls, and a tap on one jumps there.
await page(p, 'library');
await until(p, () => document.querySelector('.lvirt .card'));
{
  const l = await p.evaluate(async () => {
    const ct = document.querySelector('#ct'), letters = document.querySelector('.letters');
    const before = letters.getBoundingClientRect().top;
    ct.scrollTop = 400;
    await new Promise((r) => setTimeout(r, 120));
    const after = letters.getBoundingClientRect().top;
    ct.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 120));
    const b = [...document.querySelectorAll('.lt1')].filter((x) => !x.disabled).pop();
    b.click();
    await new Promise((r) => setTimeout(r, 160));
    // The list goes to the letter as far as it can (ten titles barely scroll), and the letter is marked.
    return { shown: !letters.hidden, still: Math.abs(before - after) < 1, jumped: b.classList.contains('cur') && (ct.scrollTop > 0 || ct.scrollHeight <= ct.clientHeight), clear: letters.getBoundingClientRect().top >= document.querySelector('.lbar').getBoundingClientRect().bottom - 1, cards: document.querySelectorAll('.lvirt .card').length };
  });
  check('The Library scrolls natively, its letters stay put below the filters, and a letter jumps the list', l.shown && l.still && l.jumped && l.clear && l.cards > 0, JSON.stringify(l));
}

// The player by touch: tap for the controls, two taps on a side to skip, drag the bar, Close.
console.log('Player by touch');
await page(p, 'search');
await until(p, () => document.querySelector('.srch input.line'));
await p.locator('.srch input.line').fill('black orchard');
await until(p, () => document.querySelector('#res .card[aria-label="Black Orchard"]'));
await p.locator('#res .card[aria-label="Black Orchard"]').tap();
await until(p, () => document.querySelector('.dlayer [data-play="jellyfin"]'));
await p.waitForTimeout(400);
await tap(p, '.dlayer [data-play="jellyfin"]');
await until(p, () => document.querySelector('.player video')?.currentTime > 0.5);
const vt = () => p.evaluate(() => document.querySelector('.player video').currentTime);
{
  const c = await p.evaluate(() => {
    const L = document.querySelector('.player'), x = L.querySelector('.xbtn').getBoundingClientRect();
    const named = [...L.querySelectorAll('.prow .pb')].filter((b) => !b.hidden).every((b) => b.textContent.trim().length > 1 && [...b.querySelectorAll('span')].some((s) => getComputedStyle(s).opacity === '1' && s.getBoundingClientRect().height > 0));
    return { close: x.width >= 44 && x.top >= 0, named, full: !!L.querySelector('[data-a="full"]') === !!document.fullscreenEnabled };
  });
  check('The player has a Close button, and every control shows its name', c.close && c.named, JSON.stringify(c));
}
await shot(p, '10-phone-player');
await fits(p, 'Player');
{
  const box = await p.locator('.player').boundingBox(), mid = { x: box.x + box.width / 2, y: box.y + box.height * 0.35 };
  await p.waitForFunction(() => !document.querySelector('.player').classList.contains('idle'));
  await p.touchscreen.tap(mid.x, mid.y);
  await p.waitForTimeout(500);
  const hidden = await p.evaluate(() => document.querySelector('.player').classList.contains('idle'));
  await p.touchscreen.tap(mid.x, mid.y);
  await p.waitForTimeout(500);
  const back = await p.evaluate(() => !document.querySelector('.player').classList.contains('idle'));
  check('A tap hides the controls, another shows them', hidden && back, JSON.stringify({ hidden, back }));
  const t0 = await vt();
  await p.touchscreen.tap(box.x + box.width * 0.85, mid.y);
  await p.waitForTimeout(80);
  await p.touchscreen.tap(box.x + box.width * 0.85, mid.y);
  await p.waitForTimeout(400);
  const t1 = await vt();
  check('Two taps on the right go forward 10 seconds', t1 - t0 > 8 && t1 - t0 < 13, `${t0} -> ${t1}`);
  await p.touchscreen.tap(box.x + box.width * 0.15, mid.y);
  await p.waitForTimeout(80);
  await p.touchscreen.tap(box.x + box.width * 0.15, mid.y);
  await p.waitForTimeout(400);
  const t2 = await vt();
  check('Two taps on the left go back 10 seconds', t1 - t2 > 8 && t1 - t2 < 13, `${t1} -> ${t2}`);
  // Drag along the bar: the preview follows, and letting go jumps there.
  await p.evaluate(() => document.querySelector('.player').classList.remove('idle'));
  const bar = await p.locator('.pscrub').boundingBox();
  const drag = await p.evaluate(async ({ x0, x1, y }) => {
    const b = document.querySelector('.pscrub'), v = document.querySelector('.player video');
    const ev = (type, x) => b.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    ev('pointerdown', x0);
    ev('pointermove', (x0 + x1) / 2);
    ev('pointermove', x1);
    const thumb = !document.querySelector('.pthumb').hidden;
    ev('pointerup', x1);
    await new Promise((r) => setTimeout(r, 300));
    return { thumb, at: v.currentTime / v.duration };
  }, { x0: bar.x + bar.width * 0.1, x1: bar.x + bar.width * 0.6, y: bar.y + bar.height / 2 });
  check('Dragging along the bar shows the preview, and letting go goes there', drag.at > 0.5 && drag.at < 0.7, JSON.stringify(drag));
}
// A panel rises from the bottom; Close closes it, then the player.
await p.evaluate(() => document.querySelector('.player').classList.remove('idle'));
await tap(p, '.prow [data-a="speed"]');
await until(p, () => !document.querySelector('.ppanel').hidden);
await p.waitForTimeout(300);
await shot(p, '11-phone-player-panel');
{
  const r = await p.evaluate(() => { const b = document.querySelector('.ppanel').getBoundingClientRect(); return { bottom: Math.round(innerHeight - b.bottom), left: Math.round(b.left), w: Math.round(b.width) }; });
  check('A player panel rises from the bottom, the screen\'s width', r.bottom === 0 && r.left === 0 && Math.abs(r.w - (await p.evaluate(() => innerWidth))) < 2, JSON.stringify(r));
}
await fits(p, 'Player panel');
await tap(p, '.player .xbtn');
await p.waitForTimeout(300);
check('Close closes the panel first', await p.evaluate(() => document.querySelector('.ppanel').hidden && !!document.querySelector('.player')));
await p.evaluate(() => document.querySelector('.player').classList.remove('idle'));
await tap(p, '.player .xbtn');
await until(p, () => !document.querySelector('.player'));
check('Close closes the player, back on the title', !!(await p.locator('.dlayer').count()));
await tap(p, '.dlayer .xbtn');
await p.waitForTimeout(400);

// A series' Episodes, and a person's page from its cast.
console.log('Episodes, a person, profiles');
await page(p, 'search');
await until(p, () => document.querySelector('.srch input.line'));
await p.locator('.srch input.line').fill('the long quiet');
await until(p, () => document.querySelector('#res .card[aria-label="The Long Quiet"]'));
await p.locator('#res .card[aria-label="The Long Quiet"]').tap();
await until(p, () => document.querySelector('.dlayer #de'));
await p.waitForTimeout(300);
await tap(p, '.dlayer #de');
await until(p, () => document.querySelectorAll('.epm .er').length >= 6);
await p.waitForTimeout(400);
await shot(p, '12-phone-episodes');
await fits(p, 'Episodes');
{
  const e = await p.evaluate(() => {
    const list = document.querySelector('.epm-clip'), side = document.querySelector('.epm-s');
    return { scrolls: getComputedStyle(list).overflowY, seasonsSideways: getComputedStyle(document.querySelector('.epm-sl')).flexDirection === 'row' && getComputedStyle(side).overflowX === 'auto', rows: document.querySelectorAll('.epm .er').length };
  });
  check('Episodes: the seasons a strip of chips, the episodes a list that scrolls', e.scrolls === 'auto' && e.seasonsSideways, JSON.stringify(e));
}
await tap(p, '.epm .xbtn');
await until(p, () => !document.querySelector('.epm'));
await until(p, () => document.querySelector('[data-sec="cast"] .pc[aria-label^="Tom Vega"]'));
await p.locator('[data-sec="cast"] .pc[aria-label^="Tom Vega"]').tap();
await until(p, () => document.querySelector('.ppl .ppl-text h1')?.textContent === 'Tom Vega' && document.querySelector('.ppl-known .card'));
await p.waitForTimeout(500);
await shot(p, '13-phone-person');
await fits(p, 'A person');
check('A person\'s page scrolls, with its own Close', await p.evaluate(() => getComputedStyle(document.querySelector('.ppl')).overflowY === 'auto' && !!document.querySelector('.ppl .xbtn')));
await tap(p, '.ppl .xbtn');
await until(p, () => !document.querySelector('.ppl'));
await tap(p, '.dlayer .xbtn');
await p.waitForTimeout(400);
// Who's watching, from More, and a famous actor as the profile's picture.
await tap(p, '.ni[data-go="more"]');
await until(p, () => document.querySelector('.sheet .lopt[data-to="who"]'));
await tap(p, '.sheet .lopt[data-to="who"]');
await until(p, () => document.querySelector('.who #mng'));
await p.waitForTimeout(500);
await shot(p, '14-phone-profiles');
await fits(p, "Who's watching");
await tap(p, '#mng');
await until(p, () => document.querySelector('.pf .ed'));
await p.locator('.pf').first().tap();
await until(p, () => document.querySelector('#act'));
await p.waitForTimeout(300);
await shot(p, '15-phone-profile-edit');
await fits(p, 'Editing a profile');
await tap(p, '#act');
await until(p, () => document.querySelectorAll('.acm .ac:not(.none)').length >= 10);
await p.waitForTimeout(400);
await shot(p, '16-phone-actors');
await fits(p, 'The actor picker');
await tap(p, '.acm .xbtn');
await until(p, () => !document.querySelector('.acm'));
// One profile with no PIN: a reload goes straight back in.
await p.reload();
await until(p, () => document.querySelector('.ni[data-go="home"]'));

// Linking to a server behind a reverse proxy, by a domain: with a code, or with the household password. The keyboard
// (the screen made shorter) never hides the field being typed in.
console.log('Linking to a server');
{
  const asked = [];
  // A stand-in server at a domain, answering over https only, as behind a proxy. It refuses: the messages are checked.
  await p.route(/^https?:\/\/tv\.example\.test\//, (r) => {
    const req = r.request(), u = new URL(req.url());
    asked.push({ url: req.url(), body: req.postData() });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST' };
    if (u.protocol === 'http:') return r.abort('connectionrefused');
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/api/status') return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ app: 'dholphin', version: '0.42.0+78' }) });
    if (u.pathname === '/api/pair') return r.fulfill({ status: 403, headers: cors, contentType: 'application/json', body: JSON.stringify({ message: 'Wrong or expired code. Make a new one in the panel.' }) });
    if (u.pathname === '/api/login') return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ message: 'Wrong password' }) });
    return r.fulfill({ status: 404, headers: cors, body: '' });
  });
  await page(p, 'settings');
  await until(p, () => document.querySelector('#srvl'));
  await tap(p, '#srvl');
  await until(p, () => document.querySelector('.lsrv [data-mode]'));
  await p.waitForTimeout(300);
  const shown = (id) => p.evaluate((x) => !!document.querySelector(`#fld-${x}`)?.closest('.field')?.getBoundingClientRect().height, id);
  check('Linking offers a code or the household password, the code first', (await p.locator('.lsrv [data-mode]').count()) === 2 && (await shown('code')) && !(await shown('password')));
  await p.fill('#fld-origin', 'tv.example.test');
  await p.fill('#fld-code', '123 456');
  await tap(p, '#lgo');
  await until(p, () => document.querySelector('.lsrv .err')?.textContent);
  check('A domain is tried over https first, the code sent to its /api/pair', asked[0]?.url === 'https://tv.example.test/api/status' && asked.some((a) => a.url === 'https://tv.example.test/api/pair' && JSON.parse(a.body).code === '123456') && !asked.some((a) => a.url.startsWith('http:')), JSON.stringify(asked));
  check('A refused code says why', (await p.locator('.lsrv .err').textContent()).includes('expired'));
  await tap(p, '.lsrv [data-mode="password"]');
  check('The password way shows only the password field', (await shown('password')) && !(await shown('code')) && (await p.locator('#fld-password').getAttribute('type')) === 'password');
  await p.fill('#fld-password', 'not-it');
  await tap(p, '#lgo');
  await until(p, () => document.querySelector('.lsrv .err')?.textContent.includes('Wrong password'));
  const login = asked.find((a) => a.url.endsWith('/api/login'));
  check('The password goes to /api/login asking for a device\'s token, under the phone\'s name', !!login && JSON.parse(login.body).device === true && JSON.parse(login.body).name === 'Phone' && JSON.parse(login.body).password === 'not-it', JSON.stringify(login));
  await shot(p, '17-phone-link');
  await fits(p, 'Linking to a server');
  // The keyboard opens: the screen is shorter. The field stays in view, and the menu stays a bar.
  await p.locator('#fld-password').focus();
  await p.setViewportSize({ width: 390, height: 430 });
  await p.waitForTimeout(500);
  const kb = await p.evaluate(() => { const r = document.querySelector('#fld-password').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, nav: document.querySelector('#tv').dataset.nav }; });
  await shot(p, '18-phone-link-keyboard');
  check('With the keyboard open, the field being typed in stays above it', kb.top >= 0 && kb.bottom <= kb.h && kb.nav === 'bar', JSON.stringify(kb));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  await tap(p, '#lcn');
  await until(p, () => !document.querySelector('.lsrv'));
  await p.unroute(/^https?:\/\/tv\.example\.test\//);
}

console.log('Phone, sideways');
await p.setViewportSize({ width: 844, height: 390 });
await p.waitForTimeout(500);
await page(p, 'home');
await until(p, () => document.querySelector('.row:not([hidden]) .card'));
await p.waitForTimeout(400);
await shot(p, '06-phone-sideways');
{
  const r = await p.evaluate(() => ({ nav: document.querySelector('#tv').dataset.nav, items: [...document.querySelectorAll('.rail .ni')].filter((b) => b.offsetHeight).map((b) => b.textContent.trim()), left: Math.round(document.querySelector('.rail').getBoundingClientRect().left), ct: Math.round(document.querySelector('#ct').getBoundingClientRect().left) }));
  check('Sideways, the menu becomes a rail at the left, still with names and More', r.nav === 'rail' && r.left === 0 && r.ct > 60 && r.items.includes('More'), JSON.stringify(r));
}
await fits(p, 'Home sideways');
await phone.close();

// The Android app on a phone, with a stand-in for its bridge (android/.../Bridge.kt): playing asks it to turn
// sideways and hide the bars, closing gives them back, and the page shows no Full screen button of its own.
console.log('Android phone, with a stand-in for the app');
{
  const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const calls = [];
  await actx.exposeFunction('__androidCall', (c) => calls.push(c));
  await actx.addInitScript(() => {
    const call = (m, ...a) => window.__androidCall({ m, a });
    window.DholphinAndroid = {
      // Newer than anything published, so no update is offered.
      version: () => '99.0.0+999', build: () => '999', installed: () => 'no', openApp: () => 'missing',
      phoneStart: () => JSON.stringify({ url: 'http://192.168.1.50:41234/p/abc', qr: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E' }),
      phoneStop: () => undefined, localAddresses: () => '[]', installUpdate: () => undefined,
      watching: (on) => call('watching', on), exit: () => call('exit'),
    };
  });
  const a = await actx.newPage();
  a.on('pageerror', (e) => errors.push(`android page: ${e.message}`));
  await setUp(a);
  check('The Android app on a phone gets the touch layout', await a.evaluate(() => document.querySelector('#tv').dataset.form === 'phone'));
  await page(a, 'search');
  await until(a, () => document.querySelector('.srch input.line'));
  await a.locator('.srch input.line').fill('black orchard');
  await until(a, () => document.querySelector('#res .card[aria-label="Black Orchard"]'));
  await a.locator('#res .card[aria-label="Black Orchard"]').tap();
  await until(a, () => document.querySelector('.dlayer [data-play="jellyfin"]'));
  await a.waitForTimeout(300);
  await tap(a, '.dlayer [data-play="jellyfin"]');
  await until(a, () => document.querySelector('.player video')?.currentTime > 0.3);
  check('Playing asks Android to turn sideways and hide its bars, with no Full screen button of the page\'s own', calls.some((c) => c.m === 'watching' && c.a[0] === '1') && !(await a.locator('[data-a="full"]').count()), JSON.stringify(calls));
  await a.evaluate(() => document.querySelector('.player').classList.remove('idle'));
  await tap(a, '.player .xbtn');
  await until(a, () => !document.querySelector('.player'));
  check('Closing the player gives the screen back', calls.at(-1)?.m === 'watching' && calls.at(-1)?.a[0] === '0', JSON.stringify(calls));
  await actx.close();
}

console.log('Tablet');
const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const q = await tablet.newPage();
q.on('pageerror', (e) => errors.push(`page: ${e.message}`));
await setUp(q);
await shot(q, '07-tablet-home');
check('A tablet upright gets the bar too', await q.evaluate(() => document.querySelector('#tv').dataset.form === 'tablet' && document.querySelector('#tv').dataset.nav === 'bar'));
await fits(q, 'Tablet Home');
await q.setViewportSize({ width: 1180, height: 820 });
await q.waitForTimeout(500);
await shot(q, '08-tablet-sideways');
{
  const items = await q.evaluate(() => [...document.querySelectorAll('.rail .ni')].filter((b) => b.offsetHeight).map((b) => b.textContent.trim()));
  check('A tablet sideways has a rail with every page in it, and no More', ['Search', 'Home', 'Categories', 'Library', 'My List', 'History', 'Settings'].every((x) => items.includes(x)) && !items.includes('More'), JSON.stringify(items));
}
await fits(q, 'Tablet Home sideways');
await q.locator('.row:not([hidden]):not(.sects) .card').first().tap();
await until(q, () => document.querySelector('.dlayer .xbtn'));
await q.waitForTimeout(500);
await shot(q, '09-tablet-details');
await fits(q, 'Tablet Title Details');
await tablet.close();

console.log('A computer keeps the TV layout');
const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const d = await desk.newPage();
await d.goto(URL_);
await until(d, () => document.querySelector('.onb'));
check('A mouse and keyboard keep the 1080 canvas, without touch', await d.evaluate(() => !document.querySelector('#tv').dataset.form && document.querySelector('#tv').offsetHeight === 1080));
await desk.close();

check('No page errors', !errors.length, errors.join('\n'));
console.log(`${passed} checks passed`);
await browser.close();
server.close();
