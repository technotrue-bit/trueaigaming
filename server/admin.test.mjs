// Admin review: list pending submissions, approve or reject them, and republish the site. In-memory store and fake rebuild only. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './test-store.mjs';
import { listPending, republish, reviewSubmission } from './admin.mjs';

const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const NOT_ADMIN = { ok: false, status: 403, error: 'Admins only' };
const NOT_FOUND = { ok: false, status: 404, error: 'Not found' };
const UPDATED_AT = '2026-10-20T10:00:00.123456+00:00';
const CHANGED = { ok: false, status: 409, error: 'This submission changed since you loaded it. Reload and review again.' };
const TAKEN = { ok: false, status: 409, error: 'That game address is taken' };
const INVALID = { ok: false, status: 409, error: 'This submission has invalid details; ask the owner to edit it' };
const NOTE_REQUIRED = { ok: false, status: 400, error: 'A note is required when rejecting' };

/** A uuid-shaped id, so ids look like the ones Postgres generates. */
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A pending submission owned by the member. */
function pendingRow(overrides = {}) {
  return {
    id: ID(1),
    owner_id: MEMBER,
    slug: 'star-pie',
    name: 'Star Pie',
    status: 'pending',
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

/** A store with one admin, one member, and the given submissions (one pending row by default). */
function storeWith(submissions = [pendingRow()]) {
  return createTestStore({
    profiles: [
      { id: ADMIN, handle: 'admin', is_admin: true },
      { id: MEMBER, handle: 'member', is_admin: false },
    ],
    submissions,
  });
}

/** A fake rebuild that records each call and returns `result`. */
function rebuildSpy(result = { ok: true }) {
  const calls = [];
  return { calls, rebuild: async () => { calls.push(true); return result; } };
}

test('listPending refuses a non-admin with 403', async () => {
  const store = storeWith();
  assert.deepEqual(await listPending({ store, adminId: MEMBER }), NOT_ADMIN);
  assert.deepEqual(await listPending({ store, adminId: 'nobody' }), NOT_ADMIN);
});

test('listPending returns only pending rows, oldest first, to an admin', async () => {
  const store = storeWith([
    pendingRow({ id: ID(2), slug: 'second', created_at: '2026-10-21T10:00:00.000Z' }),
    pendingRow({ id: ID(1), slug: 'first', created_at: '2026-10-20T10:00:00.000Z' }),
    pendingRow({ id: ID(3), slug: 'done', status: 'approved', created_at: '2026-10-19T10:00:00.000Z' }),
  ]);
  const result = await listPending({ store, adminId: ADMIN });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.map((s) => s.id), [ID(1), ID(2)]);
});

test('listPending gives each row its owner handle, or null when the owner has no profile', async () => {
  const store = createTestStore({
    profiles: [
      { id: ADMIN, handle: 'admin', is_admin: true },
      { id: MEMBER, handle: 'member', is_admin: false },
    ],
    submissions: [
      pendingRow({ id: ID(1), owner_id: MEMBER, slug: 'member-game', created_at: '2026-10-20T10:00:00.000Z' }),
      pendingRow({ id: ID(2), owner_id: 'no-profile', slug: 'orphan-game', created_at: '2026-10-21T10:00:00.000Z' }),
    ],
  });
  const result = await listPending({ store, adminId: ADMIN });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.map((s) => s.owner_handle), ['member', null]);
});

test('reject without a note returns 400 and changes nothing', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const note of [undefined, '', '   ']) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'reject', note, rebuild: spy.rebuild });
    assert.deepEqual(result, NOTE_REQUIRED);
  }
  const row = store.state.submissions.get(ID(1));
  assert.equal(row.status, 'pending');
  assert.equal(row.review_note, null);
  assert.equal(row.reviewed_by, null);
  assert.equal(row.reviewed_at, null);
  assert.equal(spy.calls.length, 0);
});

test('approve saves the status even when the rebuild fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const spy = rebuildSpy({ ok: false, error: 'Rebuild hook returned 500' });
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(store.state.submissions.get(ID(1)).status, 'approved');
});

test('approve calls rebuild exactly once', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: 'Nice work', rebuild: spy.rebuild });
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(result.value.rebuild, { ok: true });
});

test('reject does not call rebuild', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'reject', note: 'Needs a thumbnail', rebuild: spy.rebuild });
  assert.equal(spy.calls.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value.rebuild, null);
  assert.equal(store.state.submissions.get(ID(1)).status, 'rejected');
});

test('republish refuses a non-admin and never calls rebuild', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  assert.deepEqual(await republish({ store, adminId: MEMBER, rebuild: spy.rebuild }), NOT_ADMIN);
  assert.equal(spy.calls.length, 0);
});

test('a non-admin cannot approve or reject, and the row stays pending', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const action of ['approve', 'reject']) {
    const result = await reviewSubmission({ store, adminId: MEMBER, id: ID(1), updatedAt: UPDATED_AT, action, note: 'Note', rebuild: spy.rebuild });
    assert.deepEqual(result, NOT_ADMIN);
  }
  assert.equal(store.state.submissions.get(ID(1)).status, 'pending');
  assert.equal(spy.calls.length, 0);
});

test('approve sets the status, the trimmed note, the reviewer and the review time', async () => {
  const store = storeWith();
  const before = Date.now();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '  Looks good  ', rebuild: rebuildSpy().rebuild });
  const row = store.state.submissions.get(ID(1));
  assert.equal(row.status, 'approved');
  assert.equal(row.review_note, 'Looks good');
  assert.equal(row.reviewed_by, ADMIN);
  assert.ok(Date.parse(row.reviewed_at) >= before);
  assert.equal(result.value.submission.status, 'approved');
});

test('reject sets the status, the note, the reviewer and the review time', async () => {
  const store = storeWith();
  await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'reject', note: 'Too short', rebuild: rebuildSpy().rebuild });
  const row = store.state.submissions.get(ID(1));
  assert.equal(row.status, 'rejected');
  assert.equal(row.review_note, 'Too short');
  assert.equal(row.reviewed_by, ADMIN);
  assert.equal(typeof row.reviewed_at, 'string');
});

test('a rebuild error reaches the result as fixed text only, and is logged as unknown error', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const spy = rebuildSpy({ ok: false, error: 'DEPLOY_HOOK_URL is not set' });
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild });
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(JSON.stringify(result).includes('DEPLOY_HOOK_URL'), false);
  assert.equal(logs.mock.calls.some((c) => c.arguments.includes('unknown error')), true);
  assert.equal(JSON.stringify(logs.mock.calls).includes('DEPLOY_HOOK_URL'), false);
});

/** The fixed reply for a review of a row that is no longer pending. */
const NOT_PENDING = { ok: false, status: 409, error: 'Only pending submissions can be reviewed' };

/** A row an earlier admin already reviewed. A refused review must leave these fields as they are. */
function reviewedRow(status) {
  return pendingRow({ status, reviewed_by: 'earlier-admin', review_note: 'Earlier note', reviewed_at: '2026-10-21T09:00:00.000Z' });
}

/** The review fields of row 1, for comparing before and after a refused review. */
function reviewFields(store) {
  const row = store.state.submissions.get(ID(1));
  return { status: row.status, review_note: row.review_note, reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at };
}

test('approve of an approved row returns 409, changes nothing and does not rebuild', async () => {
  const store = storeWith([reviewedRow('approved')]);
  const before = reviewFields(store);
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild });
  assert.deepEqual(result, NOT_PENDING);
  assert.deepEqual(reviewFields(store), before);
  assert.equal(spy.calls.length, 0);
});

test('reject of an approved row returns 409, changes nothing and does not rebuild', async () => {
  const store = storeWith([reviewedRow('approved')]);
  const before = reviewFields(store);
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'reject', note: 'Needs work', rebuild: spy.rebuild });
  assert.deepEqual(result, NOT_PENDING);
  assert.deepEqual(reviewFields(store), before);
  assert.equal(spy.calls.length, 0);
});

test('approve of a rejected row returns 409, changes nothing and does not rebuild', async () => {
  const store = storeWith([reviewedRow('rejected')]);
  const before = reviewFields(store);
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild });
  assert.deepEqual(result, NOT_PENDING);
  assert.deepEqual(reviewFields(store), before);
  assert.equal(spy.calls.length, 0);
});

test('a conditional write that matches no row returns 409 and does not rebuild', async () => {
  const writes = [];
  const row = storeWith().state.submissions.get(ID(1));
  // The read sees a pending row. Another admin rejects it before this write, so the conditional write matches nothing.
  const store = {
    isAdmin: async () => true,
    getSubmissionById: async () => row,
    updateSubmissionIf: async (id, expected) => {
      writes.push([id, expected]);
      return null;
    },
  };
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild });
  assert.deepEqual(result, CHANGED);
  assert.deepEqual(writes, [[ID(1), { status: 'pending', updatedAt: UPDATED_AT }]]);
  assert.equal(spy.calls.length, 0);
});

test('a card that is out of date is refused with 409: nothing is written and nothing rebuilds', async () => {
  // The owner edited the row after the admin loaded the queue, so its updated_at moved on.
  const store = storeWith([pendingRow({ updated_at: '2026-10-21T08:00:00.000000+00:00', name: 'Edited Pie' })]);
  const before = reviewFields(store);
  const spy = rebuildSpy();
  for (const action of ['approve', 'reject']) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action, note: 'Note', rebuild: spy.rebuild });
    assert.deepEqual(result, CHANGED);
  }
  assert.deepEqual(reviewFields(store), before);
  assert.equal(spy.calls.length, 0);
});

test('a missing or non-text updated_at is refused like an out-of-date card', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const updatedAt of [undefined, null, 5, '']) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt, action: 'approve', note: '', rebuild: spy.rebuild });
    assert.deepEqual(result, CHANGED);
  }
  assert.equal(store.state.submissions.get(ID(1)).status, 'pending');
  assert.equal(spy.calls.length, 0);
});

test('approve refuses a slug that is a first-party game id with 409, writes nothing and does not rebuild', async () => {
  const store = storeWith([pendingRow({ slug: 'super-star-party' })]);
  const before = reviewFields(store);
  const spy = rebuildSpy();
  const result = await reviewSubmission({
    store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild, firstPartyIds: ['super-star-party', 'other'],
  });
  assert.deepEqual(result, TAKEN);
  assert.deepEqual(reviewFields(store), before);
  assert.equal(spy.calls.length, 0);
});

test('reject does not check the first-party ids, so a bad row can still be cleared from the queue', async () => {
  const store = storeWith([pendingRow({ slug: 'super-star-party' })]);
  const result = await reviewSubmission({
    store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'reject', note: 'Taken address', rebuild: rebuildSpy().rebuild, firstPartyIds: ['super-star-party'],
  });
  assert.equal(result.ok, true);
  assert.equal(store.state.submissions.get(ID(1)).status, 'rejected');
});

test('approve re-checks the stored row with the shared rules and refuses an invalid one with 409', async () => {
  const invalid = [
    { play_url: 'http://example.com/play' },
    { name: '' },
    { thumbnail_url: 'https://evil.com/x.png' },
    { min_players: 5, max_players: 2 },
    { slug: 'Bad Slug' },
  ];
  for (const changes of invalid) {
    const store = storeWith([pendingRow(changes)]);
    const before = reviewFields(store);
    const spy = rebuildSpy();
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild: spy.rebuild });
    assert.deepEqual(result, INVALID, JSON.stringify(changes));
    assert.deepEqual(reviewFields(store), before);
    assert.equal(spy.calls.length, 0);
  }
});

test('approve checks the thumbnail against the store host when one is given', async () => {
  const host = 'abc123.public.blob.vercel-storage.com';
  const row = (thumbnail_url) => pendingRow({ thumbnail_url });
  const refused = await reviewSubmission({
    store: storeWith([row('https://other.public.blob.vercel-storage.com/x.png')]), adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT,
    action: 'approve', note: '', rebuild: rebuildSpy().rebuild, blobHost: host,
  });
  assert.deepEqual(refused, INVALID);
  const accepted = await reviewSubmission({
    store: storeWith([row(`https://${host}/x.png`)]), adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT,
    action: 'approve', note: '', rebuild: rebuildSpy().rebuild, blobHost: host,
  });
  assert.equal(accepted.ok, true);
});

test('reject of a row with invalid details still works', async () => {
  const store = storeWith([pendingRow({ play_url: 'http://example.com/play' })]);
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'reject', note: 'Needs https', rebuild: rebuildSpy().rebuild });
  assert.equal(result.ok, true);
});

test('a thrown rebuild error is logged as its name only, never its message', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const rebuild = async () => { throw new TypeError('connect failed at https://hook.example/secret-token'); };
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild });
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.deepEqual(logs.mock.calls.map((c) => c.arguments), [['admin: rebuild threw', 'TypeError']]);
});

test('a thrown non-Error value is logged as unknown error, never its text', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const rebuild = async () => { throw 'https://hook.example/secret-token'; };
  await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild });
  assert.deepEqual(logs.mock.calls.map((c) => c.arguments), [['admin: rebuild threw', 'unknown error']]);
});

test('a rebuild that throws still saves the approval and reports fixed text', async (t) => {
  t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const rebuild = async () => { throw new Error('connect failed at https://hook.example/secret-token'); };
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action: 'approve', note: '', rebuild });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
  assert.equal(store.state.submissions.get(ID(1)).status, 'approved');
});

test('an unknown action returns 400 and changes nothing', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const action of [undefined, 'delete', 'APPROVE']) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), updatedAt: UPDATED_AT, action, note: 'Note', rebuild: spy.rebuild });
    assert.deepEqual(result, { ok: false, status: 400, error: 'Action must be approve or reject' });
  }
  assert.equal(store.state.submissions.get(ID(1)).status, 'pending');
  assert.equal(spy.calls.length, 0);
});

test('a missing or malformed id returns 404 and calls nothing', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const id of ['not-a-uuid', '', undefined, ID(99)]) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id, action: 'approve', note: '', rebuild: spy.rebuild });
    assert.deepEqual(result, NOT_FOUND);
  }
  assert.equal(spy.calls.length, 0);
});

test('republish calls rebuild once for an admin and returns its result', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  assert.deepEqual(await republish({ store, adminId: ADMIN, rebuild: spy.rebuild }), { ok: true, value: { rebuild: { ok: true } } });
  assert.equal(spy.calls.length, 1);
});

test('republish reports a failed rebuild as fixed text', async (t) => {
  t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const spy = rebuildSpy({ ok: false, error: 'Rebuild hook returned 500' });
  assert.deepEqual(await republish({ store, adminId: ADMIN, rebuild: spy.rebuild }), {
    ok: true,
    value: { rebuild: { ok: false, error: 'Rebuild did not start' } },
  });
  assert.equal(spy.calls.length, 1);
});
