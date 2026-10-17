// Responsive probe for the play page. Run against a built preview:
//   npm run build && npx vite preview --port 5291 --strictPort &
//   node tools/probe-play.mjs                 # PROBE_URL=http://127.0.0.1:5291 by default
// Checks every size x browser below, prints a table, writes shots/responsive/report.json, per-combo screenshots
// and a contact sheet. Exits 1 on any FAIL.
// Not covered: safe-area insets (Playwright can't simulate env(safe-area-inset-*)) and real Safari toolbars.
import { chromium, webkit } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = (arg('url') ?? process.env.PROBE_URL ?? 'http://127.0.0.1:5291').replace(/\/$/, '');
const OUT = resolve('shots/responsive');
const TIMEOUT = 45_000;
// Optional filters for quick iteration: --sizes=320x568,844x390 --browsers=webkit (or PROBE_SIZES / PROBE_BROWSERS)
const onlySizes = (arg('sizes') ?? process.env.PROBE_SIZES)?.split(',');
const onlyBrowsers = (arg('browsers') ?? process.env.PROBE_BROWSERS)?.split(',');
const ALL_SIZES = [
  [320, 568],
  [375, 635],
  [390, 844],
  [430, 932],
  [667, 375],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1366, 768],
  [1920, 1080],
];
const SIZES = ALL_SIZES.filter(([w, h]) => !onlySizes || onlySizes.includes(`${w}x${h}`));
const DIALOG_SHOTS = new Set(['375x635', '844x390']);
const isDesktop = (w, h) => Math.min(w, h) >= 768 && Math.max(w, h) >= 1366;

const games = JSON.parse(await readFile(resolve('public/games.json'), 'utf8'));
const gameId = games[0]?.id;
if (!gameId) throw new Error('public/games.json has no games');
const url = `${BASE}/play.html?id=${encodeURIComponent(gameId)}`;

await mkdir(OUT, { recursive: true });
const results = [];

async function newContext(browser, name, w, h) {
  const touch = !isDesktop(w, h);
  const base = { viewport: { width: w, height: h }, hasTouch: touch };
  const notes = [];
  if (touch && name === 'chromium') return { ctx: await browser.newContext({ ...base, isMobile: true }), notes };
  if (touch && name === 'webkit') {
    // Playwright's WebKit doesn't support isMobile on every platform; fall back to touch only.
    try {
      return { ctx: await browser.newContext({ ...base, isMobile: true }), notes: ['webkit isMobile'] };
    } catch (err) {
      notes.push(`webkit isMobile unsupported (${String(err.message).split('\n')[0]}), touch only`);
    }
  }
  return { ctx: await browser.newContext(base), notes };
}

async function probe(browser, name, w, h) {
  const label = `${name}-${w}x${h}`;
  const fails = [];
  const info = {};
  const { ctx, notes } = await newContext(browser, name, w, h);
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on('pageerror', (err) => fails.push(`page error: ${String(err.message).split('\n')[0]}`));
  try {
    await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
    const iframeEl = await page.waitForSelector('#frame-wrap iframe', { state: 'attached', timeout: TIMEOUT });
    const frame = await iframeEl.contentFrame();
    if (!frame) throw new Error('iframe has no content frame');
    await frame.waitForLoadState('load', { timeout: TIMEOUT });
    // Let the stage settle (rAF-coalesced viewport measurement).
    await page.waitForTimeout(500);

    const layout = await page.evaluate(() => {
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      };
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const iframe = document.querySelector('#frame-wrap iframe');
      const stage = document.getElementById('stage');
      return {
        innerW: innerWidth,
        innerH: innerHeight,
        usableW: parseFloat(cs.getPropertyValue('--usable-w')),
        usableH: parseFloat(cs.getPropertyValue('--usable-h')),
        classes: root.className,
        scale: Number(stage.dataset.scale),
        iframe: r(iframe),
        wrap: r(document.getElementById('frame-wrap')),
        scrollW: document.scrollingElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
      };
    });
    Object.assign(info, { scale: layout.scale, classes: layout.classes, usable: `${layout.usableW}x${layout.usableH}` });

    // (a) frame inside the viewport and filling the usable area
    const f = layout.iframe;
    if (f.x < -1 || f.y < -1 || f.x + f.w > layout.innerW + 1 || f.y + f.h > layout.innerH + 1) fails.push(`a: iframe ${JSON.stringify(f)} outside viewport`);
    if (!(layout.usableW > 0 && layout.usableH > 0)) fails.push('a: --usable-w/h not set');
    else if (Math.abs(f.w - layout.usableW) > 1 || Math.abs(f.h - layout.usableH) > 1) fails.push(`a: iframe ${f.w.toFixed(1)}x${f.h.toFixed(1)} != usable ${layout.usableW}x${layout.usableH}`);
    if (!(layout.scale > 0 && layout.scale <= 1)) fails.push(`a: bad data-scale ${layout.scale}`);

    // (b) no horizontal overflow
    if (layout.scrollW > layout.innerW || layout.bodyScrollW > layout.innerW) fails.push(`b: horizontal overflow ${layout.scrollW}/${layout.bodyScrollW} > ${layout.innerW}`);

    // (c) HUD buttons: >= 44x44 and not covered; (d) landscape HUD clear of the top-center band
    const hud = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#hud .hud-btn')].filter((b) => !b.hidden && b.getClientRects().length);
      const h = document.getElementById('hud').getBoundingClientRect();
      return {
        rect: { x: h.left, y: h.top, w: h.width, h: h.height },
        buttons: btns.map((b) => {
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return { label: b.getAttribute('aria-label'), w: r.width, h: r.height, x: r.left, y: r.top, hits: Boolean(hit && b.contains(hit)) };
        }),
      };
    });
    info.hud = hud.rect;
    if (hud.buttons.length < 3) fails.push(`c: only ${hud.buttons.length} visible HUD buttons`);
    for (const b of hud.buttons) {
      if (b.w < 44 || b.h < 44) fails.push(`c: "${b.label}" hit area ${b.w}x${b.h} < 44`);
      if (!b.hits) fails.push(`c: "${b.label}" covered at its center`);
      if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > w + 0.5 || b.y + b.h > h + 0.5) fails.push(`c: "${b.label}" off screen`);
    }
    if (w > h) {
      const band = { x0: 0.3 * w, x1: 0.7 * w, y0: 0, y1: 0.15 * h };
      const r = hud.rect;
      if (r.x < band.x1 && r.x + r.w > band.x0 && r.y < band.y1 && r.y + r.h > band.y0) fails.push(`d: HUD ${JSON.stringify(r)} covers the top-center band`);
    }

    await page.screenshot({ path: `${OUT}/${label}.png` });

    // (f) input mapping into the scaled frame
    if (layout.scale < 1) {
      const child = await frame.evaluate(() => {
        window.__probe = [];
        const rec = (e) => window.__probe.push({ type: e.type, pointerType: e.pointerType, x: e.clientX, y: e.clientY });
        window.addEventListener('pointerdown', rec, true);
        return { w: innerWidth, h: innerHeight };
      });
      const expW = f.w / layout.scale;
      const expH = f.h / layout.scale;
      info.logical = `${child.w}x${child.h}`;
      if (Math.abs(child.w - expW) > 2 || Math.abs(child.h - expH) > 2) fails.push(`f: child viewport ${child.w}x${child.h} != logical ${expW.toFixed(1)}x${expH.toFixed(1)}`);
      // Hit an off-center point (left third) so a wrong origin or missing scale shows up. Touch devices get a
      // tap first; every device then gets a mouse click, which must also move focus into the frame. (Focus is
      // only asserted for the click: a game canvas that cancels touch defaults legitimately keeps focus out.)
      const sx = f.x + f.w * 0.35;
      const sy = f.y + f.h * 0.5;
      const ex = (sx - f.x) / layout.scale;
      const ey = (sy - f.y) / layout.scale;
      const inputs = [];
      const send = async (kind) => {
        await frame.evaluate(() => (window.__probe.length = 0));
        if (kind === 'tap') await page.touchscreen.tap(sx, sy);
        else await page.mouse.click(sx, sy);
        await page.waitForTimeout(300);
        const events = await frame.evaluate(() => window.__probe);
        const ev = events.find((e) => e.type === 'pointerdown');
        inputs.push(ev ? `${kind}: ${ev.pointerType} pointerdown @ ${ev.x.toFixed(1)},${ev.y.toFixed(1)}` : `${kind}: none`);
        if (!ev) fails.push(`f: ${kind} not delivered to the iframe`);
        else if (Math.abs(ev.x - ex) > 2 || Math.abs(ev.y - ey) > 2) fails.push(`f: ${kind} at ${ev.x.toFixed(1)},${ev.y.toFixed(1)}, expected ${ex.toFixed(1)},${ey.toFixed(1)}`);
      };
      if (!isDesktop(w, h)) await send('tap');
      await send('click');
      info.input = `${inputs.join('; ')} (expected ${ex.toFixed(1)},${ey.toFixed(1)})`;
      const active = await page.evaluate(() => document.activeElement?.tagName);
      if (active !== 'IFRAME') fails.push(`f: activeElement after click is ${active}, not IFRAME`);
    }

    // (e) feedback dialog fits and scrolls
    await page.click('#feedback');
    await page.waitForSelector('dialog.fb-dialog[open]', { timeout: 5000 });
    await page.waitForTimeout(250);
    const dlg = await page.evaluate(() => {
      const d = document.querySelector('dialog.fb-dialog[open]');
      const r = d.getBoundingClientRect();
      const before = d.scrollTop;
      d.scrollTop = 10_000;
      const after = d.scrollTop;
      d.scrollTop = 0;
      return { x: r.left, y: r.top, w: r.width, h: r.height, sh: d.scrollHeight, ch: d.clientHeight, overflowY: getComputedStyle(d).overflowY, scrolled: after > before };
    });
    info.dialog = `${Math.round(dlg.w)}x${Math.round(dlg.h)} content ${dlg.sh}/${dlg.ch}`;
    if (dlg.x < -1 || dlg.y < -1 || dlg.x + dlg.w > w + 1 || dlg.y + dlg.h > h + 1) fails.push(`e: dialog ${JSON.stringify(dlg)} outside viewport`);
    if (dlg.sh > dlg.ch + 1) {
      if (!['auto', 'scroll'].includes(dlg.overflowY)) fails.push(`e: dialog overflows but overflow-y is ${dlg.overflowY}`);
      if (!dlg.scrolled) fails.push('e: dialog overflows but cannot scroll');
    }
    if (DIALOG_SHOTS.has(`${w}x${h}`)) await page.screenshot({ path: `${OUT}/${label}-dialog.png` });
    await page.click('dialog.fb-dialog[open] .fb-close');
    await page.waitForFunction(() => !document.querySelector('dialog.fb-dialog[open]'), null, { timeout: 5000 });
  } catch (err) {
    fails.push(`error: ${String(err.message).split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/${label}.png` }).catch(() => {});
  } finally {
    await ctx.close();
  }
  return { browser: name, size: `${w}x${h}`, status: fails.length ? 'FAIL' : 'PASS', fails, notes, ...info };
}

for (const [name, type] of [
  ['webkit', webkit],
  ['chromium', chromium],
]) {
  if (onlyBrowsers && !onlyBrowsers.includes(name)) continue;
  const browser = await type.launch();
  try {
    for (const [w, h] of SIZES) {
      const r = await probe(browser, name, w, h);
      results.push(r);
      console.log(`${r.status} ${name} ${r.size} scale=${r.scale ?? '?'}${r.fails.length ? `  ${r.fails.join('; ')}` : ''}`);
    }
  } finally {
    await browser.close();
  }
}

console.log('');
console.table(results.map((r) => ({ browser: r.browser, size: r.size, status: r.status, scale: r.scale, logical: r.logical ?? '', dialog: r.dialog ?? '', reasons: r.fails.join('; ') })));
await writeFile(`${OUT}/report.json`, JSON.stringify({ url, date: new Date().toISOString(), results }, null, 2));

// Contact sheet: a page of labelled thumbnails, screenshotted.
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const tiles = results
  .flatMap((r) => {
    const base = `${r.browser}-${r.size}`;
    const list = [{ file: `${base}.png`, label: `${base} ${r.status} s=${r.scale ?? '?'}`, ok: r.status === 'PASS' }];
    if (DIALOG_SHOTS.has(r.size)) list.push({ file: `${base}-dialog.png`, label: `${base} dialog`, ok: r.status === 'PASS' });
    return list;
  })
  .map((t) => `<figure class="${t.ok ? 'ok' : 'bad'}"><img src="${esc(t.file)}"><figcaption>${esc(t.label)}</figcaption></figure>`)
  .join('');
const sheet = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:12px;background:#111;color:#eee;font:13px system-ui;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
figure{margin:0;padding:6px;border:2px solid #3c3;border-radius:6px}figure.bad{border-color:#e33}
img{display:block;max-width:260px;max-height:260px}figcaption{margin-top:4px}
</style>${tiles}`;
await writeFile(`${OUT}/contact-sheet.html`, sheet);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
  await page.goto(pathToFileURL(`${OUT}/contact-sheet.html`).href);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: `${OUT}/contact-sheet.png`, fullPage: true });
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} PASS. Report: ${OUT}/report.json`);
process.exit(failed.length ? 1 : 0);
