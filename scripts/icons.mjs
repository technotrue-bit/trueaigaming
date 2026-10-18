// Render favicons from public/favicon.svg (the neon star): favicon.ico (16/32/48),
// favicon-32.png, apple-touch-icon.png (180, opaque), icon-192.png and icon-512.png.
// Usage: node scripts/icons.mjs
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const PUBLIC = new URL('../public/', import.meta.url);
const BG = '#0b0221';
const svg = await readFile(new URL('favicon.svg', PUBLIC), 'utf8');

/**
 * Screenshot the SVG at size x size. `opaque` fills the square with the background and pads the
 * star a little (iOS rounds the corners itself and shows black behind transparency).
 */
async function render(page, size, { opaque = false } = {}) {
  const inner = opaque ? Math.round(size * 0.86) : size;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${opaque ? BG : 'transparent'}">
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${inner}" height="${inner}" style="display:block">
    </body></html>`,
    { waitUntil: 'load' },
  );
  return page.screenshot({ type: 'png', omitBackground: !opaque });
}

/** ICO container with PNG-compressed entries (supported by every current browser and Windows Vista+). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colors
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const save = async (name, buf) => {
    await writeFile(new URL(name, PUBLIC), buf);
    console.log(`Saved public/${name}`);
  };

  const icoImages = [];
  for (const size of [16, 32, 48]) icoImages.push({ size, png: await render(page, size) });
  await save('favicon.ico', ico(icoImages));
  await save('favicon-32.png', icoImages[1].png);
  await save('apple-touch-icon.png', await render(page, 180, { opaque: true }));
  await save('icon-192.png', await render(page, 192));
  await save('icon-512.png', await render(page, 512));
} finally {
  await browser.close();
}
