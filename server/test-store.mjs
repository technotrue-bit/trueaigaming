// @ts-check
// In-memory store with the same methods as createStore, for tests. Rows live in Maps and reads return copies,
// so the logic never changes a test's own objects. A duplicate profile id or handle, or a duplicate submission
// slug, throws an error with code 23505, as Postgres does. Nothing here touches the network.
import { randomUUID } from 'node:crypto';

/** @typedef {import('./store.mjs').Profile} Profile */
/** @typedef {import('./store.mjs').Submission} Submission */
/** @typedef {import('./store.mjs').Store} Store */
/** @typedef {import('./store.mjs').NewSubmission} NewSubmission */

/**
 * @typedef {object} Seed
 * @property {Array<Partial<Profile> & Pick<Profile, 'id' | 'handle'>>} [profiles]
 * @property {Array<Partial<Submission> & Pick<Submission, 'id' | 'owner_id' | 'slug'>>} [submissions]
 */

/** A unique-key failure, with the same code Postgres gives. @param {string} table */
function uniqueViolation(table) {
  return Object.assign(new Error(`duplicate key value violates unique constraint on ${table}`), { code: '23505' });
}

/** A missing row, with the same code PostgREST gives for .single(). */
function notFound() {
  return Object.assign(new Error('Row not found'), { code: 'PGRST116' });
}

/** @returns {string} */
function now() {
  return new Date().toISOString();
}

/**
 * The column values a submission gets when a row does not set them.
 * @returns {Omit<Submission, 'id' | 'owner_id' | 'slug'>}
 */
function submissionDefaults() {
  const stamp = now();
  return {
    name: 'Test game',
    description: 'A test game',
    how_it_was_made: 'Made in a test',
    play_url: 'https://example.com/play',
    source_url: null,
    thumbnail_url: null,
    min_players: 1,
    max_players: 4,
    status: 'pending',
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: stamp,
    updated_at: stamp,
  };
}

/**
 * @template T
 * @param {T | undefined} row
 * @returns {T | null}
 */
function copyOrNull(row) {
  return row === undefined ? null : { ...row };
}

/** Newest first, by created_at. @param {Submission[]} rows */
function newestFirst(rows) {
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Oldest first, by created_at. @param {Submission[]} rows */
function oldestFirst(rows) {
  return rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/**
 * @param {Seed} [seed]
 * @returns {Store & { state: { profiles: Map<string, Profile>, submissions: Map<string, Submission>, deletedAuthUsers: string[] } }}
 */
export function createTestStore(seed = {}) {
  /** @type {{ profiles: Map<string, Profile>, submissions: Map<string, Submission>, deletedAuthUsers: string[] }} */
  const state = { profiles: new Map(), submissions: new Map(), deletedAuthUsers: [] };

  for (const p of seed.profiles ?? []) {
    state.profiles.set(p.id, { display_name: '', is_admin: false, created_at: now(), ...p });
  }
  for (const s of seed.submissions ?? []) {
    state.submissions.set(s.id, { ...submissionDefaults(), ...s });
  }

  /**
   * @param {string} handle
   * @param {string} [exceptId] The profile that may already hold the handle.
   */
  const handleTaken = (handle, exceptId) =>
    [...state.profiles.values()].some((p) => p.handle === handle && p.id !== exceptId);

  /**
   * @param {string} slug
   * @param {string} [exceptId] The submission that may already hold the slug.
   */
  const slugTaken = (slug, exceptId) =>
    [...state.submissions.values()].some((s) => s.slug === slug && s.id !== exceptId);

  return {
    state,

    async getProfile(userId) {
      return copyOrNull(state.profiles.get(userId));
    },

    async insertProfile(row) {
      if (state.profiles.has(row.id)) throw uniqueViolation('profiles');
      if (handleTaken(row.handle)) throw uniqueViolation('profiles');
      const profile = { id: row.id, handle: row.handle, display_name: row.display_name, is_admin: false, created_at: now() };
      state.profiles.set(profile.id, profile);
      return { ...profile };
    },

    async updateProfile(userId, patch) {
      const current = state.profiles.get(userId);
      if (!current) throw notFound();
      if (patch.handle !== undefined && handleTaken(patch.handle, userId)) throw uniqueViolation('profiles');
      const next = { ...current, ...patch };
      state.profiles.set(userId, next);
      return { ...next };
    },

    async deleteProfile(userId) {
      state.profiles.delete(userId);
    },

    async isAdmin(userId) {
      return state.profiles.get(userId)?.is_admin === true;
    },

    async deleteAuthUser(userId) {
      state.deletedAuthUsers.push(userId);
    },

    async listOwnSubmissions(ownerId) {
      return newestFirst([...state.submissions.values()].filter((s) => s.owner_id === ownerId).map((s) => ({ ...s })));
    },

    async getOwnSubmission(ownerId, id) {
      const row = state.submissions.get(id);
      return row && row.owner_id === ownerId ? { ...row } : null;
    },

    async countPending(ownerId) {
      return [...state.submissions.values()].filter((s) => s.owner_id === ownerId && s.status === 'pending').length;
    },

    async countSince(ownerId, iso) {
      return [...state.submissions.values()].filter((s) => s.owner_id === ownerId && s.created_at >= iso).length;
    },

    async insertSubmission(row) {
      if (row.id !== undefined && state.submissions.has(row.id)) throw uniqueViolation('submissions');
      if (slugTaken(row.slug)) throw uniqueViolation('submissions');
      const submission = { ...submissionDefaults(), ...row, id: row.id ?? randomUUID() };
      state.submissions.set(submission.id, submission);
      return { ...submission };
    },

    async updateSubmission(id, patch) {
      const current = state.submissions.get(id);
      if (!current) throw notFound();
      if (patch.slug !== undefined && slugTaken(patch.slug, id)) throw uniqueViolation('submissions');
      const next = { ...current, ...patch, updated_at: now() };
      state.submissions.set(id, next);
      return { ...next };
    },

    async deleteSubmission(id) {
      state.submissions.delete(id);
    },

    async listPending() {
      return oldestFirst([...state.submissions.values()].filter((s) => s.status === 'pending').map((s) => ({ ...s })));
    },

    async listApproved() {
      return oldestFirst([...state.submissions.values()].filter((s) => s.status === 'approved').map((s) => ({ ...s })));
    },

    async getSubmissionById(id) {
      return copyOrNull(state.submissions.get(id));
    },
  };
}
