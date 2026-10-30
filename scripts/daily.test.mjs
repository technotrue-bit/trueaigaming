// Today's Flag on the home page must show the same challenge as Flag Catch. These days are pinned in Flag Catch's
// src/daily.test.ts too ("keeps these pinned days the same"); if either side changes, both tests must change. Run
// with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyFor, dayKey, goalText } from '../src/shared/daily.mjs';

const line = (/** @type {string} */ k) => {
  const d = dailyFor(k);
  return `${d.world} ${d.animal} ${d.mode} ${d.per} ${d.difficulty} ${d.goal.kind}${d.goal.n}`;
};

test('matches the days pinned in Flag Catch', () => {
  assert.deepEqual(Object.fromEntries(['2026-11-01', '2026-11-02', '2026-12-25', '2027-02-28'].map((k) => [k, line(k)])), {
    '2026-11-01': 'lava bat playful 8 medium steals3',
    '2026-11-02': 'home mammoth capture 16 easy win1',
    '2026-12-25': 'lava lion capture 16 medium knockouts4',
    '2027-02-28': 'bluffs wolf capture 8 easy steals2',
  });
});

test('a date and its key give the same challenge, all day', () => {
  assert.deepEqual(dailyFor(new Date(2026, 10, 1, 0, 1)), dailyFor('2026-11-01'));
  assert.deepEqual(dailyFor(new Date(2026, 10, 1, 23, 59)), dailyFor('2026-11-01'));
  assert.equal(dayKey(new Date(2027, 0, 5)), '2027-01-05');
});

test('names the world, animal and goal for the card', () => {
  const d = dailyFor('2026-11-01');
  assert.equal(d.worldName, 'Lava Loop');
  assert.equal(d.animalName, 'Night Bat');
  assert.equal(goalText(d), 'Grab 3 flags');
  assert.equal(goalText({ goal: { kind: 'banks', n: 1 } }), 'Score a flag yourself');
});

test("reads today's standing from this device's copy of the game's save", async () => {
  const { standing } = await import('../src/shared/daily.mjs');
  const copy = (/** @type {unknown} */ daily) => ({ 'flagcatch.progress': JSON.stringify({ points: 10, daily }) });
  assert.deepEqual(standing(copy({ last: '2026-11-02', streak: 3, best: 3 }), '2026-11-02'), { done: true, streak: 3 });
  assert.deepEqual(standing(copy({ last: '2026-11-01', streak: 3, best: 3 }), '2026-11-02'), { done: false, streak: 3 });
  assert.deepEqual(standing(copy({ last: '2026-10-30', streak: 3, best: 3 }), '2026-11-02'), { done: false, streak: 0 });
  assert.deepEqual(standing({}, '2026-11-02'), { done: false, streak: 0 });
  assert.deepEqual(standing({ 'flagcatch.progress': '{oops' }, '2026-11-02'), { done: false, streak: 0 });
});
