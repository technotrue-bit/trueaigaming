// Render the 1200x630 home social card to public/og.png in the site's neon style.
// Usage: node scripts/og.mjs [out]
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'public/og.png';
const star = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');

const html = `<!doctype html>
<html><head><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    position: relative;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 28px;
    font-family: 'Arial Black', 'DejaVu Sans', system-ui, sans-serif;
    color: #f4ecff;
    background:
      radial-gradient(ellipse 80% 55% at 50% -10%, rgb(255 43 214 / 0.45), transparent 70%),
      radial-gradient(ellipse 60% 45% at 100% 100%, rgb(41 243 255 / 0.2), transparent 70%),
      #0b0221;
  }
  .floor {
    position: absolute; inset: auto 0 0; height: 300px; z-index: -1;
    background:
      linear-gradient(to bottom, #0b0221, transparent 45%),
      repeating-linear-gradient(90deg, rgb(41 243 255 / 0.25) 0 2px, transparent 2px 70px),
      repeating-linear-gradient(0deg, rgb(255 43 214 / 0.25) 0 2px, transparent 2px 46px);
    transform: perspective(320px) rotateX(55deg);
    transform-origin: bottom;
  }
  .star svg { width: 120px; height: 120px; filter: drop-shadow(0 0 18px rgb(255 43 214 / 0.8)); }
  h1 {
    margin: 0; font-size: 118px; font-weight: 900; line-height: 1; letter-spacing: -0.02em; text-transform: uppercase;
  }
  .w { color: #fff; text-shadow: 0 0 6px #fff, 0 0 22px #ff2bd6, 0 0 48px #ff2bd6; }
  .ai { color: #29f3ff; text-shadow: 0 0 6px #29f3ff, 0 0 26px #29f3ff, 0 0 56px #29f3ff; }
  p {
    margin: 0; font-family: system-ui, 'DejaVu Sans', sans-serif; font-size: 40px; font-weight: 700;
    color: #ffe600; text-shadow: 0 0 16px rgb(255 230 0 / 0.55);
  }
  .url {
    position: absolute; bottom: 30px; right: 40px;
    font: 700 26px system-ui, 'DejaVu Sans', sans-serif; color: #29f3ff; letter-spacing: 0.04em;
  }
</style></head>
<body>
  <div class="floor"></div>
  <div class="star">${star}</div>
  <h1><span class="w">True</span><span class="ai">AI</span><span class="w">Gaming</span></h1>
  <p>Real games. Built with AI. Free to play, right now.</p>
  <div class="url">trueaigaming.com</div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: out, type: 'png' });
  console.log(`Saved ${out}`);
} finally {
  await browser.close();
}
