// Rebuild trigger: a missing hook, a 2xx reply, an error reply, a network failure and a timeout. Fake fetch only. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebuildForClient, triggerRebuild } from './deploy.mjs';

// A made-up hook. The last segment stands in for the secret token, which must never appear in an error.
const hookUrl = 'https://api.vercel.com/v1/integrations/deploy/prj_test/secret-token-value';

/** A fake fetch that answers with `status` and records each call. */
function fakeFetch(status) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status });
  };
  return { fetchImpl, calls };
}

test('reports a missing hook as an error, without calling fetch', async () => {
  const { fetchImpl, calls } = fakeFetch(200);
  for (const missing of [undefined, '', '   ']) {
    assert.deepEqual(await triggerRebuild({ hookUrl: missing, fetchImpl }), {
      ok: false,
      error: 'DEPLOY_HOOK_URL is not set',
    });
  }
  assert.equal(calls.length, 0);
});

test('POSTs to the hook and reports ok on a 200', async () => {
  const { fetchImpl, calls } = fakeFetch(200);
  assert.deepEqual(await triggerRebuild({ hookUrl, fetchImpl }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, hookUrl);
  assert.equal(calls[0].init.method, 'POST');
});

test('gives the POST a live abort signal, so the rebuild request can time out', async () => {
  const { fetchImpl, calls } = fakeFetch(200);
  await triggerRebuild({ hookUrl, fetchImpl });
  const { signal } = calls[0].init;
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test('reports ok on any 2xx status', async () => {
  for (const status of [202, 204]) {
    const { fetchImpl } = fakeFetch(status);
    assert.deepEqual(await triggerRebuild({ hookUrl, fetchImpl }), { ok: true }, `status ${status}`);
  }
});

test('returns an error on a 500, and the error does not contain the hook URL', async () => {
  const { fetchImpl } = fakeFetch(500);
  const result = await triggerRebuild({ hookUrl, fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'Rebuild hook returned 500' });
  assert.ok(!result.error.includes(hookUrl));
  assert.ok(!result.error.includes('secret-token-value'));
});

test('returns an error on a 404, which is not a 2xx', async () => {
  const { fetchImpl } = fakeFetch(404);
  assert.deepEqual(await triggerRebuild({ hookUrl, fetchImpl }), { ok: false, error: 'Rebuild hook returned 404' });
});

test('returns an error when the request fails before any reply', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const result = await triggerRebuild({ hookUrl, fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'Rebuild hook request failed' });
  assert.ok(!result.error.includes('secret-token-value'));
});

test('returns a timeout error when the abort signal fires', async () => {
  const fetchImpl = async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  assert.deepEqual(await triggerRebuild({ hookUrl, fetchImpl }), { ok: false, error: 'Rebuild hook timed out' });
});

// The client gets one fixed message for every failed rebuild. The real reason is logged, never returned.
const FIXED = { ok: false, error: 'Rebuild did not start' };

/** A log that records each call as [message, detail]. */
function recordingLog() {
  const logged = [];
  return { logged, log: (message, detail) => logged.push([message, detail]) };
}

test('rebuildForClient returns the fixed text when the trigger throws, and logs the error', async () => {
  const { logged, log } = recordingLog();
  const boom = new Error('DEPLOY_HOOK_URL is not set');
  const result = await rebuildForClient({ trigger: async () => { throw boom; }, log });
  assert.deepEqual(result, FIXED);
  assert.equal(JSON.stringify(result).includes('DEPLOY_HOOK_URL'), false);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1], boom);
});

test('rebuildForClient returns the fixed text when the trigger resolves to null, and logs it', async () => {
  const { logged, log } = recordingLog();
  const result = await rebuildForClient({ trigger: async () => null, log });
  assert.deepEqual(result, FIXED);
  assert.equal(JSON.stringify(result).includes('DEPLOY_HOOK_URL'), false);
  assert.equal(logged.length, 1);
});

test('rebuildForClient returns the fixed text for a config error, and logs the real reason', async () => {
  const { logged, log } = recordingLog();
  const result = await rebuildForClient({ trigger: async () => ({ ok: false, error: 'DEPLOY_HOOK_URL is not set' }), log });
  assert.deepEqual(result, FIXED);
  assert.equal(JSON.stringify(result).includes('DEPLOY_HOOK_URL'), false);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1], 'DEPLOY_HOOK_URL is not set');
});

test('rebuildForClient returns ok and logs nothing when the rebuild starts', async () => {
  const { logged, log } = recordingLog();
  assert.deepEqual(await rebuildForClient({ trigger: async () => ({ ok: true }), log }), { ok: true });
  assert.equal(logged.length, 0);
});
