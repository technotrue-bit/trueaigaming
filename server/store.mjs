// @ts-check
// The Supabase-backed store used by the route logic. It takes a client as an argument and imports nothing
// from @supabase/supabase-js: server/supabase.mjs is the only file that creates a client. Each method throws
// on a database error. The error keeps Postgres' code, so a unique-key failure (23505) can be recognised.
// The service-role client bypasses row-level security, so the logic checks ownership itself.

/**
 * @typedef {Submission & { owner_handle: string | null }} PendingSubmission
 */

/**
 * @typedef {object} Profile
 * @property {string} id
 * @property {string} handle
 * @property {string} display_name
 * @property {boolean} is_admin
 * @property {string} created_at
 */

/**
 * @typedef {object} Submission
 * @property {string} id
 * @property {string} owner_id
 * @property {string} slug
 * @property {string} name
 * @property {string} description
 * @property {string} how_it_was_made
 * @property {string} play_url
 * @property {string | null} source_url
 * @property {string | null} thumbnail_url
 * @property {number} min_players
 * @property {number} max_players
 * @property {'pending' | 'approved' | 'rejected'} status
 * @property {string | null} review_note
 * @property {string | null} reviewed_by
 * @property {string | null} reviewed_at
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * A submission to insert. The owner and the game address are required. The rest default in the database.
 * @typedef {Partial<Submission> & Pick<Submission, 'owner_id' | 'slug'>} NewSubmission
 */

/**
 * @typedef {object} Store
 * @property {(userId: string) => Promise<Profile | null>} getProfile
 * @property {(row: { id: string, handle: string, display_name: string }) => Promise<Profile>} insertProfile
 * @property {(userId: string, patch: { handle?: string, display_name?: string }) => Promise<Profile>} updateProfile
 * @property {(userId: string) => Promise<void>} deleteProfile
 * @property {(userId: string) => Promise<boolean>} isAdmin
 * @property {(userId: string) => Promise<void>} deleteAuthUser
 * @property {(ownerId: string) => Promise<Submission[]>} listOwnSubmissions
 * @property {(ownerId: string, id: string) => Promise<Submission | null>} getOwnSubmission
 * @property {(ownerId: string) => Promise<number>} countPending
 * @property {(ownerId: string, iso: string) => Promise<number>} countSince
 * @property {(row: NewSubmission) => Promise<Submission>} insertSubmission
 * @property {(id: string, patch: Partial<Submission>) => Promise<Submission>} updateSubmission
 * @property {(id: string, expectedStatus: Submission['status'], patch: Partial<Submission>) => Promise<Submission | null>} updateSubmissionIfStatus Updates only a row whose status is expectedStatus. Returns null when no row matched.
 * @property {(id: string) => Promise<void>} deleteSubmission
 * @property {() => Promise<PendingSubmission[]>} listPending
 * @property {() => Promise<Submission[]>} listApproved
 * @property {(id: string) => Promise<Submission | null>} getSubmissionById
 */

/**
 * The Supabase client, typed loosely on purpose so this module does not import the package. Only the parts
 * used below are relied on.
 * @typedef {{
 *   from: (table: string) => any,
 *   auth: { admin: { deleteUser: (id: string) => Promise<{ error: { message: string, code?: string } | null }> } }
 * }} SupabaseLike
 */

/**
 * Turns a Supabase error into an Error that keeps its code.
 * @param {{ message: string, code?: string }} error
 * @returns {Error & { code?: string }}
 */
function toError(error) {
  return Object.assign(new Error(error.message), { code: error.code });
}

/**
 * Returns the data of a Supabase reply, or throws its error.
 * @template T
 * @param {{ data: T, error: { message: string, code?: string } | null }} reply
 * @returns {T}
 */
function unwrap({ data, error }) {
  if (error) throw toError(error);
  return data;
}

/**
 * A pending row with its owner's handle. The embedded profiles object is removed, so no other profile field reaches the
 * caller. A row with no profile gets null.
 * @param {Submission & { profiles?: { handle?: string | null } | null }} row
 * @returns {PendingSubmission}
 */
function pendingRow(row) {
  const { profiles, ...submission } = row;
  return { ...submission, owner_handle: profiles?.handle ?? null };
}

/**
 * Returns the row count of a head-only Supabase query, or throws its error.
 * @param {PromiseLike<{ count: number | null, error: { message: string, code?: string } | null }>} query
 * @returns {Promise<number>}
 */
async function countRows(query) {
  const { count, error } = await query;
  if (error) throw toError(error);
  return count ?? 0;
}

/**
 * @param {SupabaseLike} client
 * @returns {Store}
 */
export function createStore(client) {
  const profiles = () => client.from('profiles');
  const submissions = () => client.from('submissions');

  return {
    async getProfile(userId) {
      return unwrap(await profiles().select('*').eq('id', userId).maybeSingle());
    },

    async insertProfile(row) {
      return unwrap(await profiles().insert(row).select('*').single());
    },

    async updateProfile(userId, patch) {
      return unwrap(await profiles().update(patch).eq('id', userId).select('*').single());
    },

    async deleteProfile(userId) {
      unwrap(await profiles().delete().eq('id', userId));
    },

    async isAdmin(userId) {
      const row = unwrap(await profiles().select('is_admin').eq('id', userId).maybeSingle());
      return row?.is_admin === true;
    },

    async deleteAuthUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) throw toError(error);
    },

    async listOwnSubmissions(ownerId) {
      return unwrap(await submissions().select('*').eq('owner_id', ownerId).order('created_at', { ascending: false })) ?? [];
    },

    async getOwnSubmission(ownerId, id) {
      return unwrap(await submissions().select('*').eq('owner_id', ownerId).eq('id', id).maybeSingle());
    },

    async countPending(ownerId) {
      return countRows(submissions().select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).eq('status', 'pending'));
    },

    async countSince(ownerId, iso) {
      return countRows(submissions().select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).gte('created_at', iso));
    },

    async insertSubmission(row) {
      return unwrap(await submissions().insert(row).select('*').single());
    },

    async updateSubmission(id, patch) {
      return unwrap(await submissions().update(patch).eq('id', id).select('*').single());
    },

    async updateSubmissionIfStatus(id, expectedStatus, patch) {
      return unwrap(await submissions().update(patch).eq('id', id).eq('status', expectedStatus).select('*').maybeSingle());
    },

    async deleteSubmission(id) {
      unwrap(await submissions().delete().eq('id', id));
    },

    async listPending() {
      const rows = unwrap(await submissions().select('*, profiles(handle)').eq('status', 'pending').order('created_at', { ascending: true })) ?? [];
      return rows.map(pendingRow);
    },

    async listApproved() {
      return unwrap(await submissions().select('*').eq('status', 'approved').order('created_at', { ascending: true })) ?? [];
    },

    async getSubmissionById(id) {
      return unwrap(await submissions().select('*').eq('id', id).maybeSingle());
    },
  };
}
