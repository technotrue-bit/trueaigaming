// Retakes Aurora's World's card only when the game's look changes. The game follows the seasons and lets a holiday
// take over while it lasts (cozy autumn through fall, Halloween all October, sunny otherwise), and its ?poster page
// names the look it shows on <html data-dress>. This reads it, and if it isn't the look the card already shows
// (kept in scripts/card-looks.json), saves a new 1280x720 card the same way scripts/thumb.mjs does.
// Usage: node scripts/seasonal-card.mjs [--force]
// Prints "changed=true" or "changed=false" (and appends it to $GITHUB_OUTPUT when there is one).
import { chromium } from 'playwright';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const LOOKS = join(ROOT, 'scripts/card-looks.json');
const GAME = 'squishy-closet';
const POSTER = 'https://squishy-closet.vercel.app/?poster';
const OUT = join(ROOT, 'public/thumbs/squishy-closet.png');
const RENDER_WAIT_MS = 8000;

/** Does the card need retaking? Only when the poster names a look and it differs from the card's (or when forced). */
export function needsRetake(stored, look, force = false) {
  if (!look) return false;
  return force || stored !== look;
}

function report(changed) {
  console.log(`changed=${changed}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

if (import.meta.main) {
  const force = process.argv.includes('--force');
  const looks = JSON.parse(readFileSync(LOOKS, 'utf8'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const start = Date.now();
    await page.goto(POSTER, { waitUntil: 'load', timeout: 60_000 });
    const look = await page
      .waitForFunction(() => document.documentElement.dataset.dress, null, { timeout: 30_000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    console.log(`The poster shows: ${look ?? '(it does not say)'}; the card shows: ${looks[GAME] ?? '(unknown)'}`);
    if (!needsRetake(looks[GAME], look, force)) {
      report(false);
    } else {
      await page.waitForTimeout(Math.max(0, RENDER_WAIT_MS - (Date.now() - start)));
      await page.screenshot({ path: OUT, fullPage: false });
      looks[GAME] = look;
      writeFileSync(LOOKS, JSON.stringify(looks, null, 2) + '\n');
      console.log(`Saved ${OUT}`);
      report(true);
    }
  } finally {
    await browser.close();
  }
}
