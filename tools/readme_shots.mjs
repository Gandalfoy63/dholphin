// Docs: docs/02 - Tech/Testing.md
// Purpose: takes the README's pictures from a real Dholphin server, signed in as one profile: TV, phone and tablet.
// Run in Playwright's image, next to the server:
//   docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -e URL=http://127.0.0.1:8977/ -e PASSWORD=... \
//     -e PROFILE=Max -e OUT=/out -v "$PWD:$PWD" -v "$OUT:/out" -w "$PWD" mcr.microsoft.com/playwright:v1.64.1-noble node tools/readme_shots.mjs
// It only looks: it plays nothing (that would report progress to Jellyfin) and requests nothing.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const URL_ = process.env.URL ?? 'http://127.0.0.1:8977/';
const PASSWORD = process.env.PASSWORD;
const PROFILE = process.env.PROFILE ?? 'Max';
const OUT = process.env.OUT ?? '/tmp/dholphin-readme';
if (!PASSWORD) throw new Error('PASSWORD is needed: the household password of the server at URL');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const wait = (p, ms) => p.waitForTimeout(ms);
const until = (p, fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout });
const shot = async (p, name) => {
  await p.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 84 });
  console.log(`  ${name}.jpg`);
};
/** Every picture on screen has loaded (or failed): no half-drawn cards in a picture. */
const pictures = (p) => p.waitForFunction(() => [...document.querySelectorAll('#tv img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).every((i) => i.complete), null, { timeout: 20000 }).catch(() => undefined);
const tryShot = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`  ${name}: skipped (${e.message.split('\n')[0]})`);
  }
};

/** A browser signed in to the server, inside the profile. `loader`: a picture of the profile loading. */
async function enter(options, loader) {
  const ctx = await browser.newContext(options);
  const r = await ctx.request.post(`${URL_}api/login`, { data: { password: PASSWORD, name: 'README pictures' } });
  if (!r.ok()) throw new Error(`Sign-in refused: ${r.status()}`);
  const p = await ctx.newPage();
  await p.goto(URL_);
  await until(p, () => document.querySelector('.who .pf, .ni[data-go="home"]'));
  if (await p.locator('.who .pf').count()) {
    await p.locator('.who .pf', { hasText: PROFILE }).first().click();
    if (loader) {
      await wait(p, 900);
      await shot(p, loader);
    }
  }
  await until(p, () => document.querySelector('.hero .hp') && document.querySelectorAll('.row:not([hidden]) .card').length > 12);
  await wait(p, 2500);
  await pictures(p);
  return { ctx, p };
}
const nav = (p, id) => p.evaluate((x) => document.querySelector(`.ni[data-go="${x}"]`).click(), id);

// ---------- TV (a computer's window is the TV's canvas) ----------
console.log('TV');
{
  const { ctx, p } = await enter({ viewport: { width: 1920, height: 1080 } }, 'loader');
  await shot(p, 'home');
  await tryShot('card-focus', async () => {
    // As on a TV: the arrows from the hero down to the first row of posters, then along it. The mouse stays out of
    // the way (a pointer over a row shows its arrows and leaves the row where it is).
    await p.mouse.move(1910, 1075);
    await p.locator('.hero .hp').focus();
    for (let i = 0; i < 8 && !(await p.evaluate(() => document.activeElement?.classList.contains('poster'))); i++) {
      await p.keyboard.press('ArrowDown');
      await wait(p, 450);
    }
    await p.keyboard.press('ArrowRight');
    await wait(p, 350);
    await p.keyboard.press('ArrowRight');
    await until(p, () => document.activeElement?.classList.contains('rev'));
    await wait(p, 900);
    await pictures(p);
    await shot(p, 'card-focus');
  });
  // A title with a cast and a person: from the hero's More info.
  await tryShot('details', async () => {
    await p.evaluate(() => {
      document.querySelector('#ct').scrollTop = 0;
      document.querySelector('.scroller').style.transform = 'none';
      document.querySelector('.hero .hi').click();
    });
    await until(p, () => document.querySelector('.dlayer .dtext .btns .btn:not([aria-busy])'));
    await wait(p, 1500);
    await pictures(p);
    await shot(p, 'details');
    await until(p, () => document.querySelectorAll('.dlayer [data-sec="cast"] .pc').length >= 4);
    await wait(p, 1200);
    await p.locator('.dlayer [data-sec="cast"] .pc').first().focus();
    await wait(p, 1200);
    await pictures(p);
    await shot(p, 'details-cast');
    await p.keyboard.press('Enter');
    await until(p, () => document.querySelector('.ppl .ppl-text h1') && document.querySelector('.ppl-known .card'));
    await wait(p, 1800);
    await pictures(p);
    await shot(p, 'actor');
    await p.keyboard.press('Escape');
    await wait(p, 400);
    await p.keyboard.press('Escape');
    await until(p, () => !document.querySelector('.dlayer'));
  });
  // Episodes: the first series on Jellyfin.
  await tryShot('episodes', async () => {
    // Titles only: not Home's section tiles nor a row's See all.
    const row = p.locator('.row:not([hidden]):not(.sects) .card:not(.tile)');
    for (let i = 0, n = Math.min(await row.count(), 40); i < n; i++) {
      await row.nth(i).evaluate((c) => c.click());
      await until(p, () => document.querySelector('.dlayer'));
      await until(p, () => document.querySelector('.dlayer .dtext .btns .btn:not([aria-busy])'));
      if (await p.locator('.dlayer #de').count() && await p.locator('.dlayer [data-play]').count()) break;
      await p.keyboard.press('Escape');
      await until(p, () => !document.querySelector('.dlayer'));
    }
    await p.locator('.dlayer #de').click();
    await until(p, () => document.querySelectorAll('.epm .er').length >= 3);
    await wait(p, 1500);
    await pictures(p);
    await shot(p, 'episodes');
    await p.keyboard.press('Escape');
    await until(p, () => !document.querySelector('.epm'));
    await wait(p, 300);
    await p.keyboard.press('Escape');
    await until(p, () => !document.querySelector('.dlayer'));
  });
  for (const [name, go, ready] of [['anime', 'anime', '.row:not([hidden]) .card'], ['categories', 'categories', '.cat .cimg.on'], ['library', 'library', '.lvirt .card']]) {
    await tryShot(name, async () => {
      if (name === 'anime') {
        await nav(p, 'home');
        await until(p, () => document.querySelector('.row.sects [data-sect]'));
        await p.locator('[data-sect="anime"]').click();
      } else await nav(p, go);
      await until(p, (s) => document.querySelector(s), ready);
      await wait(p, 2500);
      await pictures(p);
      await shot(p, name);
    });
  }
  await ctx.close();
}

// ---------- A phone, upright ----------
console.log('Phone');
{
  const { ctx, p } = await enter({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await shot(p, 'phone-home');
  await tryShot('phone-rows', async () => {
    await p.evaluate(() => (document.querySelector('#ct').scrollTop = document.querySelector('.row.sects')?.offsetTop ?? 900));
    await wait(p, 1500);
    await pictures(p);
    await shot(p, 'phone-rows');
    await p.evaluate(() => (document.querySelector('#ct').scrollTop = 0));
  });
  await tryShot('phone-details', async () => {
    await p.locator('.hero .hi').tap();
    await until(p, () => document.querySelector('.dlayer .dtext .btns .btn:not([aria-busy])'));
    await wait(p, 1800);
    await pictures(p);
    await shot(p, 'phone-details');
    await p.locator('.dlayer .xbtn').tap();
    await until(p, () => !document.querySelector('.dlayer'));
  });
  await tryShot('phone-library', async () => {
    await nav(p, 'library');
    await until(p, () => document.querySelector('.lvirt .card'));
    await wait(p, 2000);
    await pictures(p);
    await shot(p, 'phone-library');
  });
  await tryShot('phone-more', async () => {
    await p.locator('.ni[data-go="more"]').tap();
    await until(p, () => document.querySelector('.sheet .lopt'));
    await wait(p, 600);
    await shot(p, 'phone-more');
    await p.locator('.sheet #mx').tap();
  });
  await ctx.close();
}

// ---------- A tablet, sideways ----------
console.log('Tablet');
{
  const { ctx, p } = await enter({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await shot(p, 'tablet-home');
  await ctx.close();
}
await browser.close();
