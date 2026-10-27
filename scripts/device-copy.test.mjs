// The play page's device copy of a game's storage (src/shared/device-copy.mjs). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_KEYS, MAX_VALUE_LENGTH, applyPut, readCopy, storageKey, writeCopy } from '../src/shared/device-copy.mjs';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('a write and a removal round trip through the storage', () => {
  const s = memoryStorage();
  let copy = readCopy(s, 'flag-catch');
  assert.deepEqual(copy, {});
  copy = applyPut(copy, 'flagcatch.progress', '{"points":5}');
  copy = applyPut(copy, 'flagcatch.animal', 'croc');
  assert.ok(writeCopy(s, 'flag-catch', copy));
  assert.deepEqual(readCopy(s, 'flag-catch'), { 'flagcatch.progress': '{"points":5}', 'flagcatch.animal': 'croc' });
  copy = applyPut(readCopy(s, 'flag-catch'), 'flagcatch.animal', null);
  writeCopy(s, 'flag-catch', copy);
  assert.deepEqual(readCopy(s, 'flag-catch'), { 'flagcatch.progress': '{"points":5}' });
  assert.deepEqual(readCopy(s, 'other-game'), {});
});

test('writes past the limits are refused and leave the copy as it was', () => {
  const copy = { a: '1' };
  assert.equal(applyPut(copy, '', 'x'), null);
  assert.equal(applyPut(copy, 'k'.repeat(65), 'x'), null);
  assert.equal(applyPut(copy, 'k', 5), null);
  assert.equal(applyPut(copy, 'k', 'x'.repeat(MAX_VALUE_LENGTH + 1)), null);
  let many = {};
  for (let i = 0; i < MAX_KEYS; i++) many = applyPut(many, `k${i}`, 'v');
  assert.equal(applyPut(many, 'one-more', 'v'), null);
  assert.deepEqual(copy, { a: '1' });
});

test('an unreadable copy reads as empty, and a refused write says so', () => {
  const s = memoryStorage();
  s.setItem(storageKey('flag-catch'), '{not json');
  assert.deepEqual(readCopy(s, 'flag-catch'), {});
  s.setItem(storageKey('flag-catch'), '{"a":"1","b":2}');
  assert.deepEqual(readCopy(s, 'flag-catch'), { a: '1' });
  assert.equal(writeCopy({ setItem() { throw new Error('full'); } }, 'flag-catch', {}), false);
});
