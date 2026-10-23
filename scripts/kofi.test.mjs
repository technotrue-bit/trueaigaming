// Ko-fi tip link: in the home and game-page footers, under the game page's Play buttons, and in the play page's control pill. Run with `npm test`.
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

test('every game page has a tip line under its Play buttons', () => {
  for (const g of loadGames()) {
    const html = gamePageHtml(g);
    const actionsEnd = html.indexOf('</div>', html.indexOf('<div class="gp-actions">'));
    const tip = html.indexOf(`<p class="gp-tip">Enjoying it? Tips keep the games free. <a class="btn btn-tip" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a></p>`);
    assert.ok(tip > actionsEnd && actionsEnd > 0, g.id);
  }
});

test('play page control pill has a Ko-fi button that opens a new tab', () => {
  const hud = read('play.html').match(/<nav id="hud"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.ok(
    hud.includes(`<a id="kofi" class="hud-btn hud-emoji" href="${KOFI_URL}" target="_blank" rel="noopener" aria-label="Support TrueAIGaming on Ko-fi (opens in a new tab)">`),
  );
});

test('tip copy makes no ad/cookie/tracker promises', () => {
  assert.doesNotMatch(TIP, /ad-free|no ads|no cookies|no trackers/i);
});
