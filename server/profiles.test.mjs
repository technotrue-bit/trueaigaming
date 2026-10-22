// Profile logic: profiles from signup metadata, handle changes and account deletion. In-memory store and fake rebuild only. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './test-store.mjs';
import { deleteAccount, ensureProfile, setHandle } from './profiles.mjs';

/** A signed-in user as requireUser returns it. */
function user(id, handle = '', displayName = '') {
  return { id, email: `${id}@example.com`, verified: true, handle, displayName };
}

/** A fake rebuild that records each call and returns `result`. */
function rebuildSpy(result = { ok: true }) {
  const calls = [];
  return { calls, rebuild: async () => { calls.push(true); return result; } };
}

test('ensureProfile creates a profile from the signup metadata when none exists', async () => {
  const store = createTestStore();
  const result = await ensureProfile(store, user('user-1', 'ada', 'Ada'));
  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'user-1');
  assert.equal(result.value.handle, 'ada');
  assert.equal(result.value.display_name, 'Ada');
  assert.equal(result.value.is_admin, false);
  assert.equal(store.state.profiles.size, 1);
});

test('ensureProfile returns the same profile on a second call, and ignores metadata changed since', async () => {
  const store = createTestStore();
  const first = await ensureProfile(store, user('user-1', 'ada', 'Ada'));
  const second = await ensureProfile(store, user('user-1', 'other', 'Other'));
  assert.deepEqual(second, first);
  assert.equal(store.state.profiles.size, 1);
});

test('ensureProfile returns 409 Choose a handle when the metadata handle is reserved, and creates nothing', async () => {
  const store = createTestStore();
  assert.deepEqual(await ensureProfile(store, user('user-1', 'admin', 'Ada')), {
    ok: false,
    status: 409,
    error: 'Choose a handle',
  });
  assert.equal(store.state.profiles.size, 0);
});

test('ensureProfile returns 409 Choose a handle for a missing or malformed metadata handle, and creates nothing', async () => {
  for (const handle of ['', 'ab', 'Bad Handle!', '-ada']) {
    const store = createTestStore();
    assert.deepEqual(await ensureProfile(store, user('user-1', handle)), {
      ok: false,
      status: 409,
      error: 'Choose a handle',
    }, `handle ${JSON.stringify(handle)}`);
    assert.equal(store.state.profiles.size, 0);
  }
});

test('ensureProfile returns 409 Choose a handle when another profile already has the metadata handle', async () => {
  const store = createTestStore({ profiles: [{ id: 'user-2', handle: 'ada', display_name: 'Ada' }] });
  assert.deepEqual(await ensureProfile(store, user('user-1', 'ada', 'Ada')), {
    ok: false,
    status: 409,
    error: 'Choose a handle',
  });
  assert.equal(store.state.profiles.has('user-1'), false);
});

test('ensureProfile checks the display name too, and creates nothing when it is too long', async () => {
  const store = createTestStore();
  assert.deepEqual(await ensureProfile(store, user('user-1', 'ada', 'x'.repeat(41))), {
    ok: false,
    status: 409,
    error: 'Choose a handle',
  });
  assert.equal(store.state.profiles.size, 0);
});

test('ensureProfile returns the profile that a parallel request created first', async () => {
  const store = createTestStore();
  await ensureProfile(store, user('user-1', 'ada', 'Ada'));
  // The first read misses, as it would before a parallel request has written. Later reads see the row.
  let reads = 0;
  const racing = { ...store, getProfile: async (id) => (reads++ === 0 ? null : store.getProfile(id)) };
  const result = await ensureProfile(racing, user('user-1', 'ada', 'Ada'));
  assert.equal(result.ok, true);
  assert.equal(result.value.handle, 'ada');
  assert.equal(store.state.profiles.size, 1);
});

test('setHandle returns 409 That handle is taken when another profile has the handle', async () => {
  const store = createTestStore({
    profiles: [
      { id: 'user-2', handle: 'ada', display_name: 'Ada' },
      { id: 'user-1', handle: 'bo', display_name: 'Bo' },
    ],
  });
  assert.deepEqual(await setHandle(store, user('user-1'), ' Ada '), {
    ok: false,
    status: 409,
    error: 'That handle is taken',
  });
  assert.equal(store.state.profiles.get('user-1').handle, 'bo');
});

test('setHandle returns 409 That handle is taken when the caller has no profile yet and the handle is taken', async () => {
  const store = createTestStore({ profiles: [{ id: 'user-2', handle: 'ada', display_name: 'Ada' }] });
  assert.deepEqual(await setHandle(store, user('user-1'), 'ada'), {
    ok: false,
    status: 409,
    error: 'That handle is taken',
  });
  assert.equal(store.state.profiles.has('user-1'), false);
});

test('setHandle creates the profile when the caller has none, so a refused signup handle can be replaced', async () => {
  const store = createTestStore();
  const result = await setHandle(store, user('user-1', 'admin', 'Ada'), 'Ada-Lovelace');
  assert.equal(result.ok, true);
  assert.equal(result.value.handle, 'ada-lovelace');
  assert.equal(result.value.display_name, 'Ada');
});

test('setHandle changes the handle on an existing profile', async () => {
  const store = createTestStore({ profiles: [{ id: 'user-1', handle: 'bo', display_name: 'Bo' }] });
  const result = await setHandle(store, user('user-1'), 'bo-two');
  assert.equal(result.ok, true);
  assert.equal(result.value.handle, 'bo-two');
  assert.equal(store.state.profiles.get('user-1').handle, 'bo-two');
});

test('setHandle returns 400 with the rule message for an invalid or reserved handle, and changes nothing', async () => {
  const store = createTestStore({ profiles: [{ id: 'user-1', handle: 'bo', display_name: 'Bo' }] });
  assert.deepEqual(await setHandle(store, user('user-1'), 'a'), {
    ok: false,
    status: 400,
    error: 'Handle must be 3 to 24 characters',
  });
  assert.deepEqual(await setHandle(store, user('user-1'), 'admin'), {
    ok: false,
    status: 400,
    error: 'That handle is reserved',
  });
  assert.equal(store.state.profiles.get('user-1').handle, 'bo');
});

test('deleteAccount removes the caller submissions, profile and auth user, and rebuilds once when an approved game was removed', async () => {
  const store = createTestStore({
    profiles: [
      { id: 'user-1', handle: 'ada', display_name: 'Ada' },
      { id: 'user-2', handle: 'bo', display_name: 'Bo' },
    ],
    submissions: [
      { id: 's1', owner_id: 'user-1', slug: 'one-game', status: 'approved' },
      { id: 's2', owner_id: 'user-1', slug: 'two-game', status: 'pending' },
      { id: 's3', owner_id: 'user-2', slug: 'bo-game', status: 'approved' },
    ],
  });
  const { calls, rebuild } = rebuildSpy({ ok: false, error: 'Rebuild hook returned 500' });

  const result = await deleteAccount({ store, user: user('user-1'), rebuild });

  assert.deepEqual(result, { ok: true, rebuild: { ok: false, error: 'Rebuild hook returned 500' } });
  assert.deepEqual([...store.state.submissions.keys()], ['s3']);
  assert.deepEqual([...store.state.profiles.keys()], ['user-2']);
  assert.deepEqual(store.state.deletedAuthUsers, ['user-1']);
  assert.equal(calls.length, 1);
});

test('deleteAccount never calls rebuild when only pending or rejected submissions were removed', async () => {
  const store = createTestStore({
    profiles: [{ id: 'user-1', handle: 'ada', display_name: 'Ada' }],
    submissions: [
      { id: 's1', owner_id: 'user-1', slug: 'one-game', status: 'pending' },
      { id: 's2', owner_id: 'user-1', slug: 'two-game', status: 'rejected' },
    ],
  });
  const { calls, rebuild } = rebuildSpy();

  const result = await deleteAccount({ store, user: user('user-1'), rebuild });

  assert.deepEqual(result, { ok: true, rebuild: null });
  assert.equal(calls.length, 0);
  assert.equal(store.state.submissions.size, 0);
  assert.equal(store.state.profiles.size, 0);
  assert.deepEqual(store.state.deletedAuthUsers, ['user-1']);
});

test('deleteAccount still rebuilds when a step after the approved game fails, so the game leaves the site', async () => {
  const store = createTestStore({
    profiles: [{ id: 'user-1', handle: 'ada', display_name: 'Ada' }],
    submissions: [{ id: 's1', owner_id: 'user-1', slug: 'one-game', status: 'approved' }],
  });
  const failing = { ...store, deleteAuthUser: async () => { throw new Error('auth service down'); } };
  const { calls, rebuild } = rebuildSpy();

  await assert.rejects(deleteAccount({ store: failing, user: user('user-1'), rebuild }), /auth service down/);
  assert.equal(calls.length, 1);
  assert.equal(store.state.submissions.size, 0);
});

test('deleteAccount rebuilds when a delete commits and then throws, so the removed approved game leaves the site', async () => {
  const store = createTestStore({
    profiles: [{ id: 'user-1', handle: 'ada', display_name: 'Ada' }],
    submissions: [{ id: 's1', owner_id: 'user-1', slug: 'one-game', status: 'approved' }],
  });
  // The delete reaches the database, then the reply is lost.
  const lostReply = {
    ...store,
    deleteSubmission: async (id) => {
      await store.deleteSubmission(id);
      throw new Error('response lost');
    },
  };
  const { calls, rebuild } = rebuildSpy();

  await assert.rejects(deleteAccount({ store: lostReply, user: user('user-1'), rebuild }), /response lost/);
  assert.equal(calls.length, 1);
  assert.equal(store.state.submissions.has('s1'), false);
});

test('deleteAccount passes the rebuild result through unchanged, so the route can send the fixed text', async () => {
  const store = createTestStore({
    profiles: [{ id: 'user-1', handle: 'ada', display_name: 'Ada' }],
    submissions: [{ id: 's1', owner_id: 'user-1', slug: 'one-game', status: 'approved' }],
  });
  const { calls, rebuild } = rebuildSpy({ ok: false, error: 'Rebuild did not start' });

  const result = await deleteAccount({ store, user: user('user-1'), rebuild });

  assert.deepEqual(result, { ok: true, rebuild: { ok: false, error: 'Rebuild did not start' } });
  assert.equal(calls.length, 1);
});
