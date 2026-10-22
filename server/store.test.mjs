// The Supabase store: the query strings it sends. A recording fake client, no network. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.mjs';

/** A client whose queries record every call and resolve to `reply`. */
function recordingClient(reply = { data: [], error: null }) {
  const calls = [];
  const builder = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === 'then') return (resolve) => resolve(reply);
        return (...args) => {
          calls.push([name, ...args]);
          return builder;
        };
      },
    },
  );
  return { calls, client: { from: (table) => { calls.push(['from', table]); return builder; }, auth: { admin: {} } } };
}

test('listPending embeds the owner profile through the named owner key, not a bare profiles embed', async () => {
  const { client, calls } = recordingClient();
  await createStore(client).listPending();
  const select = calls.find(([name]) => name === 'select');
  assert.equal(select[1], '*, profiles!submissions_owner_id_fkey(handle)');
});

test('updateSubmissionIf filters on the status, and on updated_at only when given', async () => {
  const first = recordingClient({ data: null, error: null });
  assert.equal(await createStore(first.client).updateSubmissionIf('id-1', { status: 'pending' }, { status: 'approved' }), null);
  assert.deepEqual(first.calls.filter(([name]) => name === 'eq'), [['eq', 'id', 'id-1'], ['eq', 'status', 'pending']]);

  const second = recordingClient({ data: null, error: null });
  await createStore(second.client).updateSubmissionIf('id-1', { status: 'pending', updatedAt: '2026-10-21T10:00:00.123456+00:00' }, { status: 'approved' });
  assert.deepEqual(second.calls.filter(([name]) => name === 'eq'), [
    ['eq', 'id', 'id-1'],
    ['eq', 'status', 'pending'],
    ['eq', 'updated_at', '2026-10-21T10:00:00.123456+00:00'],
  ]);
});
