// @ts-check
// Admin review logic: list pending submissions, approve or reject them, and republish the site. The store and the
// rebuild function are arguments, so tests pass in-memory fakes. Results are { ok: true, value } or
// { ok: false, status, error }. Every rebuild goes through rebuildForClient, so a reply never carries the hook's
// reason. Nothing here reads the environment.
import { rebuildForClient } from './deploy.mjs';

/**
 * @typedef {import('./store.mjs').Submission} Submission
 * @typedef {import('./store.mjs').PendingSubmission} PendingSubmission
 * @typedef {import('./store.mjs').Store} Store
 * @typedef {{ ok: true } | { ok: false, error: string }} RebuildResult
 * @typedef {() => Promise<RebuildResult>} Rebuild
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, status: number, error: string }} AdminResult
 */

const NOT_ADMIN = 'Admins only';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {number} status @param {string} error @returns {{ ok: false, status: number, error: string }} */
function fail(status, error) {
  return { ok: false, status, error };
}

/** @returns {{ ok: false, status: 404, error: string }} */
function notFound() {
  return { ok: false, status: 404, error: 'Not found' };
}

/** A row that is not pending cannot be reviewed. @returns {{ ok: false, status: 409, error: string }} */
function notPending() {
  return { ok: false, status: 409, error: 'Only pending submissions can be reviewed' };
}

/**
 * Runs the rebuild for a client reply. A failure becomes fixed text. The log gets only the name of a thrown Error,
 * or 'unknown error', because a thrown value can carry the hook URL in its message.
 * @param {Rebuild} rebuild
 * @returns {Promise<RebuildResult>}
 */
async function runRebuild(rebuild) {
  return rebuildForClient({
    trigger: rebuild,
    log: (message, detail) => console.error(`admin: ${message}`, detail instanceof Error ? detail.name : 'unknown error'),
  });
}

/**
 * Lists the pending submissions, oldest first, each with its owner's handle (owner_handle, or null). Only an admin may read the queue.
 * @param {{ store: Store, adminId: string }} args
 * @returns {Promise<AdminResult<PendingSubmission[]>>}
 */
export async function listPending({ store, adminId }) {
  if (!(await store.isAdmin(adminId))) return fail(403, NOT_ADMIN);
  return { ok: true, value: await store.listPending() };
}

/**
 * Approves or rejects a pending submission. Checks run in this order, and the admin check comes before any write: the
 * caller is an admin, the action is approve or reject, a reject has a note, the id names a row, and the row is
 * pending. Then the status, note, reviewer and review time are saved, but only if the row is still pending, so a
 * review that lands between the read and the write is refused with 409. Only an approval calls rebuild, after the
 * save, so a failed rebuild leaves the approval in place. A reject returns rebuild as null.
 * @param {{ store: Store, adminId: string, id: unknown, action: unknown, note: unknown, rebuild: Rebuild }} args
 * @returns {Promise<AdminResult<{ submission: Submission, rebuild: RebuildResult | null }>>}
 */
export async function reviewSubmission({ store, adminId, id, action, note, rebuild }) {
  if (!(await store.isAdmin(adminId))) return fail(403, NOT_ADMIN);
  if (action !== 'approve' && action !== 'reject') return fail(400, 'Action must be approve or reject');

  const text = typeof note === 'string' ? note.trim() : '';
  if (action === 'reject' && text === '') return fail(400, 'A note is required when rejecting');

  if (typeof id !== 'string' || !UUID.test(id)) return notFound();
  const current = await store.getSubmissionById(id);
  if (!current) return notFound();
  if (current.status !== 'pending') return notPending();

  const submission = await store.updateSubmissionIfStatus(id, 'pending', {
    status: action === 'approve' ? 'approved' : 'rejected',
    review_note: text === '' ? null : text,
    reviewed_by: adminId,
    reviewed_at: new Date().toISOString(),
  });
  if (!submission) return notPending();

  const rebuildResult = action === 'approve' ? await runRebuild(rebuild) : null;
  return { ok: true, value: { submission, rebuild: rebuildResult } };
}

/**
 * Rebuilds the site so approved games reach the prerendered pages and sitemap. Only an admin may do this.
 * @param {{ store: Store, adminId: string, rebuild: Rebuild }} args
 * @returns {Promise<AdminResult<{ rebuild: RebuildResult }>>}
 */
export async function republish({ store, adminId, rebuild }) {
  if (!(await store.isAdmin(adminId))) return fail(403, NOT_ADMIN);
  return { ok: true, value: { rebuild: await runRebuild(rebuild) } };
}
