// @ts-check
// Published games: approved submission rows (from Supabase, or a fixture file for build checks) become Game entries
// for the build. Nothing here reads process.env: the build passes the environment in. The Supabase client loads only
// when the default row source runs, so tests and disabled builds never import it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSubmission } from '../src/shared/submission-rules.mjs';

/**
 * @typedef {import('./seo.mjs').Game} Game
 * @typedef {Game & { external: true }} ExternalGame
 * @typedef {{ url: string, serviceKey: string }} SupabaseConfig
 */

const PLACEHOLDER_THUMBNAIL = '/thumbs/placeholder.png';
const MISSING_SUPABASE = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when SUBMISSIONS_ENABLED=true';

/**
 * Maps a row's snake_case columns to the camelCase shape validateSubmission takes. A value that is not an object is
 * returned unchanged, so validateSubmission refuses it.
 * @param {unknown} row
 * @returns {unknown}
 */
function rowInput(row) {
  if (typeof row !== 'object' || row === null) return row;
  const r = /** @type {Record<string, unknown>} */ (row);
  return {
    name: r.name,
    slug: r.slug,
    description: r.description,
    howItWasMade: r.how_it_was_made,
    playUrl: r.play_url,
    sourceUrl: r.source_url,
    thumbnailUrl: r.thumbnail_url,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
  };
}

/**
 * The slug as written in the row, for error messages only. Empty when the row has no text slug.
 * @param {unknown} row
 */
function rawSlug(row) {
  const slug = typeof row === 'object' && row !== null ? /** @type {Record<string, unknown>} */ (row).slug : undefined;
  return typeof slug === 'string' ? slug : '';
}

/**
 * The owner's profile from the row's embedded profiles(handle, display_name), or {} when there is none.
 * @param {unknown} row
 * @returns {{ handle?: unknown, display_name?: unknown }}
 */
function profileOf(row) {
  const profile = /** @type {{ profiles?: unknown }} */ (row).profiles;
  return typeof profile === 'object' && profile !== null ? profile : {};
}

/**
 * One approved row as a Game. The row is checked with validateSubmission first, and a row that fails throws, so the
 * build never drops a game silently. The Game takes the checked values, not the raw row.
 * @param {unknown} row
 * @returns {ExternalGame}
 */
export function submissionToGame(row) {
  const checked = validateSubmission(rowInput(row));
  if (!checked.ok) throw new Error(`Published submission "${rawSlug(row)}" is invalid: ${checked.error}`);
  const fields = checked.value;

  const profile = profileOf(row);
  const displayName = typeof profile.display_name === 'string' ? profile.display_name.trim() : '';
  const handle = typeof profile.handle === 'string' ? profile.handle : '';
  const author = displayName || handle;
  if (!author) throw new Error(`Published submission "${fields.slug}" has no author`);

  return {
    id: fields.slug,
    name: fields.name,
    description: fields.description,
    playUrl: fields.playUrl,
    thumbnail: fields.thumbnailUrl ?? PLACEHOLDER_THUMBNAIL,
    thumbSize: { width: 1280, height: 720 },
    status: 'live',
    repo: fields.sourceUrl ?? undefined,
    howItWasMade: fields.howItWasMade,
    minPlayers: fields.minPlayers,
    maxPlayers: fields.maxPlayers,
    author,
    external: true,
  };
}

/**
 * Approved rows with the owner's handle and display name. Used only when SUBMISSIONS_ENABLED is 'true' and no
 * PUBLISHED_GAMES_JSON file is set. The client module is imported here, so it never loads during tests.
 * @param {SupabaseConfig} config
 * @returns {Promise<unknown>}
 */
async function fetchApprovedRows({ url, serviceKey }) {
  const { serviceClient } = await import('../server/supabase.mjs');
  const { data, error } = await serviceClient({ url, serviceKey })
    .from('submissions')
    .select('slug, name, description, how_it_was_made, play_url, source_url, thumbnail_url, min_players, max_players, profiles(handle, display_name)')
    .eq('status', 'approved')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not load approved submissions: ${error.message}`);
  return data ?? [];
}

/**
 * Every approved submission as a Game, for the build. Returns [] unless SUBMISSIONS_ENABLED is 'true'.
 * Rows come from the file named by PUBLISHED_GAMES_JSON when it is set, otherwise from fetchRows, which gets the
 * Supabase URL and service key. A bad row, or a slug that collides with games.json or with another row, throws.
 * @param {{
 *   env: Record<string, string | undefined>,
 *   fetchRows?: (config: SupabaseConfig) => Promise<unknown>,
 *   existingIds?: Iterable<string>,
 * }} options
 * @returns {Promise<ExternalGame[]>}
 */
export async function loadPublishedGames({ env, fetchRows = fetchApprovedRows, existingIds = [] }) {
  if (env.SUBMISSIONS_ENABLED !== 'true') return [];

  /** @type {unknown} */
  let rows;
  if (env.PUBLISHED_GAMES_JSON) {
    rows = JSON.parse(readFileSync(resolve(env.PUBLISHED_GAMES_JSON), 'utf8'));
  } else {
    const url = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error(MISSING_SUPABASE);
    rows = await fetchRows({ url, serviceKey });
  }
  if (!Array.isArray(rows)) throw new Error('Published submissions must be an array of rows');

  const taken = new Set(existingIds);
  const seen = new Set();
  /** @type {ExternalGame[]} */
  const games = [];
  for (const row of rows) {
    const game = submissionToGame(row);
    if (taken.has(game.id)) throw new Error(`Submission slug "${game.id}" collides with a games.json id`);
    if (seen.has(game.id)) throw new Error(`Submission slug "${game.id}" appears more than once`);
    seen.add(game.id);
    games.push(game);
  }
  return games;
}
