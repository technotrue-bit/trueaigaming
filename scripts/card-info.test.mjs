// Card info button: rendered only for games with howItWasMade, panel starts hidden. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHtml } from './seo.mjs';

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
