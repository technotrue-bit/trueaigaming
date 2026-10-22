// Submission logic: create, read, edit and delete your own games, and the thumbnail check. In-memory store and fake rebuild only. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './test-store.mjs';
import {
  checkThumbnail,
  createSubmission,
  deleteSubmission,
  getOwnSubmission,
  submissionInput,
  updateSubmission,
} from './submissions.mjs';

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OWNER = 'owner-1';
const OTHER = 'owner-2';
const NOT_FOUND = { ok: false, status: 404, error: 'Not found' };

/** A uuid-shaped id, so ids look like the ones Postgres generates. */
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (ms) => new Date(ms).toISOString();

/** A valid submission in the camelCase shape the logic takes. */
function input(overrides = {}) {
  return {
    name: 'Star Pie',
    slug: 'star-pie',
    description: 'Catch falling pies before they land',
    howItWasMade: 'Made in a weekend with a sprite sheet',
    playUrl: 'https://example.com/play',
    sourceUrl: null,
    thumbnailUrl: null,
    minPlayers: 1,
    maxPlayers: 4,
    ...overrides,
  };
}

/** A stored row as the test store seeds it. Created two days ago, so the daily cap does not see it. */
function seed(overrides = {}) {
  return {
    id: ID(1),
    owner_id: OWNER,
    slug: 'star-pie',
    name: 'Star Pie',
    status: 'pending',
    created_at: iso(NOW - 2 * DAY),
    ...overrides,
  };
}

/** A fake rebuild that records each call and returns `result`. */
function rebuildSpy(result = { ok: true }) {
  const calls = [];
  return { calls, rebuild: async () => { calls.push(true); return result; } };
}

/** A buffer of `size` bytes that starts with the PNG signature. */
function pngBytes(size = 16) {
  const bytes = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

test('pending cap: sixth pending submission is refused without inserting', async () => {
  const pending = [1, 2, 3, 4, 5].map((n) => seed({ id: ID(n), slug: `old-${n}` }));
  const store = createTestStore({ submissions: pending });
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can have 5 pending submissions at a time' });
  assert.equal(store.state.submissions.size, 5);
});

test('pending cap: four pending submissions still allow a fifth', async () => {
  const pending = [1, 2, 3, 4].map((n) => seed({ id: ID(n), slug: `old-${n}` }));
  const store = createTestStore({ submissions: pending });
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(store.state.submissions.size, 5);
});

test('daily cap: fourth submission in 24 hours is refused', async () => {
  const recent = [1, 2, 3].map((n) => seed({ id: ID(n), slug: `recent-${n}`, status: 'approved', created_at: iso(NOW - HOUR) }));
  const store = createTestStore({ submissions: recent });
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can add 3 new submissions per day' });
  assert.equal(store.state.submissions.size, 3);
});

test('daily cap: submissions older than 24 hours do not count', async () => {
  const old = [1, 2, 3].map((n) => seed({ id: ID(n), slug: `old-${n}`, status: 'approved', created_at: iso(NOW - 25 * HOUR) }));
  const store = createTestStore({ submissions: old });
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.equal(result.ok, true);
});

test('double submit: repeating the same slug creates one row, second gets 409', async () => {
  const store = createTestStore();
  const first = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  const second = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, status: 409, error: 'That game address is taken' });
  assert.equal(store.state.submissions.size, 1);
});

test('non-owner GET and PATCH return 404, not 403', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy();
  assert.deepEqual(await getOwnSubmission({ store, ownerId: OTHER, id: ID(1) }), NOT_FOUND);
  assert.deepEqual(
    await updateSubmission({ store, ownerId: OTHER, id: ID(1), input: input({ name: 'Hijacked' }), now: NOW, rebuild: spy.rebuild }),
    NOT_FOUND,
  );
  assert.equal(store.state.submissions.get(ID(1)).name, 'Star Pie');
  assert.equal(store.state.submissions.get(ID(1)).status, 'approved');
  assert.equal(spy.calls.length, 0);
});

test('non-owner DELETE returns 404 and keeps the row, and a missing id looks the same', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy();
  assert.deepEqual(await deleteSubmission({ store, ownerId: OTHER, id: ID(1), rebuild: spy.rebuild }), NOT_FOUND);
  assert.deepEqual(await deleteSubmission({ store, ownerId: OWNER, id: ID(9), rebuild: spy.rebuild }), NOT_FOUND);
  assert.equal(store.state.submissions.has(ID(1)), true);
  assert.equal(spy.calls.length, 0);
});

test('a malformed id is not found', async () => {
  const store = createTestStore({ submissions: [seed()] });
  assert.deepEqual(await getOwnSubmission({ store, ownerId: OWNER, id: 'not-a-uuid' }), NOT_FOUND);
});

test('editing an approved submission sets pending and calls rebuild once', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy();
  const result = await updateSubmission({
    store, ownerId: OWNER, id: ID(1), input: input({ name: 'Star Pie Deluxe' }), now: NOW, rebuild: spy.rebuild,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.wasApproved, true);
  assert.equal(result.value.submission.status, 'pending');
  assert.equal(result.value.submission.name, 'Star Pie Deluxe');
  assert.deepEqual(result.value.rebuild, { ok: true });
  assert.equal(spy.calls.length, 1);
});

test('editing a rejected submission sets pending, clears the review note, and does not rebuild', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'rejected', review_note: 'Describe the game more' })] });
  const spy = rebuildSpy();
  const result = await updateSubmission({ store, ownerId: OWNER, id: ID(1), input: input(), now: NOW, rebuild: spy.rebuild });
  assert.equal(result.ok, true);
  assert.equal(result.value.wasApproved, false);
  assert.equal(result.value.submission.status, 'pending');
  assert.equal(result.value.submission.review_note, null);
  assert.equal(result.value.rebuild, null);
  assert.equal(spy.calls.length, 0);
});

test('deleting an approved submission calls rebuild once', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy();
  const result = await deleteSubmission({ store, ownerId: OWNER, id: ID(1), rebuild: spy.rebuild });
  assert.deepEqual(result, { ok: true, value: { wasApproved: true, rebuild: { ok: true } } });
  assert.equal(store.state.submissions.has(ID(1)), false);
  assert.equal(spy.calls.length, 1);
});

test('deleting a pending submission does not call rebuild', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'pending' })] });
  const spy = rebuildSpy();
  const result = await deleteSubmission({ store, ownerId: OWNER, id: ID(1), rebuild: spy.rebuild });
  assert.deepEqual(result, { ok: true, value: { wasApproved: false, rebuild: null } });
  assert.equal(store.state.submissions.has(ID(1)), false);
  assert.equal(spy.calls.length, 0);
});

test('deleting an approved submission still rebuilds when the delete commits and then throws', async () => {
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const remove = store.deleteSubmission;
  store.deleteSubmission = async (id) => { await remove(id); throw new Error('connection reset'); };
  const spy = rebuildSpy();
  await assert.rejects(deleteSubmission({ store, ownerId: OWNER, id: ID(1), rebuild: spy.rebuild }), /connection reset/);
  assert.equal(store.state.submissions.has(ID(1)), false);
  assert.equal(spy.calls.length, 1);
});

test('a rebuild that fails after an edit still saves the edit', async (t) => {
  t.mock.method(console, 'error', () => {});
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy({ ok: false, error: 'Rebuild hook returned 500' });
  const result = await updateSubmission({ store, ownerId: OWNER, id: ID(1), input: input({ name: 'Edited' }), now: NOW, rebuild: spy.rebuild });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(store.state.submissions.get(ID(1)).name, 'Edited');
  assert.equal(store.state.submissions.get(ID(1)).status, 'pending');
});

test('a rebuild that throws after an edit still saves the edit', async (t) => {
  t.mock.method(console, 'error', () => {});
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const result = await updateSubmission({
    store, ownerId: OWNER, id: ID(1), input: input({ name: 'Edited' }), now: NOW,
    rebuild: async () => { throw new Error('boom'); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(store.state.submissions.get(ID(1)).name, 'Edited');
});

test('editing to a game address another submission holds returns 409', async () => {
  const store = createTestStore({
    submissions: [seed({ id: ID(1) }), seed({ id: ID(2), owner_id: OTHER, slug: 'taken-slug' })],
  });
  const spy = rebuildSpy();
  const result = await updateSubmission({
    store, ownerId: OWNER, id: ID(1), input: input({ slug: 'taken-slug' }), now: NOW, rebuild: spy.rebuild,
  });
  assert.deepEqual(result, { ok: false, status: 409, error: 'That game address is taken' });
  assert.equal(store.state.submissions.get(ID(1)).slug, 'star-pie');
  assert.equal(spy.calls.length, 0);
});

test('createSubmission creates a pending row owned by the caller', async () => {
  const store = createTestStore();
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.value.owner_id, OWNER);
  assert.equal(result.value.status, 'pending');
  assert.equal(result.value.slug, 'star-pie');
  assert.equal(result.value.min_players, 1);
  assert.equal(result.value.max_players, 4);
  assert.equal(store.state.submissions.size, 1);
});

test('a validation error returns 400 and inserts nothing', async () => {
  const store = createTestStore();
  const result = await createSubmission({ store, ownerId: OWNER, input: input({ name: '' }), now: NOW });
  assert.deepEqual(result, { ok: false, status: 400, error: 'Name is required' });
  assert.equal(store.state.submissions.size, 0);
});

test('the stored links are the canonical hrefs from validateSubmission, not the raw input', async () => {
  const store = createTestStore();
  const result = await createSubmission({
    store, ownerId: OWNER, now: NOW,
    input: input({
      playUrl: ' HTTPS://Example.com/play ',
      thumbnailUrl: 'HTTPS://store.public.blob.vercel-storage.com/thumb.png',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.play_url, 'https://example.com/play');
  assert.equal(result.value.thumbnail_url, 'https://store.public.blob.vercel-storage.com/thumb.png');
});

test('thumbnail: a thumbnail URL from another host is refused with 400', async () => {
  const store = createTestStore();
  const result = await createSubmission({
    store, ownerId: OWNER, input: input({ thumbnailUrl: 'https://example.com/thumb.png' }), now: NOW,
  });
  assert.deepEqual(result, { ok: false, status: 400, error: 'Thumbnail must be hosted on Vercel Blob' });
  assert.equal(store.state.submissions.size, 0);
});

test('thumbnail: a thumbnail URL with credentials is refused, even on a Blob host', async () => {
  const store = createTestStore();
  const result = await createSubmission({
    store, ownerId: OWNER,
    input: input({ thumbnailUrl: 'https://user:pass@store.public.blob.vercel-storage.com/thumb.png' }),
    now: NOW,
  });
  assert.deepEqual(result, { ok: false, status: 400, error: 'Thumbnail must not include a username or password' });
  assert.equal(store.state.submissions.size, 0);
});

test('submissionInput maps snake_case form fields to camelCase and player counts to numbers', async () => {
  const body = {
    name: 'Star Pie',
    slug: 'star-pie',
    description: 'Catch falling pies',
    how_it_was_made: 'Made in a weekend',
    play_url: 'https://example.com/play',
    source_url: '',
    thumbnail_url: '',
    min_players: '2',
    max_players: ' 16 ',
  };
  assert.deepEqual(submissionInput(body), {
    name: 'Star Pie',
    slug: 'star-pie',
    description: 'Catch falling pies',
    howItWasMade: 'Made in a weekend',
    playUrl: 'https://example.com/play',
    sourceUrl: '',
    thumbnailUrl: '',
    minPlayers: 2,
    maxPlayers: 16,
  });
  // A player count that is not a plain whole number stays text, so validatePlayers refuses it.
  const store = createTestStore();
  const result = await createSubmission({
    store, ownerId: OWNER, now: NOW,
    input: submissionInput({ ...body, min_players: '2.5' }),
  });
  assert.deepEqual(result, { ok: false, status: 400, error: 'Players must be whole numbers from 1 to 16' });
});

test('thumbnail: SVG bytes declared as image/png return 415', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.deepEqual(checkThumbnail(svg, 'image/png'), { ok: false, status: 415, error: 'Upload a PNG, JPEG or WebP image' });
});

test('thumbnail: 1,048,577 bytes return 413', () => {
  assert.deepEqual(checkThumbnail(pngBytes(1_048_577), 'image/png'), { ok: false, status: 413, error: 'Image must be 1 MB or less' });
});

test('thumbnail: exactly 1,048,576 bytes with a PNG signature is allowed', () => {
  assert.deepEqual(checkThumbnail(pngBytes(1_048_576), 'image/png'), { ok: true, value: { extension: 'png' } });
});

test('thumbnail: a valid PNG signature returns ok with extension png', () => {
  assert.deepEqual(checkThumbnail(pngBytes(), 'image/png'), { ok: true, value: { extension: 'png' } });
  // A declared type with parameters, or in another case, still matches.
  assert.deepEqual(checkThumbnail(pngBytes(), 'Image/PNG; charset=binary'), { ok: true, value: { extension: 'png' } });
});

test('thumbnail: JPEG and WebP signatures must match their declared types', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0x00, 0x00, 0x00]), Buffer.from('WEBP')]);
  assert.deepEqual(checkThumbnail(jpeg, 'image/jpeg'), { ok: true, value: { extension: 'jpg' } });
  assert.deepEqual(checkThumbnail(webp, 'image/webp'), { ok: true, value: { extension: 'webp' } });
  assert.equal(checkThumbnail(jpeg, 'image/png').status, 415);
  assert.equal(checkThumbnail(pngBytes(), 'image/jpeg').status, 415);
  assert.equal(checkThumbnail(pngBytes(), 'constructor').status, 415);
});

test('a failed rebuild gives the client a fixed message, and the config name never appears', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy({ ok: false, error: 'DEPLOY_HOOK_URL is not set' });
  const result = await updateSubmission({ store, ownerId: OWNER, id: ID(1), input: input({ name: 'Edited' }), now: NOW, rebuild: spy.rebuild });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(JSON.stringify(result).includes('DEPLOY_HOOK_URL'), false);
  // The reason is still logged on the server.
  assert.equal(logs.mock.calls.some((c) => c.arguments.includes('DEPLOY_HOOK_URL is not set')), true);
});

test('editing a rejected submission when five are already pending is refused with 429', async () => {
  const pending = [1, 2, 3, 4, 5].map((n) => seed({ id: ID(n), slug: `pending-${n}` }));
  const rejected = seed({ id: ID(6), slug: 'rejected-one', status: 'rejected', review_note: 'Describe it' });
  const store = createTestStore({ submissions: [...pending, rejected] });
  const spy = rebuildSpy();
  const result = await updateSubmission({ store, ownerId: OWNER, id: ID(6), input: input({ slug: 'rejected-one' }), now: NOW, rebuild: spy.rebuild });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can have 5 pending submissions at a time' });
  assert.equal(store.state.submissions.get(ID(6)).status, 'rejected');
  assert.equal(store.state.submissions.get(ID(6)).review_note, 'Describe it');
  assert.equal(spy.calls.length, 0);
});

test('the logic refuses another owner\'s row even when the store returns it', async () => {
  const store = createTestStore({ submissions: [seed({ owner_id: OTHER, status: 'approved' })] });
  // A store whose query ignores ownerId, so it returns the foreign row. Writes are counted.
  store.getOwnSubmission = async (_ownerId, id) => {
    const row = store.state.submissions.get(id);
    return row ? { ...row } : null;
  };
  let writes = 0;
  const { updateSubmission: write, deleteSubmission: remove } = store;
  store.updateSubmission = async (...args) => { writes += 1; return write(...args); };
  store.deleteSubmission = async (...args) => { writes += 1; return remove(...args); };
  const spy = rebuildSpy();
  assert.deepEqual(await getOwnSubmission({ store, ownerId: OWNER, id: ID(1) }), NOT_FOUND);
  assert.deepEqual(
    await updateSubmission({ store, ownerId: OWNER, id: ID(1), input: input({ name: 'Hijacked' }), now: NOW, rebuild: spy.rebuild }),
    NOT_FOUND,
  );
  assert.deepEqual(await deleteSubmission({ store, ownerId: OWNER, id: ID(1), rebuild: spy.rebuild }), NOT_FOUND);
  assert.equal(writes, 0);
  assert.equal(store.state.submissions.get(ID(1)).name, 'Star Pie');
  assert.equal(store.state.submissions.has(ID(1)), true);
  assert.equal(spy.calls.length, 0);
});

test('a rebuild that throws is logged on the server with the error', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const boom = new Error('socket hang up');
  const result = await deleteSubmission({ store, ownerId: OWNER, id: ID(1), rebuild: async () => { throw boom; } });
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.deepEqual(logs.mock.calls.map((c) => c.arguments), [['submissions: rebuild threw', boom]]);
});

test('a rebuild that returns ok: false is logged on the server', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = createTestStore({ submissions: [seed({ status: 'approved' })] });
  const spy = rebuildSpy({ ok: false, error: 'Rebuild hook returned 500' });
  const result = await deleteSubmission({ store, ownerId: OWNER, id: ID(1), rebuild: spy.rebuild });
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(logs.mock.calls.some((c) => c.arguments.includes('Rebuild hook returned 500')), true);
});

// ---------- Database limit errors (the database is the authority when two requests race) ----------

/** An error shaped like the one the Supabase store raises. */
const dbError = (code, message) => Object.assign(new Error(message), { code });

test('db limit: P0001 pending_limit on insert gives the 429 text and creates nothing', async () => {
  const store = createTestStore({ failures: { insertSubmission: dbError('P0001', 'pending_limit') } });
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can have 5 pending submissions at a time' });
  assert.equal(store.state.submissions.size, 0);
});

test('db limit: P0001 daily_limit on insert gives the 429 text', async () => {
  const store = createTestStore({ failures: { insertSubmission: dbError('P0001', 'daily_limit') } });
  const result = await createSubmission({ store, ownerId: OWNER, input: input(), now: NOW });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can add 3 new submissions per day' });
  assert.equal(store.state.submissions.size, 0);
});

test('db limit: P0001 pending_limit on an update that makes a row pending gives the 429 text and leaves the row unchanged', async () => {
  const store = createTestStore({
    submissions: [seed({ status: 'rejected', review_note: 'Describe it' })],
    failures: { updateSubmission: dbError('P0001', 'pending_limit') },
  });
  const before = { ...store.state.submissions.get(ID(1)) };
  const spy = rebuildSpy();
  const result = await updateSubmission({ store, ownerId: OWNER, id: ID(1), input: input({ name: 'Changed' }), now: NOW, rebuild: spy.rebuild });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can have 5 pending submissions at a time' });
  assert.deepEqual(store.state.submissions.get(ID(1)), before);
  assert.equal(spy.calls.length, 0);
});

test('db limit: P0001 daily_limit on update gives the 429 text', async () => {
  const store = createTestStore({
    submissions: [seed()],
    failures: { updateSubmission: dbError('P0001', 'daily_limit') },
  });
  const result = await updateSubmission({ store, ownerId: OWNER, id: ID(1), input: input(), now: NOW, rebuild: rebuildSpy().rebuild });
  assert.deepEqual(result, { ok: false, status: 429, error: 'You can add 3 new submissions per day' });
});

test('db limit: 23514 gives the fixed 400 text and never the database message', async () => {
  const secret = 'new row for relation "submissions" violates check constraint "thumbnail_url_blob"';
  const insertStore = createTestStore({ failures: { insertSubmission: dbError('23514', secret) } });
  const created = await createSubmission({ store: insertStore, ownerId: OWNER, input: input(), now: NOW });
  assert.deepEqual(created, { ok: false, status: 400, error: 'Those game details were not accepted.' });
  assert.equal(JSON.stringify(created).includes('violates'), false);
  assert.equal(insertStore.state.submissions.size, 0);

  const updateStore = createTestStore({ submissions: [seed()], failures: { updateSubmission: dbError('23514', secret) } });
  const updated = await updateSubmission({ store: updateStore, ownerId: OWNER, id: ID(1), input: input(), now: NOW, rebuild: rebuildSpy().rebuild });
  assert.deepEqual(updated, { ok: false, status: 400, error: 'Those game details were not accepted.' });
  assert.equal(JSON.stringify(updated).includes('violates'), false);
});

test('db limit: an unrelated error, or P0001 with another message, is rethrown unchanged', async () => {
  const boom = dbError('XX000', 'connection lost');
  const insertStore = createTestStore({ failures: { insertSubmission: boom } });
  await assert.rejects(createSubmission({ store: insertStore, ownerId: OWNER, input: input(), now: NOW }), (err) => err === boom);

  const other = dbError('P0001', 'something_else');
  const updateStore = createTestStore({ submissions: [seed()], failures: { updateSubmission: other } });
  await assert.rejects(
    updateSubmission({ store: updateStore, ownerId: OWNER, id: ID(1), input: input(), now: NOW, rebuild: rebuildSpy().rebuild }),
    (err) => err === other,
  );
});
