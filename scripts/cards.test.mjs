// Home-page cards: info button, player chips, link styles, and the "more games soon" placeholder. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cardHtml, gamePageHtml, gridHtml, loadGames } from './seo.mjs';

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
  assert.match(html, /<a class="card-cover" href="https:\/\/ext\.example\/play" target="_blank" rel="noopener noreferrer" aria-label="Play Ext Game">/);
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
  assert.match(html, /<a class="gp-shot card-cover" href="https:\/\/ext\.example\/play" target="_blank" rel="noopener noreferrer"/);
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
