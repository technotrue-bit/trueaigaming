// @ts-check
// Sign-in checks for the API routes. The route passes the request, and Supabase says who the bearer
// token belongs to. Browser-sent user ids are never trusted. Dependencies are arguments, so tests pass fakes.

/**
 * @typedef {object} AuthUser
 * @property {string} id
 * @property {string} email
 * @property {boolean} verified
 * @property {string} handle
 * @property {string} displayName
 */

/**
 * @typedef {object} AuthDeps
 * @property {typeof fetch} [fetchImpl] Defaults to the global fetch.
 * @property {string} url Supabase project URL, without a trailing slash.
 * @property {string} anonKey Supabase anon key, sent as the apikey header.
 */

/** @typedef {{ user: AuthUser } | { status: number, error: string }} AuthResult */

/** @typedef {{ headers: import('node:http').IncomingHttpHeaders }} RequestLike */

/** @typedef {{ id?: unknown, email?: unknown, email_confirmed_at?: unknown, user_metadata?: unknown }} UserReply */

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the signed-in user from the request's bearer token. Returns null when the header is missing or
 * is not a bearer token, and when Supabase answers 401. Any other failure throws, so an outage is not
 * read as signed out.
 * @param {RequestLike} req
 * @param {AuthDeps} deps
 * @returns {Promise<AuthUser | null>}
 */
export async function readUser(req, { fetchImpl = fetch, url, anonKey }) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? BEARER.exec(header) : null;
  if (!match) return null;

  const res = await fetchImpl(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${match[1]}`, apikey: anonKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Auth check failed with status ${res.status}`);

  const data = /** @type {UserReply | null} */ (await res.json());
  if (typeof data !== 'object' || data === null || typeof data.id !== 'string' || data.id === '') {
    throw new Error('Auth check returned no user id');
  }
  const metadata = typeof data.user_metadata === 'object' && data.user_metadata !== null
    ? /** @type {Record<string, unknown>} */ (data.user_metadata)
    : {};

  return {
    id: data.id,
    email: text(data.email),
    // Fails closed: only a confirmation timestamp counts. A missing field is unverified.
    verified: typeof data.email_confirmed_at === 'string',
    handle: text(metadata.handle),
    displayName: text(metadata.display_name),
  };
}

/**
 * Route guard: the caller must be signed in. A failed sign-in check gives 503, not 401.
 * @param {RequestLike} req
 * @param {AuthDeps} deps
 * @returns {Promise<AuthResult>}
 */
export async function requireUser(req, deps) {
  /** @type {AuthUser | null} */
  let user;
  try {
    user = await readUser(req, deps);
  } catch {
    return { status: 503, error: 'Could not check sign-in, try again' };
  }
  if (!user) return { status: 401, error: 'Sign in first' };
  return { user };
}

/**
 * Route guard: the caller must be signed in and have a verified email.
 * @param {RequestLike} req
 * @param {AuthDeps} deps
 * @returns {Promise<AuthResult>}
 */
export async function requireVerified(req, deps) {
  const result = await requireUser(req, deps);
  if (!('user' in result)) return result;
  if (!result.user.verified) return { status: 403, error: 'Verify your email first' };
  return result;
}
