// Docs: docs/02 - Tech/Testing.md
// Purpose: the browser half of the real Jellyfin test.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createDoubles } from '../doubles/server.mjs';

const J = process.env.JELLYFIN, OUT = process.env.OUT;
const server = createDoubles();
await new Promise((r) => server.listen(8798, '127.0.0.1', r));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
p.on('console', (m) => { if (['warning', 'error'].includes(m.type())) console.log('   page:', m.text()); });
p.on('response', (r) => { if (r.url().startsWith(J) && r.status() >= 400) console.log('   http', r.status(), r.url().replace(J, '').slice(0, 160)); });
const until = (fn) => p.waitForFunction(fn, null, { timeout: 30000 });
const ok = (n) => console.log(`  ok  ${n}`);
/** The mouse wakes the player's controls first, as it does for a person. */
const press = async (sel) => {
  await p.mouse.move(600 + Math.random() * 100, 400);
  await p.locator(sel).click();
};
await p.goto('http://127.0.0.1:8798/');
await until(() => document.activeElement?.id === 'nx');
await p.keyboard.press('Enter');
await until(() => document.querySelector('#fld-tmdb'));
await p.fill('#fld-tmdb', 'k');
await p.click('#nx');
await until(() => document.querySelector('.nm'));
await p.keyboard.press('Enter');
await p.click('#nx');
await until(() => document.querySelector('[data-c="jellyfin"]'));
await p.click('[data-c="jellyfin"]');
await until(() => document.querySelector('#fld-server'));
await p.fill('#fld-server', J);
await p.fill('#fld-user', 'alice');
await p.fill('#fld-password', 'wrong');
await p.click('#cg');
await until(() => document.querySelector('.modal .err')?.textContent);
assert.equal(await p.locator('.modal .err').textContent(), 'Wrong user name or password');
ok('A wrong password is refused, and says so');
await p.fill('#fld-password', 'pw123');
await p.click('#cg');
await until(() => !document.querySelector('.modal'));
ok('Signs in to the real server');
await p.click('#nx');
await until(() => document.querySelectorAll('.tc[data-t]').length === 18);
for (const i of [0, 1, 2]) await p.locator('.tc[data-t]').nth(i).click();
await p.click('#nx');
await until(() => document.querySelector('[data-g="language"]'));
await p.click('#nx');
await until(() => document.querySelector('.row[data-row="rows-jellyfin"] .card'));
const card = p.locator('.row[data-row="rows-jellyfin"] .card').first();
const name = await card.getAttribute('aria-label');
ok(`The server's film appears in its row: ${name}`);
await card.focus();
await p.keyboard.press('Enter');
await until(() => document.querySelector('.dlayer [data-play="jellyfin"]'));
assert.ok((await p.locator('.dlayer .pvd').innerText()).includes('Jellyfin'));
ok('Its details show the Jellyfin logo and name');
await p.locator('[data-play="jellyfin"]').focus();
await p.keyboard.press('Enter');
await until(() => document.querySelector('.player video')?.currentTime > 2);
await p.screenshot({ path: join(OUT, 'real-player.png') });
ok('The real video plays');
const meId = await (await fetch(`${J}/Users/Me`, { headers: { Authorization: auth() } })).json().then((u) => u.Id);
const playing = async () => (await (await fetch(`${J}/Sessions?activeWithinSeconds=60`, { headers: { Authorization: auth() } })).json()).find((x) => x.NowPlayingItem && x.UserId === meId);
// Tracks, as the server describes them.
await press('.prow [data-a="tracks"]');
await until(() => !document.querySelector('.ppanel').hidden);
const audios = await p.locator('.ppanel [data-au]').allInnerTexts(), subs = await p.locator('.ppanel [data-su]').allInnerTexts();
assert.equal(audios.length, 2, audios.join(' | '));
assert.ok(subs.length === 2 && /eng/i.test(subs[1]), subs.join(' | '));
ok(`The menu lists the server's tracks: ${audios.join(', ')}; ${subs.join(', ')}`);
await p.locator('.ppanel [data-su]').nth(1).click();
await until(() => /Subtitle line \d+/.test(document.querySelector('.psub').textContent));
ok(`The subtitle file, converted by the server, shows: "${(await p.locator('.psub').innerText()).trim()}"`);
const before = await p.evaluate(() => document.querySelector('.player video').currentTime);
await press('.prow [data-a="tracks"]');
await until(() => !document.querySelector('.ppanel').hidden);
const second = Number(await p.locator('.ppanel [data-au]').nth(1).getAttribute('data-au'));
await p.locator('.ppanel [data-au]').nth(1).click();
await p.waitForFunction(async (b) => { const v = document.querySelector('.player video'); return v.currentTime > b + 1 && !v.paused; }, before, { timeout: 30000 });
const after = await p.evaluate(() => document.querySelector('.player video').currentTime);
assert.ok(Math.abs(after - before) < 8, `${before} → ${after}`);
await p.waitForTimeout(11000); // The next progress report carries the new track.
const s2 = await playing();
assert.equal(s2?.PlayState?.AudioStreamIndex, second, JSON.stringify(s2?.PlayState));
assert.notEqual(s2.PlayState.PlayMethod, 'DirectPlay', 'a browser plays only the first track of a file');
ok(`The second audio track plays from ${Math.round(before)} s, as ${s2.PlayState.PlayMethod}, and the server knows which`);
assert.ok((await p.locator('.psub').innerText()).includes('Subtitle line'));
ok('The subtitles stay on');
await p.screenshot({ path: join(OUT, 'real-player-tracks.png') });
await p.keyboard.press('1'); // 10%: past the 5% below which Jellyfin keeps no position.
await p.waitForTimeout(2500);
await p.keyboard.press('Escape');
await until(() => !document.querySelector('.player'));
await p.waitForTimeout(1500);
const items = await (await fetch(`${J}/Items?recursive=true&includeItemTypes=Movie&fields=UserData&userId=${meId}`, { headers: { Authorization: auth() } })).json();
const ticks = items.Items[0].UserData.PlaybackPositionTicks;
assert.ok(ticks > 0, `position ${ticks}`);
ok(`The server recorded the position, ${Math.round(ticks / 1e7)} s, so other Jellyfin apps stay in step`);
await b.close();
server.close();
function auth() {
  return `MediaBrowser Client="check", Device="check", DeviceId="check1", Version="1", Token="${process.env.JELLYFIN_TOKEN}"`;
}
console.log('Real Jellyfin: passed');
