// @ts-check
// Shared submission rules: handles, display names, passwords, slugs, HTTPS links, player counts and
// whole game submissions. The API routes and the submit form both import this module, so the rules
// and messages match. Plain JavaScript with no dependencies.

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} Result
 */

/**
 * @typedef {object} SubmissionFields
 * @property {string} name
 * @property {string} slug
 * @property {string} description
 * @property {string} howItWasMade
 * @property {string} playUrl
 * @property {string | null} sourceUrl
 * @property {string | null} thumbnailUrl
 * @property {number} minPlayers
 * @property {number} maxPlayers
 */

/** Handles that would collide with site routes or words that read as missing values. */
export const RESERVED_HANDLES = new Set([
  'admin', 'api', 'u', 'submit', 'account', 'submissions', 'profile', 'privacy', 'games', 'play',
  'support', 'help', 'login', 'signup', 'logout', 'null', 'undefined',
]);

const HANDLE_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
// The same rule as the database check on submissions.thumbnail_url: one lowercase alphanumeric label, no port or userinfo.
const BLOB_URL_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//;
const MAX_URL = 2048;
const MAX_SLUG = 60;

/** Length in code points, so an emoji counts once. @param {string} s */
function codePoints(s) {
  return [...s].length;
}

/** @param {unknown} value */
function isMissing(value) {
  return value === undefined || value === null;
}

/** Missing, or text that is empty after trimming. @param {unknown} value */
function isBlank(value) {
  return isMissing(value) || (typeof value === 'string' && value.trim() === '');
}

/**
 * Trimmed text with a length limit. A blank value is an error only when `required` is true.
 * @param {unknown} value
 * @param {string} label
 * @param {{ max: number, required: boolean }} rule
 * @returns {Result<string>}
 */
function checkText(value, label, { max, required }) {
  const text = isMissing(value) ? '' : typeof value === 'string' ? value.trim() : null;
  if (text === null) return { ok: false, error: `${label} must be text` };
  if (text === '') return required ? { ok: false, error: `${label} is required` } : { ok: true, value: '' };
  if (codePoints(text) > max) return { ok: false, error: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: text };
}

/**
 * Slug rules with a caller-chosen label, so the form can say "Game address".
 * @param {unknown} value
 * @param {string} label
 * @returns {Result<string>}
 */
function checkSlug(value, label) {
  if (isMissing(value)) return { ok: false, error: `${label} is required` };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be text` };
  const n = codePoints(value);
  if (n < 3 || n > MAX_SLUG) return { ok: false, error: `${label} must be 3 to ${MAX_SLUG} characters` };
  if (!SLUG_RE.test(value)) return { ok: false, error: `${label} may use only a-z, 0-9 and hyphens` };
  return { ok: true, value };
}

/**
 * HTTPS link rules with a caller-chosen label. Returns the canonical href from the URL parser.
 * @param {unknown} value
 * @param {string} label
 * @returns {Result<string>}
 */
function checkHttpsUrl(value, label) {
  if (isBlank(value)) return { ok: false, error: `${label} is required` };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be text` };
  const text = value.trim();
  if (codePoints(text) > MAX_URL) return { ok: false, error: `${label} must be ${MAX_URL} characters or fewer` };

  /** @type {URL} */
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: `${label} must be a valid URL` };
  }
  if (url.protocol !== 'https:') return { ok: false, error: `${label} must use https` };
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: `${label} must not include a username or password` };
  }
  const host = url.hostname.replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, error: `${label} must not point to localhost` };
  // The URL parser turns numeric forms such as 2130706433 into dotted IPv4, so one regex covers them.
  // IPv6 hosts keep their brackets and always contain a colon.
  if (IPV4_RE.test(host) || host.includes(':')) return { ok: false, error: `${label} must use a domain name, not an IP address` };
  if (codePoints(url.href) > MAX_URL) return { ok: false, error: `${label} must be ${MAX_URL} characters or fewer` };
  return { ok: true, value: url.href };
}

/** @param {unknown} value @returns {value is number} */
function isPlayerCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16;
}

/**
 * Handle: trimmed, lowercased, 3 to 24 characters, starts and ends with a letter or digit, not reserved.
 * @param {unknown} value
 * @returns {Result<string>}
 */
export function validateHandle(value) {
  if (isMissing(value)) return { ok: false, error: 'Handle is required' };
  if (typeof value !== 'string') return { ok: false, error: 'Handle must be text' };
  const handle = value.trim().toLowerCase();
  const n = codePoints(handle);
  if (n < 3 || n > 24) return { ok: false, error: 'Handle must be 3 to 24 characters' };
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'Handle may use only a-z, 0-9 and hyphens, and must start and end with a letter or digit' };
  }
  if (RESERVED_HANDLES.has(handle)) return { ok: false, error: 'That handle is reserved' };
  return { ok: true, value: handle };
}

/**
 * Display name: trimmed, up to 40 characters. Optional, so blank gives ''.
 * @param {unknown} value
 * @returns {Result<string>}
 */
export function validateDisplayName(value) {
  return checkText(value, 'Display name', { max: 40, required: false });
}

/**
 * Password: at least 12 characters. The value is not trimmed or changed.
 * @param {unknown} value
 * @returns {Result<string>}
 */
export function validatePassword(value) {
  if (isMissing(value)) return { ok: false, error: 'Password is required' };
  if (typeof value !== 'string') return { ok: false, error: 'Password must be text' };
  if (codePoints(value) < 12) return { ok: false, error: 'Password must be at least 12 characters' };
  return { ok: true, value };
}

/**
 * Slug: 3 to 60 characters matching ^[a-z0-9-]+$. Not trimmed or lowercased, so it must already be clean.
 * @param {unknown} value
 * @returns {Result<string>}
 */
export function validateSlug(value) {
  return checkSlug(value, 'Slug');
}

/**
 * Suggested game address from a name: lowercase, runs of other characters become one hyphen,
 * hyphens trimmed at both ends, at most 60 characters.
 * @param {string} name
 * @returns {string}
 */
export function slugFromName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

/**
 * HTTPS link: up to 2048 characters, no credentials, no localhost, no IP-address hosts.
 * Returns the parser's canonical href.
 * @param {unknown} value
 * @returns {Result<string>}
 */
export function validateHttpsUrl(value) {
  return checkHttpsUrl(value, 'Link');
}

/**
 * Player range: whole numbers from 1 to 16, with min <= max. Only real numbers are accepted, not numeric strings.
 * @param {unknown} min
 * @param {unknown} max
 * @returns {Result<{ minPlayers: number, maxPlayers: number }>}
 */
export function validatePlayers(min, max) {
  if (!isPlayerCount(min) || !isPlayerCount(max)) return { ok: false, error: 'Players must be whole numbers from 1 to 16' };
  if (min > max) return { ok: false, error: 'Minimum players cannot be more than maximum players' };
  return { ok: true, value: { minPlayers: min, maxPlayers: max } };
}

/**
 * True when the canonical form of the value (from the URL parser) matches the database rule: https, one
 * [a-z0-9-] label before .public.blob.vercel-storage.com, no port or credentials, and at most 2048 characters.
 * When blobHost is a non-empty string (the project's own store, such as abc123.public.blob.vercel-storage.com), the
 * host must also be exactly that one, so a thumbnail cannot point at someone else's Blob store.
 * @param {unknown} value
 * @param {string} [blobHost]
 * @returns {boolean}
 */
export function isBlobThumbnailUrl(value, blobHost) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const wanted = typeof blobHost === 'string' ? blobHost.trim().toLowerCase() : '';
    if (wanted !== '' && url.host !== wanted) return false;
    return url.href.length <= MAX_URL && BLOB_URL_RE.test(url.href);
  } catch {
    return false;
  }
}

/**
 * A whole game submission. Name, game address, description, how it was made, play link and player
 * range are required. Source link and thumbnail are optional: blank gives null. The first failing
 * field's message is returned. options.blobHost, when set, is the one Blob host a thumbnail may use (see
 * isBlobThumbnailUrl).
 * @param {unknown} input
 * @param {{ blobHost?: string }} [options]
 * @returns {Result<SubmissionFields>}
 */
export function validateSubmission(input, options = {}) {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Submission must be an object' };
  const fields = /** @type {Record<string, unknown>} */ (input);

  const name = checkText(fields.name, 'Name', { max: 60, required: true });
  if (!name.ok) return name;
  const slug = checkSlug(fields.slug, 'Game address');
  if (!slug.ok) return slug;
  const description = checkText(fields.description, 'Description', { max: 140, required: true });
  if (!description.ok) return description;
  const howItWasMade = checkText(fields.howItWasMade, 'How it was made', { max: 600, required: true });
  if (!howItWasMade.ok) return howItWasMade;
  const playUrl = checkHttpsUrl(fields.playUrl, 'Play link');
  if (!playUrl.ok) return playUrl;

  /** @type {string | null} */
  let sourceUrl = null;
  if (!isBlank(fields.sourceUrl)) {
    const source = checkHttpsUrl(fields.sourceUrl, 'Source link');
    if (!source.ok) return source;
    sourceUrl = source.value;
  }

  /** @type {string | null} */
  let thumbnailUrl = null;
  if (!isBlank(fields.thumbnailUrl)) {
    const thumbnail = checkHttpsUrl(fields.thumbnailUrl, 'Thumbnail');
    if (!thumbnail.ok) return thumbnail;
    if (!isBlobThumbnailUrl(thumbnail.value, options.blobHost)) return { ok: false, error: 'Thumbnail must be hosted on Vercel Blob' };
    thumbnailUrl = thumbnail.value;
  }

  const players = validatePlayers(fields.minPlayers, fields.maxPlayers);
  if (!players.ok) return players;

  return {
    ok: true,
    value: {
      name: name.value,
      slug: slug.value,
      description: description.value,
      howItWasMade: howItWasMade.value,
      playUrl: playUrl.value,
      sourceUrl,
      thumbnailUrl,
      minPlayers: players.value.minPlayers,
      maxPlayers: players.value.maxPlayers,
    },
  };
}
