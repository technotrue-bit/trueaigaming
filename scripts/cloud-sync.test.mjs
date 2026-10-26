// Account saves on the play page (src/shared/cloud-sync.mjs). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveSync, MAX_SAVE_BYTES, saveBytes } from '../src/shared/cloud-sync.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (sync) => {
  for (let i = 0; i < 50 && (sync.busy || i < 3); i++) await tick();
};

/** An in-memory account row with the same rules as the database: inserts once, updates only at the current revision. */
function memoryStore(start = null) {
  const db = { row: start, writes: 0, down: false };
  return {
    db,
    async read() {
      if (db.down) throw new Error('offline');
      return db.row && { data: structuredClone(db.row.data), revision: db.row.revision };
    },
    async insert(data) {
      if (db.down) throw new Error('offline');
      if (db.row) return 'conflict';
      db.writes++;
      db.row = { data: structuredClone(data), revision: 1 };
      return 1;
    },
    async update(data, revision) {
      if (db.down) throw new Error('offline');
      if (!db.row || db.row.revision !== revision) return 'conflict';
      db.writes++;
      db.row = { data: structuredClone(data), revision: revision + 1 };
      return db.row.revision;
    },
  };
}

test('a first save with no account copy inserts, then updates at each revision', async () => {
  const store = memoryStore();
  const sent = [];
  const sync = createSaveSync({ store, send: (d) => sent.push(d) });
  await sync.ready();
  assert.deepEqual(sent, [null]);
  sync.save({ points: 10 });
  await settle(sync);
  sync.save({ points: 20 });
  await settle(sync);
  assert.deepEqual(store.db.row, { data: { points: 20 }, revision: 2 });
});

test('hands the account copy to the game on ready', async () => {
  const store = memoryStore({ data: { points: 99 }, revision: 7 });
  const sent = [];
  const sync = createSaveSync({ store, send: (d) => sent.push(d) });
  await sync.ready();
  assert.deepEqual(sent, [{ points: 99 }]);
  sync.save({ points: 100 });
  await settle(sync);
  assert.deepEqual(store.db.row, { data: { points: 100 }, revision: 8 });
});

test('never writes before the account copy has been read', async () => {
  const store = memoryStore({ data: { points: 500 }, revision: 3 });
  const sync = createSaveSync({ store, send: () => {} });
  sync.save({ points: 1 });
  await settle(sync);
  assert.equal(store.db.writes, 0);
  await sync.ready();
  await sync.retry();
  await settle(sync);
  assert.deepEqual(store.db.row, { data: { points: 1 }, revision: 4 });
});

test('another device saving in between: reads again instead of overwriting', async () => {
  const store = memoryStore({ data: { points: 5 }, revision: 1 });
  const sent = [];
  const sync = createSaveSync({ store, send: (d) => sent.push(d) });
  await sync.ready();
  store.db.row = { data: { points: 50, from: 'other phone' }, revision: 2 };
  sync.save({ points: 6 });
  await settle(sync);
  assert.deepEqual(store.db.row, { data: { points: 50, from: 'other phone' }, revision: 2 }, 'nothing overwritten');
  assert.deepEqual(sent.at(-1), { points: 50, from: 'other phone' }, 'game gets the newer copy to merge');
  sync.save({ points: 51, merged: true });
  await settle(sync);
  assert.deepEqual(store.db.row, { data: { points: 51, merged: true }, revision: 3 });
});

test('two devices that both start with no account copy: the second one merges', async () => {
  const store = memoryStore();
  const a = createSaveSync({ store, send: () => {} });
  const sentB = [];
  const b = createSaveSync({ store, send: (d) => sentB.push(d) });
  await a.ready();
  await b.ready();
  a.save({ from: 'a' });
  await settle(a);
  b.save({ from: 'b' });
  await settle(b);
  assert.deepEqual(store.db.row.data, { from: 'a' });
  assert.deepEqual(sentB.at(-1), { from: 'a' });
});

test('offline: keeps the newest save and writes it when back online', async () => {
  const store = memoryStore();
  const errors = [];
  const sync = createSaveSync({ store, send: () => {}, onError: (e) => errors.push(e.message) });
  await sync.ready();
  store.db.down = true;
  sync.save({ points: 1 });
  await settle(sync);
  sync.save({ points: 2 });
  await settle(sync);
  assert.equal(store.db.row, null);
  assert.ok(errors.length >= 1);
  store.db.down = false;
  await sync.retry();
  await settle(sync);
  assert.deepEqual(store.db.row, { data: { points: 2 }, revision: 1 });
});

test('offline at start: reads the account copy on retry before writing', async () => {
  const store = memoryStore({ data: { points: 70 }, revision: 4 });
  store.db.down = true;
  const sent = [];
  const sync = createSaveSync({ store, send: (d) => sent.push(d), onError: () => {} });
  await sync.ready();
  sync.save({ points: 3 });
  await settle(sync);
  store.db.down = false;
  await sync.retry();
  await settle(sync);
  assert.deepEqual(sent, [{ points: 70 }]);
  assert.equal(store.db.row.revision, 5);
});

test('refuses saves that are too big or not objects', () => {
  const sync = createSaveSync({ store: memoryStore(), send: () => {} });
  assert.equal(sync.save({ x: 'a'.repeat(MAX_SAVE_BYTES) }), false);
  assert.equal(sync.save([1, 2]), false);
  assert.equal(sync.save(null), false);
  assert.equal(sync.save('text'), false);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(saveBytes(cyclic), Infinity);
  assert.equal(saveBytes({ a: 'é' }), 10);
});
