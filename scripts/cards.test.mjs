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

test('play in browser is a text link, not a second gold button', () => {
  const html = cardHtml(base, 0);
  assert.match(html, /<a class="btn btn-link" href="https:\/\/example\.com"[^>]*>Play in browser/);
  assert.ok(!html.includes('btn-ghost'));
});

test('grid always ends with the "more games soon" placeholder', () => {
  assert.match(gridHtml([]), /class="empty"[\s\S]*card-soon/);
  assert.match(gridHtml([base]), /card-soon-text">More games soon<\/p><\/li>$/);
});

const BLOB = 'https://abc123.public.blob.vercel-storage.com/thumbs/ext.png';
const external = { ...base, id: 'ext-game', name: 'Ext Game', playUrl: 'https://ext.example/play', thumbnail: BLOB, external: true };

test('external card: primary Play goes to playUrl in a new tab, no /play.html link', () => {
  const html = cardHtml(external, 0);
  assert.ok(html.includes('<a class="btn btn-primary" href="https://ext.example/play" target="_blank" rel="noopener noreferrer">Play</a>'));
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

test('user game card keeps its /play.html cover and Play here button', () => {
  const html = cardHtml(base, 0);
  assert.match(html, /<a class="card-cover" href="\/play\.html\?id=demo"/);
  assert.match(html, /<a class="btn btn-primary" href="\/play\.html\?id=demo">Play here<\/a>/);
});

test('external game page: Play buttons open playUrl in a new tab, no /play.html link', () => {
  const html = gamePageHtml(external);
  assert.ok(html.includes('<a class="btn btn-primary btn-lg" href="https://ext.example/play" target="_blank" rel="noopener noreferrer">Play</a>'));
  assert.match(html, /<a class="gp-shot card-cover" href="https:\/\/ext\.example\/play" target="_blank" rel="noopener noreferrer" aria-label="Play Ext Game \(opens in a new tab\)">/);
  assert.ok(!html.includes('/play.html'));
  assert.ok(!html.includes('Play in browser'));
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

test('hosted game page keeps its /play.html Play buttons and Play in browser link', () => {
  const html = gamePageHtml(base);
  assert.ok(html.includes('<a class="btn btn-primary btn-lg" href="/play.html?id=demo">Play here</a>'));
  assert.ok(html.includes('<a class="btn btn-ghost" href="https://example.com" target="_blank" rel="noopener">Play in browser ↗</a>'));
  assert.ok(html.includes('<a class="gp-shot card-cover" href="/play.html?id=demo" aria-label="Play Demo">'));
});

test('home.ts and seo.mjs use the same external cover label suffix', () => {
  const suffix = ' (opens in a new tab)';
  assert.ok(readFileSync(join(ROOT, 'src/home.ts'), 'utf8').includes(suffix));
  assert.ok(readFileSync(join(ROOT, 'scripts/seo.mjs'), 'utf8').includes(suffix));
});
