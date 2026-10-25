// Sign-in checks: reading the Supabase user, and the 401 and 403 answers. Fake fetch only, no network. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUser, requireUser, requireVerified } from './auth.mjs';

const url = 'https://example.supabase.co';
const anonKey = 'anon-test-key';
const token = 'user-access-token';
const deps = (fetchImpl) => ({ fetchImpl, url, anonKey });

/** A request with the given Authorization header, or none when undefined. */
function request(authorization) {
  return { headers: authorization === undefined ? {} : { authorization } };
}

/** A fake fetch that answers every call with `status` and a JSON body, and records the calls. */
function fakeFetch(status, body = {}) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

/** A user as Supabase returns it from GET /auth/v1/user. */
const supabaseUser = {
  id: 'user-1',
  email: 'ada@example.com',
  email_confirmed_at: '2026-10-20T12:00:00.000Z',
  user_metadata: { handle: 'ada', display_name: 'Ada', age_confirmed: true },
};

test('readUser returns null, and does not call Supabase, when there is no Authorization header', async () => {
  const { fetchImpl, calls } = fakeFetch(200, supabaseUser);
  assert.equal(await readUser(request(), deps(fetchImpl)), null);
  assert.equal(calls.length, 0);
});

test('readUser returns null, and does not call Supabase, for a header that is not a bearer token', async () => {
  const { fetchImpl, calls } = fakeFetch(200, supabaseUser);
  assert.equal(await readUser(request('Basic dXNlcjpwYXNz'), deps(fetchImpl)), null);
  assert.equal(calls.length, 0);
});

test('readUser sends GET to /auth/v1/user with the bearer token and the anon key', async () => {
  const { fetchImpl, calls } = fakeFetch(200, supabaseUser);
  await readUser(request(`Bearer ${token}`), deps(fetchImpl));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, `${url}/auth/v1/user`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].init.headers.apikey, anonKey);
});

test('readUser returns the user with verified true, and handle and display name from user_metadata', async () => {
  const { fetchImpl } = fakeFetch(200, supabaseUser);
  assert.deepEqual(await readUser(request(`Bearer ${token}`), deps(fetchImpl)), {
    id: 'user-1',
    email: 'ada@example.com',
    verified: true,
    handle: 'ada',
    displayName: 'Ada',
    ageConfirmed: true,
  });
});

test('readUser returns verified false when email_confirmed_at is null', async () => {
  const { fetchImpl } = fakeFetch(200, { ...supabaseUser, email_confirmed_at: null });
  const user = await readUser(request(`Bearer ${token}`), deps(fetchImpl));
  assert.equal(user.verified, false);
});

test('readUser returns verified false when email_confirmed_at is missing, so the check fails closed', async () => {
  const { email_confirmed_at: _omitted, ...withoutField } = supabaseUser;
  const { fetchImpl } = fakeFetch(200, withoutField);
  const user = await readUser(request(`Bearer ${token}`), deps(fetchImpl));
  assert.equal(user.verified, false);
});

test('readUser gives empty handle and display name when user_metadata has neither', async () => {
  const { fetchImpl } = fakeFetch(200, { id: 'user-2', email: 'bo@example.com', email_confirmed_at: null, user_metadata: {} });
  assert.deepEqual(await readUser(request(`Bearer ${token}`), deps(fetchImpl)), {
    id: 'user-2',
    email: 'bo@example.com',
    verified: false,
    handle: '',
    displayName: '',
    ageConfirmed: false,
  });
});

test('readUser counts the age check only when age_confirmed is literally true', async () => {
  for (const value of ['true', 1, 'yes', null]) {
    const { fetchImpl } = fakeFetch(200, { ...supabaseUser, user_metadata: { handle: 'ada', age_confirmed: value } });
    const user = await readUser(request(`Bearer ${token}`), deps(fetchImpl));
    assert.equal(user.ageConfirmed, false, String(value));
  }
});

test('readUser returns null on a 401, such as an expired token', async () => {
  const { fetchImpl } = fakeFetch(401, { code: 401, msg: 'invalid JWT' });
  assert.equal(await readUser(request(`Bearer ${token}`), deps(fetchImpl)), null);
});

test('readUser throws on another failure status, so an outage is not read as signed out', async () => {
  const { fetchImpl } = fakeFetch(503, { msg: 'unavailable' });
  await assert.rejects(readUser(request(`Bearer ${token}`), deps(fetchImpl)), /status 503/);
});

test('requireUser returns 401 Sign in first for a signed-out request', async () => {
  const { fetchImpl, calls } = fakeFetch(200, supabaseUser);
  assert.deepEqual(await requireUser(request(), deps(fetchImpl)), { status: 401, error: 'Sign in first' });
  assert.equal(calls.length, 0);
});

test('requireUser returns 401 Sign in first when Supabase rejects the token', async () => {
  const { fetchImpl } = fakeFetch(401, { code: 401 });
  assert.deepEqual(await requireUser(request(`Bearer ${token}`), deps(fetchImpl)), { status: 401, error: 'Sign in first' });
});

test('requireUser returns the user for a signed-in request, verified or not', async () => {
  const { fetchImpl } = fakeFetch(200, { ...supabaseUser, email_confirmed_at: null });
  const result = await requireUser(request(`Bearer ${token}`), deps(fetchImpl));
  assert.equal(result.user.id, 'user-1');
  assert.equal(result.user.verified, false);
});

test('requireUser returns 503 when the sign-in check fails with a server error', async () => {
  const { fetchImpl } = fakeFetch(500, {});
  assert.deepEqual(await requireUser(request(`Bearer ${token}`), deps(fetchImpl)), {
    status: 503,
    error: 'Could not check sign-in, try again',
  });
});

test('requireUser returns 503 when the sign-in check cannot reach Supabase', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  assert.deepEqual(await requireUser(request(`Bearer ${token}`), deps(fetchImpl)), {
    status: 503,
    error: 'Could not check sign-in, try again',
  });
});

test('requireUser returns 503 when the sign-in check times out, and the check carries a timeout signal', async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  assert.deepEqual(await requireUser(request(`Bearer ${token}`), deps(fetchImpl)), {
    status: 503,
    error: 'Could not check sign-in, try again',
  });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('requireVerified returns 401 Sign in first for a signed-out request', async () => {
  const { fetchImpl, calls } = fakeFetch(200, supabaseUser);
  assert.deepEqual(await requireVerified(request(), deps(fetchImpl)), { status: 401, error: 'Sign in first' });
  assert.equal(calls.length, 0);
});

test('requireVerified returns 403 Verify your email first for an unverified user', async () => {
  const { fetchImpl } = fakeFetch(200, { ...supabaseUser, email_confirmed_at: null });
  assert.deepEqual(await requireVerified(request(`Bearer ${token}`), deps(fetchImpl)), {
    status: 403,
    error: 'Verify your email first',
  });
});

test('requireVerified returns the user for a verified user', async () => {
  const { fetchImpl } = fakeFetch(200, supabaseUser);
  const result = await requireVerified(request(`Bearer ${token}`), deps(fetchImpl));
  assert.equal(result.user.id, 'user-1');
  assert.equal(result.user.verified, true);
});
