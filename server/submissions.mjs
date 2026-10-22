// @ts-check
// Submission logic: create, read, edit and delete a signed-in user's own games, and the thumbnail file check.
// The store and the rebuild function are arguments, so tests pass in-memory fakes. Results are { ok: true, value }
// or { ok: false, status, error }. Nothing here reads the environment.
import { isBlobThumbnailUrl, validateSubmission } from '../src/shared/submission-rules.mjs';

/**
 * @typedef {import('./store.mjs').Submission} Submission
 * @typedef {import('./store.mjs').Store} Store
 * @typedef {import('../src/shared/submission-rules.mjs').SubmissionFields} SubmissionFields
 * @typedef {{ ok: true } | { ok: false, error: string }} RebuildResult
 * @typedef {() => Promise<RebuildResult>} Rebuild
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, status: number, error: string }} SubmissionResult
 */

const MAX_PENDING = 5;
const MAX_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_THUMBNAIL_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DECLARED_TYPES = /** @type {Map<string, 'png' | 'jpg' | 'webp'>} */ (new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]));

/** @returns {{ ok: false, status: 404, error: string }} */
function notFound() {
  return { ok: false, status: 404, error: 'Not found' };
}

/** @param {number} status @param {string} error @returns {{ ok: false, status: number, error: string }} */
function fail(status, error) {
  return { ok: false, status, error };
}

/** @param {unknown} err */
function isUniqueViolation(err) {
  return typeof err === 'object' && err !== null && /** @type {{ code?: unknown }} */ (err).code === UNIQUE_VIOLATION;
}

/** @param {number} ms */
function iso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Digits-only text becomes a number, because form values arrive as strings. Anything else is returned unchanged,
 * so validatePlayers refuses it.
 * @param {unknown} value
 * @returns {unknown}
 */
function playerCount(value) {
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return Number(value);
  return value;
}

/**
 * Maps a form or JSON body from snake_case keys to the camelCase shape validateSubmission takes, and converts
 * player counts to numbers. A body that is not an object is returned unchanged, so validateSubmission refuses it.
 * @param {unknown} body
 * @returns {unknown}
 */
export function submissionInput(body) {
  if (typeof body !== 'object' || body === null) return body;
  const fields = /** @type {Record<string, unknown>} */ (body);
  return {
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    howItWasMade: fields.how_it_was_made,
    playUrl: fields.play_url,
    sourceUrl: fields.source_url,
    thumbnailUrl: fields.thumbnail_url,
    minPlayers: playerCount(fields.min_players),
    maxPlayers: playerCount(fields.max_players),
  };
}

/**
 * The row columns for a checked submission. The values are the ones validateSubmission returned, so they are
 * trimmed and the links are canonical.
 * @param {SubmissionFields} fields
 */
function columns(fields) {
  return {
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    how_it_was_made: fields.howItWasMade,
    play_url: fields.playUrl,
    source_url: fields.sourceUrl,
    thumbnail_url: fields.thumbnailUrl,
    min_players: fields.minPlayers,
    max_players: fields.maxPlayers,
  };
}

/**
 * The caller's own row, or null. A malformed id is null without asking the store, so it cannot reach the uuid column.
 * @param {Store} store
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Submission | null>}
 */
async function ownedRow(store, ownerId, id) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  return store.getOwnSubmission(ownerId, id);
}

/**
 * Runs the rebuild. A rebuild that throws becomes a failed result, so the caller still reports the saved change.
 * @param {Rebuild} rebuild
 * @returns {Promise<RebuildResult>}
 */
async function runRebuild(rebuild) {
  try {
    return await rebuild();
  } catch {
    return { ok: false, error: 'Rebuild failed' };
  }
}

/**
 * Creates a pending submission for the owner. Two caps are checked first: at most 5 pending at once, and at most 3
 * created in the last 24 hours. The cap counts rows that still exist, so deleting a row frees its daily slot.
 * Then the fields are checked, and a thumbnail must be a Blob URL. A game address already in use gives 409.
 * @param {{ store: Store, ownerId: string, input: unknown, now: number }} args `now` is epoch milliseconds.
 * @returns {Promise<SubmissionResult<Submission>>}
 */
export async function createSubmission({ store, ownerId, input, now }) {
  if ((await store.countPending(ownerId)) >= MAX_PENDING) {
    return fail(429, 'You can have 5 pending submissions at a time');
  }
  if ((await store.countSince(ownerId, iso(now - DAY_MS))) >= MAX_PER_DAY) {
    return fail(429, 'You can add 3 new submissions per day');
  }

  const checked = validateSubmission(input);
  if (!checked.ok) return fail(400, checked.error);
  const fields = checked.value;
  // validateSubmission runs this same check. It is repeated here so no thumbnail URL is stored without it.
  if (fields.thumbnailUrl !== null && !isBlobThumbnailUrl(fields.thumbnailUrl)) {
    return fail(400, 'Thumbnail must be hosted on Vercel Blob');
  }

  try {
    const submission = await store.insertSubmission({ owner_id: ownerId, ...columns(fields), status: 'pending' });
    return { ok: true, value: submission };
  } catch (err) {
    if (isUniqueViolation(err)) return fail(409, 'That game address is taken');
    throw err;
  }
}

/**
 * The caller's own submission. A missing row, a malformed id and another owner's row all give the same 404.
 * @param {{ store: Store, ownerId: string, id: string }} args
 * @returns {Promise<SubmissionResult<Submission>>}
 */
export async function getOwnSubmission({ store, ownerId, id }) {
  const row = await ownedRow(store, ownerId, id);
  return row ? { ok: true, value: row } : notFound();
}

/**
 * Edits the caller's own submission. Any edit sets it to pending and clears the review note. An approved
 * submission has to leave the site, so rebuild runs once after the save. The save stands even if the rebuild fails.
 * @param {{ store: Store, ownerId: string, id: string, input: unknown, now: number, rebuild: Rebuild }} args
 * @returns {Promise<SubmissionResult<{ submission: Submission, wasApproved: boolean, rebuild: RebuildResult | null }>>}
 */
export async function updateSubmission({ store, ownerId, id, input, now, rebuild }) {
  const current = await ownedRow(store, ownerId, id);
  if (!current) return notFound();

  const checked = validateSubmission(input);
  if (!checked.ok) return fail(400, checked.error);
  const fields = checked.value;
  if (fields.thumbnailUrl !== null && !isBlobThumbnailUrl(fields.thumbnailUrl)) {
    return fail(400, 'Thumbnail must be hosted on Vercel Blob');
  }

  const wasApproved = current.status === 'approved';
  /** @type {Submission} */
  let submission;
  try {
    submission = await store.updateSubmission(id, {
      ...columns(fields),
      status: 'pending',
      review_note: null,
      updated_at: iso(now),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(409, 'That game address is taken');
    throw err;
  }

  const rebuildResult = wasApproved ? await runRebuild(rebuild) : null;
  return { ok: true, value: { submission, wasApproved, rebuild: rebuildResult } };
}

/**
 * Deletes the caller's own submission. An approved one has to leave the site, so rebuild runs once. It runs in a
 * finally block, so a delete that commits and then throws still rebuilds, as deleteAccount does.
 * @param {{ store: Store, ownerId: string, id: string, rebuild: Rebuild }} args
 * @returns {Promise<SubmissionResult<{ wasApproved: boolean, rebuild: RebuildResult | null }>>}
 */
export async function deleteSubmission({ store, ownerId, id, rebuild }) {
  const current = await ownedRow(store, ownerId, id);
  if (!current) return notFound();

  const wasApproved = current.status === 'approved';
  /** @type {RebuildResult | null} */
  let rebuildResult = null;
  try {
    await store.deleteSubmission(id);
  } finally {
    if (wasApproved) rebuildResult = await runRebuild(rebuild);
  }
  return { ok: true, value: { wasApproved, rebuild: rebuildResult } };
}

/**
 * The file type found from the leading bytes, or null when no known signature matches.
 * @param {Buffer} buffer
 * @returns {'png' | 'jpg' | 'webp' | null}
 */
function detectExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Checks an uploaded thumbnail by its bytes, not its name. It must be 1 MB or less, and its signature must match the
 * declared type. SVG and anything else with no known signature is refused.
 * @param {Buffer} buffer
 * @param {string} declaredType The Content-Type the upload declared, with or without parameters.
 * @returns {SubmissionResult<{ extension: 'png' | 'jpg' | 'webp' }>}
 */
export function checkThumbnail(buffer, declaredType) {
  if (buffer.length > MAX_THUMBNAIL_BYTES) return fail(413, 'Image must be 1 MB or less');
  const declared = DECLARED_TYPES.get(String(declaredType).split(';')[0].trim().toLowerCase());
  const detected = detectExtension(buffer);
  if (declared === undefined || detected === null || declared !== detected) {
    return fail(415, 'Upload a PNG, JPEG or WebP image');
  }
  return { ok: true, value: { extension: detected } };
}
