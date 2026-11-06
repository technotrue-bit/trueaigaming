// The seasonal card only changes when the game's look does. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsRetake } from './seasonal-card.mjs';

test('the card is retaken only when the look changes, or when forced', () => {
  assert.equal(needsRetake('autumn', 'autumn'), false);
  assert.equal(needsRetake('autumn', 'plain'), true);
  assert.equal(needsRetake('halloween', 'autumn'), true);
  assert.equal(needsRetake(undefined, 'autumn'), true);
  assert.equal(needsRetake('autumn', 'autumn', true), true);
});

test('a poster that names no look never replaces the card', () => {
  assert.equal(needsRetake('autumn', null), false);
  assert.equal(needsRetake('autumn', null, true), false);
});

test('the card looks file says what the current card shows', () => {
  const looks = JSON.parse(readFileSync(join(import.meta.dirname, 'card-looks.json'), 'utf8'));
  assert.ok(['halloween', 'autumn', 'plain'].includes(looks['squishy-closet']));
});
