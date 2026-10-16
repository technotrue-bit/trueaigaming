// Capture a 1280x720 thumbnail of a game's live site.
// Usage: node scripts/thumb.mjs [url] [out]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'https://super-star-party.vercel.app';
const out = process.argv[3] ?? 'public/thumbs/super-star-party.png';
const RENDER_WAIT_MS = 8000;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(RENDER_WAIT_MS);
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log(`Saved ${out}`);
} finally {
  await browser.close();
}
