// Home-page cards (info button, player chips, link styles, "more games soon", external games), loadGames and gamePageHtml. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cardHtml, gamePageHtml, gridHtml, loadGames } from './seo.mjs';

const ROOT = join(import.meta.dirname, '..');

const base = {
  id: 'demo',
  name: 'Demo',
  description: 'A demo game',
  playUrl: 'https://example.com',
  thumbnail: '/thumbs/demo.png',
  thumbSize: { width: 1280, height: 720 },
  status: 'live',
  author: 'Tester',
};

test('card with howItWasMade gets an info button and a hidden panel', () => {
  const html = cardHtml({ ...base, howItWasMade: 'Made with AI.' }, 0);
  assert.match(html, /<button class="card-info" type="button" aria-expanded="false" aria-controls="how-demo"/);
  assert.match(html, /<div class="card-how" id="how-demo" hidden><p>Made with AI\.<\/p><\/div>/);
});

test('card without howItWasMade has no info button or panel', () => {
  const html = cardHtml(base, 0);
  assert.ok(!html.includes('card-info'));
  assert.ok(!html.includes('card-how'));
});

test('card shows the player range from minPlayers and maxPlayers', () => {
  assert.match(cardHtml({ ...base, minPlayers: 1, maxPlayers: 4 }, 0), /<ul class="card-facts"><li>1–4 players<\/li><\/ul>/);
  assert.match(cardHtml({ ...base, minPlayers: 2, maxPlayers: 2 }, 0), /<li>2 players<\/li>/);
  assert.ok(!cardHtml(base, 0).includes('card-facts'));
});

test('card has one Play button: no "Play in browser" link, no second gold button', () => {
  const html = cardHtml(base, 0);
  assert.equal(html.match(/>Play now</g)?.length, 1);
  assert.ok(!html.includes('Play in browser'));
  assert.ok(!html.includes('href="https://example.com"'));
  assert.ok(!html.includes('btn-ghost'));
});

test('card uses a <picture> with the WebP source when the game has one', () => {
  const html = cardHtml({ ...base, thumbnailWebp: '/thumbs/demo.webp' }, 0);
  assert.ok(html.includes('<picture><source type="image/webp" srcset="/thumbs/demo.webp" /><img src="/thumbs/demo.png" alt="Demo screenshot"'));
  assert.ok(html.includes('</picture><span class="status status-live">'));
});

test('card without a WebP keeps a plain <img>', () => {
  const html = cardHtml(base, 0);
  assert.ok(!html.includes('<picture>'));
  assert.ok(html.includes('<img src="/thumbs/demo.png" alt="Demo screenshot"'));
});

test('game page uses the WebP source too, and keeps the PNG for social cards', () => {
  const html = gamePageHtml({ ...base, thumbnailWebp: '/thumbs/demo.webp' });
  assert.ok(html.includes('<picture><source type="image/webp" srcset="/thumbs/demo.webp" /><img src="/thumbs/demo.png"'));
  assert.ok(html.includes('<meta property="og:image" content="https://trueaigaming.com/thumbs/demo.png" />'));
});

test('loadGames finds the WebP next to a local PNG thumbnail', () => {
  const ssp = loadGames().find((g) => g.id === 'super-star-party');
  assert.equal(ssp?.thumbnailWebp, '/thumbs/super-star-party.webp');
});

test('grid always ends with the "more games soon" placeholder', () => {
  assert.match(gridHtml([]), /class="empty"[\s\S]*card-soon/);
  assert.match(gridHtml([base]), /card-soon-text">More games soon<\/p><\/li>$/);
});

const BLOB = 'https://abc123.public.blob.vercel-storage.com/thumbs/ext.png';
const external = { ...base, id: 'ext-game', name: 'Ext Game', playUrl: 'https://ext.example/play', thumbnail: BLOB, external: true };

test('external card: primary Play goes to playUrl in a new tab, no /play.html link', () => {
  const html = cardHtml(external, 0);
  assert.ok(html.includes('<a class="btn btn-primary btn-play" href="https://ext.example/play" target="_blank" rel="noopener noreferrer">Play now</a>'));
  assert.match(html, /<a class="card-cover" href="https:\/\/ext\.example\/play" target="_blank" rel="noopener noreferrer" aria-label="Play Ext Game \(opens in a new tab\)">/);
  assert.ok(html.includes(`<img src="${BLOB}"`));
  assert.ok(!html.includes('/play.html'));
});

test('external card: no "Play in browser" duplicate, Source link kept', () => {
  const html = cardHtml({ ...external, repo: 'https://github.com/example/ext' }, 0);
  assert.ok(!html.includes('Play in browser'));
  assert.ok(!html.includes('btn-link" href="https://ext.example/play"'));
  assert.match(html, /<a class="btn btn-link" href="https:\/\/github\.com\/example\/ext" target="_blank" rel="noopener">Source<\/a>/);
});

test('user game card keeps its /play.html cover and Play now button', () => {
  const html = cardHtml(base, 0);
  assert.match(html, /<a class="card-cover" href="\/play\.html\?id=demo"/);
  assert.match(html, /<a class="btn btn-primary btn-play" href="\/play\.html\?id=demo">Play now<\/a>/);
});

test('external game page: Play buttons open playUrl in a new tab, no /play.html link', () => {
  const html = gamePageHtml(external);
  assert.ok(html.includes('<a class="btn btn-primary btn-lg" href="https://ext.example/play" target="_blank" rel="noopener noreferrer">Play now</a>'));
  assert.match(html, /<a class="gp-shot card-cover" href="https:\/\/ext\.example\/play" target="_blank" rel="noopener noreferrer" aria-label="Play Ext Game \(opens in a new tab\)">/);
  assert.ok(!html.includes('/play.html'));
  assert.ok(!html.includes('Open in a new tab'));
});

/** Writes a games.json fixture into a temp folder that the test removes afterwards. */
function gamesFile(t, entries) {
  const dir = mkdtempSync(join(tmpdir(), 'games-json-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  writeFileSync(file, JSON.stringify(entries));
  return file;
}

const entry = { id: 'ext-game', name: 'Ext Game', description: 'A demo game', playUrl: 'https://ext.example/play', status: 'live' };

test('loadGames accepts an https blob thumbnail, keeps external, and uses the default thumbSize', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const [game] = loadGames(gamesFile(t, [{ ...entry, thumbnail: BLOB, external: true }]));
  assert.equal(game.thumbnail, BLOB);
  assert.deepEqual(game.thumbSize, { width: 1280, height: 720 });
  assert.equal(game.external, true);
  assert.equal(warn.mock.callCount(), 0);
});

test('loadGames rejects remote thumbnails that are not https Vercel Blob URLs', (t) => {
  const bad = [
    'https://example.com/shot.png',
    'http://abc123.public.blob.vercel-storage.com/shot.png',
    'https://abc123.public.blob.vercel-storage.com.example.com/shot.png',
    'https://public.blob.vercel-storage.com.example.com/shot.png',
  ];
  const warn = t.mock.method(console, 'warn', () => {});
  for (const thumbnail of bad) {
    assert.deepEqual(loadGames(gamesFile(t, [{ ...entry, thumbnail }])), [], thumbnail);
  }
  assert.equal(warn.mock.callCount(), bad.length);
});

const CREDENTIALED = 'https://user:pw@abc123.public.blob.vercel-storage.com/thumbs/ext.png';

test('loadGames rejects a blob thumbnail that carries credentials, and never echoes them', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.deepEqual(loadGames(gamesFile(t, [{ ...entry, thumbnail: CREDENTIALED }])), []);
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(!JSON.stringify(warn.mock.calls.map((c) => c.arguments)).includes('pw'));
});

test('the skip warning for an entry with no id or name never prints the raw entry', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const unnamed = { thumbnail: CREDENTIALED, playUrl: 'https://ext.example/play', status: 'live' };
  assert.deepEqual(loadGames(gamesFile(t, [unnamed])), []);
  assert.equal(warn.mock.callCount(), 1);
  const printed = JSON.stringify(warn.mock.calls.map((c) => c.arguments));
  assert.ok(!printed.includes('user'));
  assert.ok(!printed.includes('pw'));
});

/** src/games.ts with no bundler: type-stripped, its CSS import dropped and its shared import pointed at the file. */
async function importBrowserGames() {
  const shared = pathToFileURL(join(ROOT, 'src/shared/submission-rules.mjs')).href;
  const source = readFileSync(join(ROOT, 'src/games.ts'), 'utf8')
    .replace("import './style.css';", '')
    .replace("'./shared/submission-rules.mjs'", JSON.stringify(shared));
  const js = stripTypeScriptTypes(source);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('browser loader (src/games.ts) rejects credentialed blob thumbnails and keeps plain ones', async (t) => {
  const { loadGames: loadBrowserGames } = await importBrowserGames();
  const respond = (thumbnail) => async () => ({ ok: true, json: async () => [{ ...entry, thumbnail }] });

  t.mock.method(globalThis, 'fetch', respond(CREDENTIALED));
  assert.deepEqual(await loadBrowserGames(), []);

  t.mock.method(globalThis, 'fetch', respond(BLOB));
  const games = await loadBrowserGames();
  assert.equal(games.length, 1);
  assert.equal(games[0].thumbnail, BLOB);
});

test('src/games.ts keeps a same-origin thumbnailWebp and drops any other', async (t) => {
  const { loadGames: loadBrowserGames } = await importBrowserGames();
  const respond = (thumbnailWebp) => async () => ({ ok: true, json: async () => [{ ...entry, thumbnail: '/thumbs/ext.png', thumbnailWebp }] });

  t.mock.method(globalThis, 'fetch', respond('/thumbs/ext.webp'));
  assert.equal((await loadBrowserGames())[0].thumbnailWebp, '/thumbs/ext.webp');

  t.mock.method(globalThis, 'fetch', respond('https://evil.example/x.webp'));
  assert.equal((await loadBrowserGames())[0].thumbnailWebp, undefined);
});

test('hosted game page: big Play now button, and a quieter new-tab link', () => {
  const html = gamePageHtml(base);
  assert.ok(html.includes('<a class="btn btn-primary btn-lg" href="/play.html?id=demo">Play now</a>'));
  assert.ok(html.includes('<a class="btn btn-link" href="https://example.com" target="_blank" rel="noopener">Open in a new tab ↗</a>'));
  assert.ok(!html.includes('btn-ghost'));
  assert.ok(html.includes('<a class="gp-shot card-cover" href="/play.html?id=demo" aria-label="Play Demo">'));
});

test('home.ts and seo.mjs use the same external cover label suffix', () => {
  const suffix = ' (opens in a new tab)';
  assert.ok(readFileSync(join(ROOT, 'src/home.ts'), 'utf8').includes(suffix));
  assert.ok(readFileSync(join(ROOT, 'scripts/seo.mjs'), 'utf8').includes(suffix));
});

test('loadGames keeps cloudSave, moveCode, deviceCopy and online, only when true and the game is not external', (t) => {
  const thumbnail = '/thumbs/flag-catch.png';
  const games = loadGames(
    gamesFile(t, [
      { ...entry, id: 'saves', thumbnail, cloudSave: true, moveCode: true, deviceCopy: true, online: true },
      { ...entry, id: 'strings', thumbnail, cloudSave: 'true', moveCode: 1, deviceCopy: 'yes', online: 'true' },
      { ...entry, id: 'ext', thumbnail, external: true, cloudSave: true, moveCode: true, deviceCopy: true, online: true },
    ]),
  );
  assert.deepEqual(
    games.map((g) => [g.id, g.cloudSave, g.moveCode, g.deviceCopy, g.online]),
    [
      ['saves', true, true, true, true],
      ['strings', undefined, undefined, undefined, undefined],
      ['ext', undefined, undefined, undefined, undefined],
    ],
  );
});

test('the real games.json keeps account saves on Flag Catch, and the move code and device copy on Aurora\'s World', () => {
  const games = loadGames();
  assert.equal(games.find((g) => g.id === 'flag-catch')?.cloudSave, true);
  assert.equal(games.find((g) => g.id === 'flag-catch')?.online, true);
  const aurora = games.find((g) => g.id === 'squishy-closet');
  assert.equal(aurora?.moveCode, true);
  assert.equal(aurora?.deviceCopy, true);
  // A game for young children: never account saves (see supabase/migrations/0002_game_saves.sql).
  assert.equal(aurora?.cloudSave, undefined);
  assert.equal(aurora?.online, undefined);
});

test('loadGames keeps the four play-page min sizes, rounded to whole pixels', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const [game] = loadGames(
    gamesFile(t, [{ ...entry, thumbnail: BLOB, minWidth: 360.4, minHeight: 600.6, minWidthLandscape: 640, minHeightLandscape: 360 }]),
  );
  assert.equal(game.minWidth, 360);
  assert.equal(game.minHeight, 601);
  assert.equal(game.minWidthLandscape, 640);
  assert.equal(game.minHeightLandscape, 360);
  assert.equal(warn.mock.callCount(), 0);
});

test('loadGames drops a min size outside 200 to 4000 or not a number, and keeps the bounds', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const [game] = loadGames(
    gamesFile(t, [{ ...entry, thumbnail: BLOB, minWidth: 150, minHeight: 4001, minWidthLandscape: '640', minHeightLandscape: 200 }]),
  );
  assert.equal(game.minWidth, undefined);
  assert.equal(game.minHeight, undefined);
  assert.equal(game.minWidthLandscape, undefined);
  assert.equal(game.minHeightLandscape, 200);
  assert.equal(warn.mock.callCount(), 0);
});

test('game page shows About and How it was made sections when set', async () => {
  const { aboutHtml } = await import('./seo.mjs');
  const html = aboutHtml({ ...base, about: 'A <b>fun</b> game.', howItWasMade: 'Made with AI.' });
  assert.match(html, /<h2>About Demo<\/h2>/);
  assert.match(html, /A &lt;b&gt;fun&lt;\/b&gt; game\./);
  assert.match(html, /<h2>How it was made<\/h2>/);
  assert.equal(aboutHtml(base), '');
});
