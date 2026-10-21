// Home-page cards: info button, player chips, link styles, and the "more games soon" placeholder. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHtml, gridHtml } from './seo.mjs';

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
