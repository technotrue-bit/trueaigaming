// Ko-fi tip link: in the home and game-page footers, never on the play page. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KOFI_URL, gamePageHtml, loadGames } from './seo.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), 'utf8');
const TIP = `<p class="tip">Tips keep the games free. <a class="btn btn-tip" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a></p>`;
const footer = (/** @type {string} */ html) => html.match(/<footer class="footer wrap">[\s\S]*?<\/footer>/)?.[0] ?? '';

test('Ko-fi URL', () => assert.equal(KOFI_URL, 'https://ko-fi.com/X3K0291W5Z'));

test('home footer has the tip link', () => assert.ok(footer(read('index.html')).includes(TIP)));

test('every game page footer has the tip link', () => {
  const games = loadGames();
  assert.ok(games.length > 0);
  for (const g of games) assert.ok(footer(gamePageHtml(g)).includes(TIP), g.id);
});

test('play page has no tip link', () => assert.ok(!/ko-fi/i.test(read('play.html') + read('src/play.ts'))));

test('tip copy makes no ad/cookie/tracker promises', () => {
  assert.doesNotMatch(TIP, /ad-free|no ads|no cookies|no trackers/i);
});
