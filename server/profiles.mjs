// @ts-check
// Profile logic: the profile a signed-in user sees, changing the handle, and deleting the account. The store
// and the rebuild function are arguments, so tests pass in-memory fakes. Results are { ok: true, value } or
// { ok: false, status, error }. The handle and display name come from the user's own signup metadata, which
// the user can write, so both are validated before anything is inserted.
import { validateDisplayName, validateHandle } from '../src/shared/submission-rules.mjs';

/**
 * @typedef {import('./store.mjs').Profile} Profile
 * @typedef {import('./store.mjs').Store} Store
 * @typedef {import('./auth.mjs').AuthUser} AuthUser
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, status: number, error: string }} ProfileResult
 */

/** @typedef {{ ok: true } | { ok: false, error: string }} RebuildResult */

const UNIQUE_VIOLATION = '23505';

/** @param {unknown} err */
function isUniqueViolation(err) {
  return typeof err === 'object' && err !== null && /** @type {{ code?: unknown }} */ (err).code === UNIQUE_VIOLATION;
}

/** @returns {{ ok: false, status: 409, error: string }} */
function chooseAHandle() {
  return { ok: false, status: 409, error: 'Choose a handle' };
}

/**
 * Returns the signed-in user's profile. When there is none, creates one from the signup metadata. Metadata that
 * fails validation, or a handle another profile holds, creates nothing and returns 409 Choose a handle.
 * @param {Store} store
 * @param {AuthUser} user
 * @returns {Promise<ProfileResult<Profile>>}
 */
export async function ensureProfile(store, user) {
  const existing = await store.getProfile(user.id);
  if (existing) return { ok: true, value: existing };

  const handle = validateHandle(user.handle);
  const displayName = validateDisplayName(user.displayName);
  if (!handle.ok || !displayName.ok) return chooseAHandle();

  try {
    const value = await store.insertProfile({ id: user.id, handle: handle.value, display_name: displayName.value });
    return { ok: true, value };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A parallel request, such as a second tab, may have created the profile first. Use that one.
    const created = await store.getProfile(user.id);
    if (created) return { ok: true, value: created };
    return chooseAHandle();
  }
}

/**
 * Sets the signed-in user's handle. A user with no profile yet gets one, which is how someone whose signup
 * handle was refused chooses another.
 * @param {Store} store
 * @param {AuthUser} user
 * @param {unknown} handle
 * @returns {Promise<ProfileResult<Profile>>}
 */
export async function setHandle(store, user, handle) {
  const checked = validateHandle(handle);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };

  try {
    const existing = await store.getProfile(user.id);
    if (existing) {
      return { ok: true, value: await store.updateProfile(user.id, { handle: checked.value }) };
    }
    // The display name comes from metadata too, so it is validated. A value that fails becomes blank.
    const displayName = validateDisplayName(user.displayName);
    const value = await store.insertProfile({
      id: user.id,
      handle: checked.value,
      display_name: displayName.ok ? displayName.value : '',
    });
    return { ok: true, value };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { ok: false, status: 409, error: 'That handle is taken' };
  }
}

/**
 * Deletes the signed-in user's submissions, then the profile, then the auth user. Calls rebuild once, and only
 * when an approved game was removed, so the game leaves the site. If a later step throws, rebuild still runs
 * for a game already removed, and the error is then thrown.
 * @param {{ store: Store, user: AuthUser, rebuild: () => Promise<RebuildResult> }} args
 * @returns {Promise<{ ok: true, rebuild: RebuildResult | null }>}
 */
export async function deleteAccount({ store, user, rebuild }) {
  let approvedRemoved = false;
  /** @type {RebuildResult | null} */
  let rebuildResult = null;
  try {
    for (const submission of await store.listOwnSubmissions(user.id)) {
      // Set before the delete: a delete can commit and then throw, and the retry no longer lists that row.
      if (submission.status === 'approved') approvedRemoved = true;
      await store.deleteSubmission(submission.id);
    }
    await store.deleteProfile(user.id);
    await store.deleteAuthUser(user.id);
  } finally {
    if (approvedRemoved) rebuildResult = await rebuild();
  }
  return { ok: true, rebuild: rebuildResult };
}
