// Admin review: list pending submissions, approve or reject them, and republish the site. In-memory store and fake rebuild only. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './test-store.mjs';
import { listPending, republish, reviewSubmission } from './admin.mjs';

const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const NOT_ADMIN = { ok: false, status: 403, error: 'Admins only' };
const NOT_FOUND = { ok: false, status: 404, error: 'Not found' };
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

test('reject without a note returns 400 and changes nothing', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const note of [undefined, '', '   ']) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'reject', note, rebuild: spy.rebuild });
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
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'approve', note: '', rebuild: spy.rebuild });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(store.state.submissions.get(ID(1)).status, 'approved');
});

test('approve calls rebuild exactly once', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'approve', note: 'Nice work', rebuild: spy.rebuild });
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(result.value.rebuild, { ok: true });
});

test('reject does not call rebuild', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'reject', note: 'Needs a thumbnail', rebuild: spy.rebuild });
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
    const result = await reviewSubmission({ store, adminId: MEMBER, id: ID(1), action, note: 'Note', rebuild: spy.rebuild });
    assert.deepEqual(result, NOT_ADMIN);
  }
  assert.equal(store.state.submissions.get(ID(1)).status, 'pending');
  assert.equal(spy.calls.length, 0);
});

test('approve sets the status, the trimmed note, the reviewer and the review time', async () => {
  const store = storeWith();
  const before = Date.now();
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'approve', note: '  Looks good  ', rebuild: rebuildSpy().rebuild });
  const row = store.state.submissions.get(ID(1));
  assert.equal(row.status, 'approved');
  assert.equal(row.review_note, 'Looks good');
  assert.equal(row.reviewed_by, ADMIN);
  assert.ok(Date.parse(row.reviewed_at) >= before);
  assert.equal(result.value.submission.status, 'approved');
});

test('reject sets the status, the note, the reviewer and the review time', async () => {
  const store = storeWith();
  await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'reject', note: 'Too short', rebuild: rebuildSpy().rebuild });
  const row = store.state.submissions.get(ID(1));
  assert.equal(row.status, 'rejected');
  assert.equal(row.review_note, 'Too short');
  assert.equal(row.reviewed_by, ADMIN);
  assert.equal(typeof row.reviewed_at, 'string');
});

test('a rebuild error reaches the result as fixed text only, and is logged', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const spy = rebuildSpy({ ok: false, error: 'DEPLOY_HOOK_URL is not set' });
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'approve', note: '', rebuild: spy.rebuild });
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(JSON.stringify(result).includes('DEPLOY_HOOK_URL'), false);
  assert.equal(logs.mock.calls.some((c) => c.arguments.includes('DEPLOY_HOOK_URL is not set')), true);
});

test('a rebuild that throws still saves the approval and reports fixed text', async (t) => {
  t.mock.method(console, 'error', () => {});
  const store = storeWith();
  const rebuild = async () => { throw new Error('connect failed at https://hook.example/secret-token'); };
  const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action: 'approve', note: '', rebuild });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rebuild, { ok: false, error: 'Rebuild did not start' });
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
  assert.equal(store.state.submissions.get(ID(1)).status, 'approved');
});

test('an unknown action returns 400 and changes nothing', async () => {
  const store = storeWith();
  const spy = rebuildSpy();
  for (const action of [undefined, 'delete', 'APPROVE']) {
    const result = await reviewSubmission({ store, adminId: ADMIN, id: ID(1), action, note: 'Note', rebuild: spy.rebuild });
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
